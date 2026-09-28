import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { monitorEventLoopDelay, performance } from "perf_hooks";
import type { Socket } from "socket.io-client";
import { CRYPTO_SYMBOLS } from "../lib/symbols";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

// LOAD-TEST ONLY. Remove before deploy.
//
// Usage: tsx src/scripts/loadtest-sim.ts --users 100 [--duration 60] [--warmup 20]
//        [--tick-rate 200] [--subs 3] [--ramp-rate 50] [--order-min-s 5] [--order-max-s 15]
//        [--url http://localhost:4000]
//
// Synthetic ticks carry a fractional timestamp (Date.now() + 0.5). The API passes the
// timestamp through unchanged, so a client can tell a synthetic tick from a real one and
// compute fan-out latency as Date.now() - Math.floor(timestamp).

const ROOT = path.resolve(__dirname, "../../../..");
const USERS_FILE = path.join(ROOT, ".loadtest", "users.json");
const RESULTS_DIR = path.join(ROOT, ".loadtest", "results");
const CHANNEL = "price-ticks";
const MAX_MS = 30000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;
const ns2ms = (ns: number) => Math.round((ns / 1e6) * 100) / 100;

function argStr(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function argNum(name: string, def?: number): number {
  const raw = argStr(name);
  if (raw === undefined) {
    if (def === undefined) throw new Error(`--${name} is required`);
    return def;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} must be a positive number`);
  return v;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Fixed-size millisecond histogram: cheap enough to record hundreds of thousands of samples.
class Hist {
  private b = new Uint32Array(MAX_MS + 2);
  count = 0;
  max = 0;
  add(ms: number): void {
    if (!Number.isFinite(ms)) return;
    const v = Math.max(0, Math.round(ms));
    this.b[Math.min(v, MAX_MS + 1)]++;
    this.count++;
    if (ms > this.max) this.max = ms;
  }
  pct(p: number): number {
    if (!this.count) return 0;
    const target = Math.ceil((p / 100) * this.count);
    let acc = 0;
    for (let i = 0; i < this.b.length; i++) {
      acc += this.b[i];
      if (acc >= target) return i;
    }
    return MAX_MS + 1;
  }
}

interface Bot {
  n: number;
  id: string;
  token: string;
  socket: Socket | null;
  ready: boolean;
  holdings: Map<string, number>;
  cash: number | null;
  timer: NodeJS.Timeout | null;
}

interface ApiWindow {
  seq: number;
  ts: number;
  loopLagMs: { p50: number; p95: number; p99: number; max: number };
  rssMb: number;
  heapUsedMb: number;
  priceDeliveries: number;
  portfolioDeliveries: number;
  recomputeCycles: number;
  recomputeMsAvg: number;
  recomputeMsMax: number;
  recomputeUsers: number;
}

async function main() {
  const users = Math.floor(argNum("users"));
  const duration = argNum("duration", 60);
  const warmup = argNum("warmup", 20);
  const tickRate = argNum("tick-rate", 200);
  const subsPerUser = Math.min(Math.floor(argNum("subs", 3)), CRYPTO_SYMBOLS.length);
  const rampRate = argNum("ramp-rate", 50);
  const orderMin = argNum("order-min-s", 5);
  const orderMax = argNum("order-max-s", 15);
  const BASE = argStr("url") ?? "http://localhost:4000";
  if (orderMax < orderMin) throw new Error("--order-max-s must be >= --order-min-s");

  const secret = process.env.LOAD_TEST_SECRET ?? "";
  if (secret.length < 16) throw new Error("LOAD_TEST_SECRET is missing or shorter than 16 chars in .env");

  // Dynamic imports so they run after dotenv has loaded the environment.
  const { redis } = await import("../redis");
  const { getLatestPrice } = await import("@tradekaro/shared");
  const { io } = await import("socket.io-client");

  if (!fs.existsSync(USERS_FILE)) throw new Error(`${USERS_FILE} not found. Run loadtest-seed.ts first.`);
  const list = (JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) as { n: number; id: string }[]).sort(
    (a, b) => a.n - b.n
  );
  if (list.length < users) throw new Error(`users.json has ${list.length} users, need ${users}`);

  const bots: Bot[] = list.slice(0, users).map((u) => ({
    n: u.n,
    id: u.id,
    token: `loadtest:${secret}:${u.id}`,
    socket: null,
    ready: false,
    holdings: new Map(),
    cash: null,
    timer: null,
  }));

  // ---------- preflight ----------
  const secretHeader = { "x-loadtest-secret": secret };
  const m0 = await fetch(`${BASE}/internal/metrics`, { headers: secretHeader }).catch(() => null);
  if (!m0 || !m0.ok) {
    throw new Error(
      `metrics endpoint not reachable (status ${m0 ? m0.status : "no response"}). Is pnpm dev:api running with LOAD_TEST_SECRET set?`
    );
  }
  let seq = ((await m0.json()) as { latestSeq: number }).latestSeq;

  const pre = await fetch(`${BASE}/portfolio`, {
    headers: { Authorization: `Bearer ${bots[0].token}` },
  }).catch(() => null);
  if (!pre || !pre.ok) {
    throw new Error(
      `auth preflight failed on GET /portfolio (status ${pre ? pre.status : "no response"}). If 401, the REST middleware may read the token from somewhere other than 'Authorization: Bearer'.`
    );
  }

  const live = new Map<string, number>();
  const refreshPrices = async (): Promise<number> => {
    let fresh = 0;
    for (const s of CRYPTO_SYMBOLS) {
      const l = await getLatestPrice(redis, "CRYPTO", s);
      if (l) {
        live.set(s, l.price);
        if (Date.now() - l.timestamp < 15000) fresh++;
      }
    }
    return fresh;
  };
  const freshCount = await refreshPrices();
  if (freshCount < CRYPTO_SYMBOLS.length) {
    throw new Error(
      `only ${freshCount}/${CRYPTO_SYMBOLS.length} crypto symbols have a fresh price. Is pnpm dev:worker running?`
    );
  }

  console.log(
    `preflight ok. users=${users} warmup=${warmup}s window=${duration}s tick-rate=${tickRate}/s subs=${subsPerUser} ramp=${rampRate}/s orders every ${orderMin}-${orderMax}s`
  );

  // ---------- state ----------
  let measuring = false;
  let stopping = false;
  const fan = new Hist();
  const orderHist = new Hist();
  let priceMsgs = 0;
  let synthMsgs = 0;
  let portfolioMsgs = 0;
  let publishedInWindow = 0;
  let connectErrors = 0;
  let unexpectedDisconnects = 0;
  let subscribeFailures = 0;
  let lastConnectError = "";
  const statusCounts = new Map<string, number>();
  const errorSamples: string[] = [];

  // ---------- generator's own event-loop lag ----------
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const simLag: { p95: number; p99: number; max: number }[] = [];
  const lagTimer = setInterval(() => {
    if (measuring) {
      simLag.push({
        p95: ns2ms(loop.percentile(95)),
        p99: ns2ms(loop.percentile(99)),
        max: ns2ms(loop.max),
      });
    }
    loop.reset();
  }, 1000);

  // ---------- API metrics polling ----------
  const apiWindows: ApiWindow[] = [];
  let pollErrors = 0;
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const r = await fetch(`${BASE}/internal/metrics?since=${seq}`, {
        headers: secretHeader,
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { latestSeq: number; windows: ApiWindow[] };
      apiWindows.push(...j.windows);
      seq = j.latestSeq;
    } catch {
      pollErrors++;
    } finally {
      polling = false;
    }
  };
  const pollTimer = setInterval(poll, 1000);

  // ---------- virtual users ----------
  const connect = (bot: Bot): Promise<boolean> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      const s = io(BASE, {
        auth: { token: bot.token },
        transports: ["websocket"],
        reconnection: false,
        timeout: 20000,
      });
      bot.socket = s;
      s.on("connect", () => done(true));
      s.on("connect_error", (e: Error) => {
        connectErrors++;
        lastConnectError = e.message;
        done(false);
      });
      s.on("disconnect", () => {
        if (!stopping) unexpectedDisconnects++;
      });
      s.on("price", (m: { timestamp?: unknown }) => {
        if (!measuring) return;
        priceMsgs++;
        const ts = m?.timestamp;
        if (typeof ts === "number" && !Number.isInteger(ts)) {
          synthMsgs++;
          fan.add(Date.now() - Math.floor(ts));
        }
      });
      s.on("portfolio", () => {
        if (measuring) portfolioMsgs++;
      });
    });

  const subscribe = (bot: Bot, symbols: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 15000);
      bot.socket!.emit(
        "subscribe",
        symbols.map((symbol) => ({ market: "CRYPTO", symbol })),
        (res: { ok?: boolean }) => {
          clearTimeout(t);
          resolve(!!res?.ok);
        }
      );
    });

  const bringUp = async (bot: Bot): Promise<void> => {
    if (!(await connect(bot))) return;
    const syms = shuffle([...CRYPTO_SYMBOLS]).slice(0, subsPerUser);
    if (await subscribe(bot, syms)) bot.ready = true;
    else subscribeFailures++;
  };

  const placeOrder = async (bot: Bot): Promise<void> => {
    const held = [...bot.holdings.entries()].filter(([, q]) => q > 0);
    const notional = 20 + Math.random() * 80;
    let side: "BUY" | "SELL" = held.length === 0 ? "BUY" : Math.random() < 0.5 ? "BUY" : "SELL";
    if (side === "BUY" && held.length > 0 && bot.cash !== null && bot.cash < notional * 2) side = "SELL";

    let symbol: string;
    let quantity: number;
    if (side === "BUY") {
      symbol = CRYPTO_SYMBOLS[Math.floor(Math.random() * CRYPTO_SYMBOLS.length)];
      const price = live.get(symbol);
      if (!price) return;
      quantity = Number((notional / price).toFixed(8));
    } else {
      const [sym, qty] = held[Math.floor(Math.random() * held.length)];
      symbol = sym;
      quantity = Math.random() < 0.5 ? qty : Number((qty / 2).toFixed(8));
    }
    if (!(quantity > 0)) return;

    const inWindow = measuring;
    const t0 = performance.now();
    let status = 0;
    let body: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${BASE}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot.token}` },
        body: JSON.stringify({ symbol, market: "CRYPTO", side, quantity }),
        signal: AbortSignal.timeout(20000),
      });
      status = res.status;
      body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      status = 0;
    }
    const ms = performance.now() - t0;

    if (status === 201 && body) {
      bot.holdings.set(symbol, Number(body.holding_quantity));
      bot.cash = Number(body.cash_balance);
    }
    if (inWindow) {
      orderHist.add(ms);
      const k = String(status);
      statusCounts.set(k, (statusCounts.get(k) ?? 0) + 1);
      if (status !== 201 && errorSamples.length < 5) {
        errorSamples.push(`${status} ${side} ${symbol} ${JSON.stringify(body ?? {}).slice(0, 160)}`);
      }
    }
  };

  const scheduleOrder = (bot: Bot, first: boolean) => {
    const delayMs = first ? Math.random() * orderMax * 1000 : (orderMin + Math.random() * (orderMax - orderMin)) * 1000;
    bot.timer = setTimeout(async () => {
      if (stopping) return;
      await placeOrder(bot);
      if (!stopping) scheduleOrder(bot, false);
    }, delayMs);
  };

  process.on("SIGINT", () => {
    console.log("\ninterrupted");
    process.exit(1);
  });

  // ---------- ramp ----------
  console.log("ramping up connections...");
  const batch = Math.max(1, Math.ceil(rampRate / 10));
  const rampTasks: Promise<void>[] = [];
  let nextLog = 100;
  for (let i = 0; i < bots.length; i += batch) {
    for (const bot of bots.slice(i, i + batch)) rampTasks.push(bringUp(bot));
    if (i + batch >= nextLog) {
      console.log(`  ramp: ${Math.min(i + batch, bots.length)}/${bots.length} started`);
      nextLog += 100;
    }
    await sleep(100);
  }
  await Promise.all(rampTasks);

  const readyBots = bots.filter((b) => b.ready);
  console.log(
    `connected and subscribed: ${readyBots.length}/${bots.length} (connect errors ${connectErrors}, subscribe failures ${subscribeFailures}${lastConnectError ? `, last error: ${lastConnectError}` : ""})`
  );
  if (readyBots.length === 0) throw new Error("no virtual users could connect");

  // ---------- traffic ----------
  let pubCarry = 0;
  let symIdx = 0;
  let lastTick = performance.now();
  const tickTimer = setInterval(() => {
    const now = performance.now();
    pubCarry += (tickRate * (now - lastTick)) / 1000;
    lastTick = now;
    const n = Math.floor(pubCarry);
    if (n <= 0) return;
    pubCarry -= n;
    const pipe = redis.pipeline();
    for (let k = 0; k < n; k++) {
      const symbol = CRYPTO_SYMBOLS[symIdx++ % CRYPTO_SYMBOLS.length];
      const base = live.get(symbol);
      if (!base) continue;
      const price = base * (1 + (Math.random() - 0.5) * 0.0004);
      pipe.publish(CHANNEL, JSON.stringify({ symbol, market: "CRYPTO", price, timestamp: Date.now() + 0.5 }));
      if (measuring) publishedInWindow++;
    }
    pipe.exec().catch(() => {});
  }, 50);

  let refreshing = false;
  const refreshTimer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    refreshPrices()
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
  }, 2000);

  for (const bot of readyBots) scheduleOrder(bot, true);

  console.log(`warm-up ${warmup}s (traffic running, not measured)...`);
  await sleep(warmup * 1000);

  const measureStart = Date.now();
  measuring = true;
  console.log(`measuring for ${duration}s...`);
  const progressTimer = setInterval(() => {
    const orders = [...statusCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`  t+${Math.round((Date.now() - measureStart) / 1000)}s  synthetic msgs ${synthMsgs}, orders ${orders}`);
  }, 10000);
  await sleep(duration * 1000);
  const measureEnd = Date.now();
  measuring = false;
  stopping = true;
  clearInterval(progressTimer);

  // ---------- teardown ----------
  clearInterval(tickTimer);
  clearInterval(refreshTimer);
  for (const bot of bots) {
    if (bot.timer) clearTimeout(bot.timer);
  }
  await sleep(1500);
  await poll();
  clearInterval(pollTimer);
  clearInterval(lagTimer);
  for (const bot of bots) bot.socket?.disconnect();

  // ---------- summary ----------
  const win = apiWindows.filter((w) => w.ts > measureStart && w.ts <= measureEnd + 1500);
  const maxOf = (f: (w: ApiWindow) => number) => win.reduce((m, w) => Math.max(m, f(w)), 0);
  const sumOf = (f: (w: ApiWindow) => number) => win.reduce((s, w) => s + f(w), 0);
  const cyclesTotal = sumOf((w) => w.recomputeCycles);
  const cycleWins = win.filter((w) => w.recomputeCycles > 0);

  const totalOrders = [...statusCounts.values()].reduce((a, b) => a + b, 0);
  const filled = statusCounts.get("201") ?? 0;
  const orderErrPct = totalOrders ? ((totalOrders - filled) / totalOrders) * 100 : null;

  const summary = {
    args: { users, duration, warmup, tickRate, subsPerUser, rampRate, orderMin, orderMax },
    finishedAt: new Date().toISOString(),
    connection: { requested: users, ready: readyBots.length, connectErrors, subscribeFailures, unexpectedDisconnects },
    fanout: {
      samples: fan.count,
      p50: fan.pct(50),
      p95: fan.pct(95),
      p99: fan.pct(99),
      max: Math.round(fan.max),
    },
    clientMessages: {
      priceTotal: priceMsgs,
      priceSynthetic: synthMsgs,
      portfolio: portfolioMsgs,
      perSecond: round1((priceMsgs + portfolioMsgs) / duration),
    },
    orders: {
      total: totalOrders,
      filled,
      errorPct: orderErrPct === null ? null : round1(orderErrPct),
      statusCounts: Object.fromEntries(statusCounts),
      p50: orderHist.pct(50),
      p95: orderHist.pct(95),
      p99: orderHist.pct(99),
      max: Math.round(orderHist.max),
      errorSamples,
    },
    server: {
      windows: win.length,
      loopLagWorstP95: maxOf((w) => w.loopLagMs.p95),
      loopLagWorstP99: maxOf((w) => w.loopLagMs.p99),
      loopLagWorstMax: maxOf((w) => w.loopLagMs.max),
      rssMbMax: maxOf((w) => w.rssMb),
      heapMbMax: maxOf((w) => w.heapUsedMb),
      priceDeliveriesPerSec: win.length ? Math.round(sumOf((w) => w.priceDeliveries) / win.length) : 0,
      portfolioDeliveriesPerSec: win.length ? Math.round(sumOf((w) => w.portfolioDeliveries) / win.length) : 0,
      recomputeCycles: cyclesTotal,
      recomputeMsAvg: cycleWins.length
        ? round1(cycleWins.reduce((s, w) => s + w.recomputeMsAvg, 0) / cycleWins.length)
        : 0,
      recomputeMsMax: maxOf((w) => w.recomputeMsMax),
      recomputeUsersPerCycle: cyclesTotal ? Math.round(sumOf((w) => w.recomputeUsers) / cyclesTotal) : 0,
      pollErrors,
    },
    generator: {
      loopLagWorstP99: simLag.reduce((m, w) => Math.max(m, w.p99), 0),
      loopLagWorstMax: simLag.reduce((m, w) => Math.max(m, w.max), 0),
      syntheticTicksPublished: publishedInWindow,
    },
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `stage-${users}u-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  const line = (k: string, v: string) => console.log(`  ${k.padEnd(36)} ${v}`);
  const verdict = (ok: boolean | null) => (ok === null ? "n/a" : ok ? "PASS" : "FAIL");
  const s = summary;

  console.log("\n===== RESULT =====");
  line("users ready", `${s.connection.ready}/${s.connection.requested} (unexpected disconnects ${s.connection.unexpectedDisconnects})`);
  line("fan-out latency p50/p95/p99/max", `${s.fanout.p50} / ${s.fanout.p95} / ${s.fanout.p99} / ${s.fanout.max} ms  (${s.fanout.samples} samples)`);
  line("client msgs/sec (price+portfolio)", `${s.clientMessages.perSecond}`);
  line("price msgs: synthetic / all", `${s.clientMessages.priceSynthetic} / ${s.clientMessages.priceTotal}`);
  line("server deliveries/sec price, pf", `${s.server.priceDeliveriesPerSec}, ${s.server.portfolioDeliveriesPerSec}`);
  line("orders total / filled / error %", `${s.orders.total} / ${s.orders.filled} / ${s.orders.errorPct === null ? "n/a" : s.orders.errorPct}`);
  line("order status counts", JSON.stringify(s.orders.statusCounts));
  line("order latency p50/p95/p99/max", `${s.orders.p50} / ${s.orders.p95} / ${s.orders.p99} / ${s.orders.max} ms`);
  line("recompute avg/max ms, users/cycle", `${s.server.recomputeMsAvg} / ${s.server.recomputeMsMax} ms, ${s.server.recomputeUsersPerCycle}`);
  line("API loop lag worst p95/p99/max", `${s.server.loopLagWorstP95} / ${s.server.loopLagWorstP99} / ${s.server.loopLagWorstMax} ms`);
  line("API rss / heap max", `${s.server.rssMbMax} / ${s.server.heapMbMax} MB`);
  line("generator loop lag worst p99/max", `${s.generator.loopLagWorstP99} / ${s.generator.loopLagWorstMax} ms`);
  for (const e of s.orders.errorSamples) line("error sample", e);

  console.log("\n  criteria (defined for the 500-user stage):");
  line("fan-out p95 < 500ms", verdict(s.fanout.samples ? s.fanout.p95 < 500 : null));
  line("order error rate < 1%", verdict(s.orders.errorPct === null ? null : s.orders.errorPct < 1));
  line("API loop lag (worst 1s p99) < 100ms", verdict(win.length ? s.server.loopLagWorstP99 < 100 : null));

  const warnings: string[] = [];
  if (s.generator.loopLagWorstP99 > 100) warnings.push("generator loop lag is high: the load generator is a bottleneck, results are not trustworthy");
  if (s.fanout.samples === 0) warnings.push("no synthetic ticks were received: the fractional-timestamp marker did not survive, or nobody was subscribed");
  if (s.connection.ready < users) warnings.push(`only ${s.connection.ready}/${users} users connected`);
  if (s.server.windows < duration * 0.8) warnings.push(`API metrics incomplete (${s.server.windows} windows for ${duration}s, poll errors ${pollErrors})`);
  for (const w of warnings) console.log(`  WARNING: ${w}`);
  console.log(`\n  saved ${outFile}`);

  await redis.quit().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("simulator failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});