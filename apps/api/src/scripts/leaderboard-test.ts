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

async function call(path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function main() {
  check("401 without token", (await call("/leaderboard")).status === 401);

  const tA = await guest();
  const tB = await guest();
  check("400 on bad limit", (await call("/leaderboard?limit=0", tA)).status === 400);

  const a = await call("/orders", tA, { symbol: "BTCUSDT", market: "CRYPTO", side: "BUY", quantity: 0.5 });
  const b = await call("/orders", tB, { symbol: "ETHUSDT", market: "CRYPTO", side: "BUY", quantity: 0.01 });
  check("both trades filled", a.status === 201 && b.status === 201, `${a.status}, ${b.status}`);

  await sleep(1500);
  const lb = await call("/leaderboard?limit=20", tA);
  check("leaderboard responds", lb.status === 200);
  check("you is present with a rank", lb.json?.you && Number.isInteger(lb.json.you.rank), `rank ${lb.json?.you?.rank}`);
  check("at least 2 users ranked", (lb.json?.total_users ?? 0) >= 2, `${lb.json?.total_users} users`);

  const pcts: number[] = (lb.json?.leaderboard ?? []).map((e: any) => e.pnl_pct);
  const sorted = pcts.every((v, i) => i === 0 || pcts[i - 1] >= v);
  check("entries sorted by pnl_pct descending", sorted, `${pcts.length} rows`);

  const one = await call("/leaderboard?limit=1", tA);
  check("limit=1 returns one row", one.json?.leaderboard?.length === 1);

  // Live check: A holds 0.5 BTC, so A's P&L should move as BTC moves.
  console.log("watching A's P&L for 20 seconds...");
  const series: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await call("/leaderboard?limit=5", tA);
    series.push(r.json?.you?.pnl);
    await sleep(2000);
  }
  console.log(`A pnl series: ${series.join(", ")}`);
  const distinct = new Set(series).size;
  check("P&L moves with the price (>=2 distinct values)", distinct >= 2, `${distinct} distinct`);

  // Consistency: leaderboard total vs GET /portfolio, allowing for price movement in between.
  const pf = await call("/portfolio", tA);
  const lbNow = await call("/leaderboard?limit=1", tA);
  const diff = Math.abs((pf.json?.total_value ?? 0) - (lbNow.json?.you?.total_value ?? 0));
  check("leaderboard total matches /portfolio (within 100)", diff < 100, `diff ${diff.toFixed(2)}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
