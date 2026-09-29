import { redis } from "../redis";
import { supabaseAdmin } from "../lib/supabase";
import { convertToInr, getLatestPrice, type FxRate, type LeaderboardUpdate } from "@tradekaro/shared";
import { CRYPTO_SYMBOLS, type Market } from "../lib/symbols";
import { recordRecompute } from "../lib/metrics";
import { getUsdtInrRate, FX_RATE_CHANNEL } from "../fx/rate";

export const PNL_KEY = "lb:pnl";
export const ENTRIES_KEY = "lb:entries";
const TICKS_CHANNEL = "price-ticks";
const RECOMPUTE_MS = 1000;
const PORTFOLIO_HISTORY_INTERVAL_MS = 15 * 60 * 1000;
const MIN_PUSH_DELTA = 0.01;
// Users revalued per batch. Bounds pipeline size and how long one batch holds the loop.
const CHUNK = 500;
// Yield to the event loop after this many socket emits in one batch.
const EMIT_YIELD_EVERY = 100;

const portfolioKey = (u: string) => `lb:portfolio:${u}`;
const userPosKey = (u: string) => `lb:userpos:${u}`;
const holdersKey = (posKey: string) => `lb:holders:${posKey}`;

interface Position {
  market: Market;
  symbol: string;
  quantity: number;
  avgCost: number;
}

interface CachedPortfolio {
  name: string;
  cash: number;
  startingCash: number;
  positions: Position[];
}

export interface LeaderboardEntry {
  display_name: string;
  total_value: number;
  pnl: number;
  pnl_pct: number;
}

export interface PortfolioSnapshot {
  base_currency: "INR";
  fx_rate: FxRate | null;
  cash: number;
  holdings_value: number;
  total_value: number;
  starting_cash: number;
  pnl: number;
  pnl_pct: number;
  rank: number | null;
  holdings: {
    symbol: string;
    market: Market;
    quantity: number;
    avg_cost: number;
    avg_cost_inr: number;
    quote_currency: "INR" | "USDT";
    price: number | null;
    value: number;
    unrealized_pnl: number;
  }[];
}

interface PushHooks {
  hasListener: (userId: string) => boolean;
  emit: (userId: string, snapshot: PortfolioSnapshot) => void;
  emitLeaderboard: (snapshot: LeaderboardUpdate) => void;
}

// The socket layer registers itself here, so the engine never imports Socket.IO.
let pushHooks: PushHooks | null = null;
const lastPushedTotal = new Map<string, number>();

export function registerPortfolioPush(hooks: PushHooks): void {
  pushHooks = hooks;
}

async function buildLeaderboardUpdate(fxRate: FxRate): Promise<LeaderboardUpdate> {
  const ids = await redis.zrevrange(PNL_KEY, 0, 19);
  const entries = ids.length ? await redis.hmget(ENTRIES_KEY, ...ids) : [];
  const leaderboard = ids.flatMap((id, index) => {
    const raw = entries[index];
    if (!raw) return [];
    const entry = JSON.parse(raw) as LeaderboardEntry;
    return [{ rank: index + 1, ...entry }];
  });
  return { base_currency: "INR", fx_rate: fxRate, leaderboard, total_users: await redis.zcard(PNL_KEY), updated_at: Date.now() };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const defaultName = (id: string) => `Guest-${id.slice(0, 4)}`;

type PriceCache = Map<string, number | null>;

// Fetch every distinct symbol price the given portfolios need, once, in parallel.
async function prefetchPrices(portfolios: CachedPortfolio[], cache: PriceCache): Promise<void> {
  const missing = new Map<string, [Market, string]>();
  for (const p of portfolios) {
    for (const pos of p.positions) {
      const k = `${pos.market}:${pos.symbol}`;
      if (!cache.has(k)) missing.set(k, [pos.market, pos.symbol]);
    }
  }
  await Promise.all(
    [...missing].map(async ([k, [market, symbol]]) => {
      const latest = await getLatestPrice(redis, market, symbol);
      cache.set(k, latest ? latest.price : null);
    })
  );
}

// Store the user's portfolio in Redis and keep the holder index in step with it.
async function writePortfolio(userId: string, p: CachedPortfolio): Promise<void> {
  const oldKeys = await redis.smembers(userPosKey(userId));
  const newKeys = p.positions.map((x) => `${x.market}:${x.symbol}`);
  const pipe = redis.pipeline();
  pipe.set(portfolioKey(userId), JSON.stringify(p));
  for (const k of oldKeys) {
    if (!newKeys.includes(k)) pipe.srem(holdersKey(k), userId);
  }
  pipe.del(userPosKey(userId));
  for (const k of newKeys) {
    pipe.sadd(holdersKey(k), userId);
    pipe.sadd(userPosKey(userId), k);
  }
  await pipe.exec();
}

interface PendingPush {
  userId: string;
  total: number;
  snapshot: Omit<PortfolioSnapshot, "rank">;
}

// Revalue one batch of users: one MGET, one price fetch per distinct symbol,
// one pipeline of writes, and one pipeline of ranks for users being pushed to.
async function recomputeChunk(userIds: string[], priceCache: PriceCache, force: boolean): Promise<void> {
  if (userIds.length === 0) return;

  const raws = await redis.mget(userIds.map(portfolioKey));
  const users: { id: string; p: CachedPortfolio }[] = [];
  raws.forEach((raw, i) => {
    if (raw) users.push({ id: userIds[i], p: JSON.parse(raw) as CachedPortfolio });
  });
  if (users.length === 0) return;

  await prefetchPrices(users.map((u) => u.p), priceCache);
  const fxRate = await getUsdtInrRate();
  const valuedUsers = users.filter(({ p }) =>
    fxRate !== null || !p.positions.some((position) => position.market === "CRYPTO")
  );
  if (valuedUsers.length === 0) return;

  const hooks = pushHooks;
  const writes = redis.pipeline();
  const pending: PendingPush[] = [];

  for (const { id, p } of valuedUsers) {
    let holdingsValue = 0;
    const holdings: PortfolioSnapshot["holdings"] = [];
    for (const pos of [...p.positions].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      const price = priceCache.get(`${pos.market}:${pos.symbol}`) ?? null;
      const quotePrice = price ?? pos.avgCost;
      const quoteCurrency = pos.market === "CRYPTO" ? "USDT" : "INR";
      const valuePrice = convertToInr(quotePrice, quoteCurrency, fxRate);
      const avgCostInr = convertToInr(pos.avgCost, quoteCurrency, fxRate);
      const value = pos.quantity * valuePrice;
      holdingsValue += value;
      holdings.push({
        symbol: pos.symbol,
        market: pos.market,
        quantity: pos.quantity,
        avg_cost: pos.avgCost,
        avg_cost_inr: round2(avgCostInr),
        quote_currency: quoteCurrency,
        price,
        value: round2(value),
        unrealized_pnl: round2(pos.quantity * (valuePrice - avgCostInr)),
      });
    }
    const total = p.cash + holdingsValue;
    const pnl = total - p.startingCash;
    const pct = p.startingCash > 0 ? (pnl / p.startingCash) * 100 : 0;

    const entry: LeaderboardEntry = {
      display_name: p.name,
      total_value: round2(total),
      pnl: round2(pnl),
      pnl_pct: round4(pct),
    };
    writes.zadd(PNL_KEY, pnl, id);
    writes.hset(ENTRIES_KEY, id, JSON.stringify(entry));

    if (!hooks) continue;
    if (!hooks.hasListener(id)) {
      lastPushedTotal.delete(id);
      continue;
    }
    const last = lastPushedTotal.get(id);
    if (!force && last !== undefined && Math.abs(total - last) < MIN_PUSH_DELTA) continue;

    pending.push({
      userId: id,
      total,
      snapshot: {
        base_currency: "INR",
        fx_rate: fxRate,
        cash: round2(p.cash),
        holdings_value: round2(holdingsValue),
        total_value: round2(total),
        starting_cash: round2(p.startingCash),
        pnl: round2(pnl),
        pnl_pct: round2(pct),
        holdings,
      },
    });
  }

  await writes.exec();

  if (hooks && fxRate && valuedUsers.length === users.length) hooks.emitLeaderboard(await buildLeaderboardUpdate(fxRate));

  if (!hooks || pending.length === 0) return;

  // Ranks must be read after the ZADDs above have landed.
  const rankPipe = redis.pipeline();
  for (const x of pending) rankPipe.zrevrank(PNL_KEY, x.userId);
  const ranks = await rankPipe.exec();

  for (let i = 0; i < pending.length; i++) {
    const x = pending[i];
    const r = ranks?.[i]?.[1];
    lastPushedTotal.set(x.userId, x.total);
    hooks.emit(x.userId, { ...x.snapshot, rank: typeof r === "number" ? r + 1 : null });
    if ((i + 1) % EMIT_YIELD_EVERY === 0) await new Promise<void>((res) => setImmediate(res));
  }
}

export async function recomputeMany(
  userIds: string[],
  priceCache: PriceCache = new Map(),
  force = false
): Promise<void> {
  for (let i = 0; i < userIds.length; i += CHUNK) {
    await recomputeChunk(userIds.slice(i, i + CHUNK), priceCache, force);
  }
}

// Revalue one user at the latest cached prices, update the sorted set, and push
// a snapshot to the user's sockets if anyone is listening.
export async function recompute(
  userId: string,
  priceCache: PriceCache = new Map(),
  force = false
): Promise<void> {
  await recomputeChunk([userId], priceCache, force);
}

// Reload one user from Postgres (called after a trade). Always pushes.
export async function syncUser(userId: string): Promise<void> {
  const [pf, prof, hold] = await Promise.all([
    supabaseAdmin.from("portfolios").select("cash_balance").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("profiles").select("starting_cash, display_name").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("holdings").select("symbol, market, quantity, avg_cost").eq("user_id", userId),
  ]);
  if (pf.error || prof.error || hold.error) {
    throw new Error(pf.error?.message ?? prof.error?.message ?? hold.error?.message);
  }
  if (!pf.data || !prof.data) return;

  const p: CachedPortfolio = {
    name: prof.data.display_name ?? defaultName(userId),
    cash: Number(pf.data.cash_balance),
    startingCash: Number(prof.data.starting_cash),
    positions: (hold.data ?? []).map((h) => ({
      market: h.market as Market,
      symbol: h.symbol,
      quantity: Number(h.quantity),
      avgCost: Number(h.avg_cost),
    })),
  };
  await writePortfolio(userId, p);
  await recompute(userId, new Map(), true);
}

// Called when a socket connects: make sure the user is cached, then push a snapshot.
export async function pushNow(userId: string): Promise<void> {
  const cached = await redis.exists(portfolioKey(userId));
  if (!cached) {
    await syncUser(userId);
    return;
  }
  await recompute(userId, new Map(), true);
}

async function fetchAll<T>(table: string, columns: string, orderCol: string): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

// Rebuild the whole leaderboard from Postgres (called once at API start).
async function rebuildAll(): Promise<number> {
  const [portfolios, profiles, holdings] = await Promise.all([
    fetchAll<{ user_id: string; cash_balance: string }>("portfolios", "user_id, cash_balance", "user_id"),
    fetchAll<{ id: string; starting_cash: string; display_name: string | null }>(
      "profiles", "id, starting_cash, display_name", "id"
    ),
    fetchAll<{ user_id: string; symbol: string; market: string; quantity: string; avg_cost: string }>(
      "holdings", "user_id, symbol, market, quantity, avg_cost", "id"
    ),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const holdingsByUser = new Map<string, Position[]>();
  for (const h of holdings) {
    const list = holdingsByUser.get(h.user_id) ?? [];
    list.push({
      market: h.market as Market,
      symbol: h.symbol,
      quantity: Number(h.quantity),
      avgCost: Number(h.avg_cost),
    });
    holdingsByUser.set(h.user_id, list);
  }

  const ids: string[] = [];
  for (const pf of portfolios) {
    const prof = profileById.get(pf.user_id);
    if (!prof) continue;
    const p: CachedPortfolio = {
      name: prof.display_name ?? defaultName(pf.user_id),
      cash: Number(pf.cash_balance),
      startingCash: Number(prof.starting_cash),
      positions: holdingsByUser.get(pf.user_id) ?? [],
    };
    await writePortfolio(pf.user_id, p);
    ids.push(pf.user_id);
  }
  await recomputeMany(ids, new Map());
  return ids.length;
}

async function persistPortfolioHistorySnapshot(): Promise<void> {
  const entries = await redis.hgetall(ENTRIES_KEY);
  const userIds = Object.keys(entries);
  if (userIds.length === 0) return;

  const portfolios = await redis.mget(userIds.map(portfolioKey));
  const capturedAt = new Date(
    Math.floor(Date.now() / PORTFOLIO_HISTORY_INTERVAL_MS) * PORTFOLIO_HISTORY_INTERVAL_MS,
  ).toISOString();
  const rows = userIds.flatMap((userId, index) => {
    const rawEntry = entries[userId];
    const rawPortfolio = portfolios[index];
    if (!rawEntry || !rawPortfolio) return [];
    try {
      const entry = JSON.parse(rawEntry) as LeaderboardEntry;
      const portfolio = JSON.parse(rawPortfolio) as CachedPortfolio;
      const totalValue = Number(entry.total_value);
      const cash = Number(portfolio.cash);
      const pnl = Number(entry.pnl);
      if (![totalValue, cash, pnl].every(Number.isFinite)) return [];
      return [{
        user_id: userId,
        captured_at: capturedAt,
        total_value: round2(totalValue),
        cash: round2(cash),
        holdings_value: round2(totalValue - cash),
        pnl: round2(pnl),
        base_currency: "INR",
      }];
    } catch {
      return [];
    }
  });

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("portfolio_snapshots")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "user_id,captured_at", ignoreDuplicates: true });
    if (error) throw new Error(`portfolio snapshots: ${error.message}`);
  }
}

export async function startLeaderboard(): Promise<void> {
  const count = await rebuildAll();
  console.log(`[leaderboard] rebuilt from Postgres: ${count} users`);

  const captureHistory = () => {
    void persistPortfolioHistorySnapshot().catch((err: unknown) =>
      console.error("[portfolio-history] snapshot capture failed:", err)
    );
  };
  captureHistory();
  setInterval(captureHistory, PORTFOLIO_HISTORY_INTERVAL_MS).unref();

  // Price ticks only mark a symbol as changed. Holders are revalued once a second.
  const dirty = new Set<string>();
  const sub = redis.duplicate();
  sub.on("error", (err: unknown) => console.error("[leaderboard] redis subscriber error:", err));
  sub.on("message", (channel: string, message: string) => {
    if (channel === FX_RATE_CHANNEL) {
      void (async () => {
        const users = new Set<string>();
        for (const symbol of CRYPTO_SYMBOLS) {
          const holders = await redis.smembers(holdersKey(`CRYPTO:${symbol}`));
          for (const userId of holders) users.add(userId);
        }
        await recomputeMany([...users], new Map());
      })().catch((err: unknown) => console.error("[leaderboard] FX revaluation failed:", err));
      return;
    }
    try {
      const t = JSON.parse(message);
      if (typeof t.symbol === "string" && (t.market === "NSE" || t.market === "CRYPTO")) {
        dirty.add(`${t.market}:${t.symbol}`);
      }
    } catch {
      /* ignore malformed ticks */
    }
  });
  await sub.subscribe(TICKS_CHANNEL, FX_RATE_CHANNEL);

  let running = false;
  setInterval(async () => {
    if (running || dirty.size === 0) return;
    running = true;
    try {
      const t0 = performance.now();
      const symbols = [...dirty];
      dirty.clear();

      // One pipeline for all holder lookups.
      const lookup = redis.pipeline();
      for (const s of symbols) lookup.smembers(holdersKey(s));
      const results = await lookup.exec();
      const users = new Set<string>();
      for (const r of results ?? []) {
        for (const u of (r[1] as string[] | null) ?? []) users.add(u);
      }

      await recomputeMany([...users], new Map());
      recordRecompute(performance.now() - t0, users.size);
    } catch (err) {
      console.error("[leaderboard] recompute failed:", err);
    } finally {
      running = false;
    }
  }, RECOMPUTE_MS).unref();

  console.log("[leaderboard] live recompute running");
}
