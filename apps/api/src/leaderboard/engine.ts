import { redis } from "../redis";
import { supabaseAdmin } from "../lib/supabase";
import { getLatestPrice } from "@tradekaro/shared";
import type { Market } from "../lib/symbols";
import { recordRecompute } from "../lib/metrics";

export const PNL_KEY = "lb:pnl";
export const ENTRIES_KEY = "lb:entries";
const TICKS_CHANNEL = "price-ticks";
const RECOMPUTE_MS = 1000;
const MIN_PUSH_DELTA = 0.01;

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
    price: number | null;
    value: number;
    unrealized_pnl: number;
  }[];
}

interface PushHooks {
  hasListener: (userId: string) => boolean;
  emit: (userId: string, snapshot: PortfolioSnapshot) => void;
}

// The socket layer registers itself here, so the engine never imports Socket.IO.
let pushHooks: PushHooks | null = null;
const lastPushedTotal = new Map<string, number>();

export function registerPortfolioPush(hooks: PushHooks): void {
  pushHooks = hooks;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const defaultName = (id: string) => `Guest-${id.slice(0, 4)}`;

type PriceCache = Map<string, number | null>;

async function priceOf(market: Market, symbol: string, cache: PriceCache): Promise<number | null> {
  const k = `${market}:${symbol}`;
  if (cache.has(k)) return cache.get(k)!;
  const latest = await getLatestPrice(redis, market, symbol);
  const price = latest ? latest.price : null;
  cache.set(k, price);
  return price;
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

// Revalue one user at the latest cached prices, update the sorted set, and push
// a snapshot to the user's sockets if anyone is listening.
export async function recompute(
  userId: string,
  priceCache: PriceCache = new Map(),
  force = false
): Promise<void> {
  const raw = await redis.get(portfolioKey(userId));
  if (!raw) return;
  const p: CachedPortfolio = JSON.parse(raw);

  let holdingsValue = 0;
  const holdings: PortfolioSnapshot["holdings"] = [];
  for (const pos of [...p.positions].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const price = await priceOf(pos.market, pos.symbol, priceCache);
    const valuePrice = price ?? pos.avgCost;
    const value = pos.quantity * valuePrice;
    holdingsValue += value;
    holdings.push({
      symbol: pos.symbol,
      market: pos.market,
      quantity: pos.quantity,
      avg_cost: pos.avgCost,
      price,
      value: round2(value),
      unrealized_pnl: round2(pos.quantity * (valuePrice - pos.avgCost)),
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
  await redis
    .pipeline()
    .zadd(PNL_KEY, pct, userId)
    .hset(ENTRIES_KEY, userId, JSON.stringify(entry))
    .exec();

  if (!pushHooks) return;
  if (!pushHooks.hasListener(userId)) {
    lastPushedTotal.delete(userId);
    return;
  }
  const last = lastPushedTotal.get(userId);
  if (!force && last !== undefined && Math.abs(total - last) < MIN_PUSH_DELTA) return;

  const rank = await redis.zrevrank(PNL_KEY, userId);
  lastPushedTotal.set(userId, total);
  pushHooks.emit(userId, {
    cash: round2(p.cash),
    holdings_value: round2(holdingsValue),
    total_value: round2(total),
    starting_cash: round2(p.startingCash),
    pnl: round2(pnl),
    pnl_pct: round2(pct),
    rank: rank === null ? null : rank + 1,
    holdings,
  });
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

  const priceCache: PriceCache = new Map();
  let count = 0;
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
    await recompute(pf.user_id, priceCache);
    count++;
  }
  return count;
}

export async function startLeaderboard(): Promise<void> {
  const count = await rebuildAll();
  console.log(`[leaderboard] rebuilt from Postgres: ${count} users`);

  // Price ticks only mark a symbol as changed. Holders are revalued once a second.
  const dirty = new Set<string>();
  const sub = redis.duplicate();
  sub.on("error", (err: unknown) => console.error("[leaderboard] redis subscriber error:", err));
  sub.on("message", (_channel: string, message: string) => {
    try {
      const t = JSON.parse(message);
      if (typeof t.symbol === "string" && (t.market === "NSE" || t.market === "CRYPTO")) {
        dirty.add(`${t.market}:${t.symbol}`);
      }
    } catch {
      /* ignore malformed ticks */
    }
  });
  await sub.subscribe(TICKS_CHANNEL);

  let running = false;
  setInterval(async () => {
    if (running || dirty.size === 0) return;
    running = true;
    try {
      const t0 = performance.now();
      const symbols = [...dirty];
      dirty.clear();
      const users = new Set<string>();
      for (const s of symbols) {
        for (const u of await redis.smembers(holdersKey(s))) users.add(u);
      }
      const priceCache: PriceCache = new Map();
      for (const u of users) await recompute(u, priceCache);
      recordRecompute(performance.now() - t0, users.size);
    } catch (err) {
      console.error("[leaderboard] recompute failed:", err);
    } finally {
      running = false;
    }
  }, RECOMPUTE_MS).unref();

  console.log("[leaderboard] live recompute running");
}