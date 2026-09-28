import { io } from "socket.io-client";

const API = process.env.API ?? "http://localhost:4000";
const SB = "https://oiwjvjzwzoajcyauojnl.supabase.co";
const KEY = "sb_publishable_mF4DLKyui1dM7nl_cwxWRw_rx4JHYA_";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (name: string, ok: boolean, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);

async function guest(): Promise<string> {
  const r = await fetch(`${SB}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: "{}",
  });
  const j: any = await r.json();
  return j.access_token as string;
}

async function call(path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function waitFor(fn: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

function connect(token: string) {
  const s = io(API, { auth: { token }, reconnection: false });
  const msgs: any[] = [];
  s.on("portfolio", (m: any) => msgs.push(m));
  const ready = new Promise<void>((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", (e) => reject(e));
  });
  return { s, msgs, ready };
}

async function main() {
  const tA = await guest();
  const tB = await guest();
  const A = connect(tA);
  const B = connect(tB);
  await Promise.all([A.ready, B.ready]);
  check("both sockets connect", true);

  const gotInitial = await waitFor(() => A.msgs.length >= 1 && B.msgs.length >= 1, 5000);
  check("initial snapshot arrives on connect", gotInitial);
  check(
    "initial snapshot is a fresh 100000 portfolio",
    A.msgs[0]?.total_value === 100000 && A.msgs[0]?.holdings?.length === 0,
    `A total=${A.msgs[0]?.total_value}`
  );

  const trade = await call("/orders", tA, { symbol: "BTCUSDT", market: "CRYPTO", side: "BUY", quantity: 0.5 });
  check("A's BUY filled", trade.status === 201, String(trade.status));

  const gotTradePush = await waitFor(() => A.msgs.some((m) => m.holdings?.length === 1), 5000);
  check("trade triggers an immediate push with the holding", gotTradePush);

  const startCount = A.msgs.length;
  console.log("watching for 15 seconds...");
  await sleep(15_000);

  const during = A.msgs.slice(startCount);
  const totals = new Set(during.map((m) => m.total_value));
  check("price moves produce further pushes (>=2)", during.length >= 2, `${during.length} pushes`);
  check("pushes carry changing values", totals.size >= 2, `${totals.size} distinct totals`);
  check("push rate is at most about 1 per second", during.length <= 20, `${during.length} in 15s`);
  check("pushes include an integer rank", Number.isInteger(A.msgs[A.msgs.length - 1]?.rank));

  check(
    "B received no updates beyond its initial snapshot",
    B.msgs.length === 1,
    `${B.msgs.length} messages`
  );
  check(
    "A's messages only ever contain A's own holdings",
    A.msgs.every((m) => m.holdings.every((h: any) => h.symbol === "BTCUSDT"))
  );

  const pf = await call("/portfolio", tA);
  const last = A.msgs[A.msgs.length - 1];
  const diff = Math.abs((pf.json?.total_value ?? 0) - (last?.total_value ?? 0));
  check("last push matches GET /portfolio (within 100)", diff < 100, `diff ${diff.toFixed(2)}`);

  A.s.close();
  B.s.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
