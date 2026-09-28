import { io } from "socket.io-client";

const URL = process.env.URL ?? "http://localhost:4000";
const token = process.env.TOKEN ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (name: string, ok: boolean, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);

interface PriceMsg {
  market: string;
  symbol: string;
  price: number;
  timestamp: number;
  snapshot?: boolean;
}

async function main() {
  // 1. A socket with no token must be rejected.
  await new Promise<void>((resolve) => {
    const s = io(URL, { auth: {}, reconnection: false });
    s.on("connect_error", (err) => {
      check("rejects missing token", err.message === "missing token", err.message);
      s.close();
      resolve();
    });
    s.on("connect", () => {
      check("rejects missing token", false, "connected anyway");
      s.close();
      resolve();
    });
  });

  // 2. A socket with a valid token connects.
  const s = io(URL, { auth: { token }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", (e) => reject(e));
  });
  check("connects with valid token", true);

  const counts = new Map<string, number>();
  const snapshots = new Set<string>();
  s.on("price", (t: PriceMsg) => {
    const k = `${t.market}:${t.symbol}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (t.snapshot) snapshots.add(k);
  });

  const emitAck = (ev: string, payload: unknown) =>
    new Promise<any>((resolve) => s.emit(ev, payload, resolve));

  // 3. Unknown symbols are refused.
  const bad = await emitAck("subscribe", [{ market: "NSE", symbol: "FAKE" }]);
  check("rejects unknown symbol", bad?.ok === false, bad?.error);

  // 4. Subscribe to one stock and two crypto pairs.
  const ok = await emitAck("subscribe", [
    { market: "NSE", symbol: "ITC" },
    { market: "CRYPTO", symbol: "BTCUSDT" },
    { market: "CRYPTO", symbol: "ETHUSDT" },
  ]);
  check("subscribes to 3 symbols", ok?.ok === true);

  console.log("listening for 10 seconds...");
  await sleep(10_000);

  check("snapshot for ITC", snapshots.has("NSE:ITC"));
  check("snapshot for BTCUSDT", snapshots.has("CRYPTO:BTCUSDT"));
  const btc = counts.get("CRYPTO:BTCUSDT") ?? 0;
  const eth = counts.get("CRYPTO:ETHUSDT") ?? 0;
  // 250ms coalescing means at most 4 per second per symbol: 40 in 10s, plus the snapshot.
  check("BTC ticks arrive and are throttled (1-45)", btc >= 1 && btc <= 45, `${btc} messages in 10s`);
  check("ETH ticks arrive and are throttled (1-45)", eth >= 1 && eth <= 45, `${eth} messages in 10s`);
  console.log(`counts: ${JSON.stringify(Object.fromEntries(counts))}`);

  // 5. After unsubscribing, BTC must go quiet.
  await emitAck("unsubscribe", [{ market: "CRYPTO", symbol: "BTCUSDT" }]);
  await sleep(500);
  counts.set("CRYPTO:BTCUSDT", 0);
  await sleep(2_000);
  const after = counts.get("CRYPTO:BTCUSDT") ?? 0;
  const ethAfter = counts.get("CRYPTO:ETHUSDT") ?? 0;
  check("no BTC messages after unsubscribe", after === 0, `${after} messages`);
  check("ETH still streaming", ethAfter > 0, `${ethAfter} messages`);

  s.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
