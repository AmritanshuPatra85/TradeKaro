import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
import { CRYPTO_SYMBOLS } from "../lib/symbols";

// Read-only diagnostic: samples the price cache twice a second and reports, per symbol,
// how old the cached price gets. Age is measured the same way POST /orders measures it.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Stat {
  lastTs: number;
  lastChangeAt: number;
  changes: number;
  samples: number;
  over15: number;
  minAge: number;
  maxAge: number;
  maxGap: number;
}

async function main() {
  const i = process.argv.indexOf("--seconds");
  const seconds = i >= 0 ? Number(process.argv[i + 1]) || 90 : 90;
  const { redis } = await import("../redis");
  const { getLatestPrice } = await import("@tradekaro/shared");

  const stats = new Map<string, Stat>();
  const t0 = Date.now();
  const end = t0 + seconds * 1000;
  console.log(`sampling ${CRYPTO_SYMBOLS.length} symbols for ${seconds}s (simulator must be stopped)...`);

  while (Date.now() < end) {
    const now = Date.now();
    for (const sym of CRYPTO_SYMBOLS) {
      const l = await getLatestPrice(redis, "CRYPTO", sym);
      if (!l) continue;
      const age = now - l.timestamp;
      let st = stats.get(sym);
      if (!st) {
        st = { lastTs: l.timestamp, lastChangeAt: now, changes: 0, samples: 0, over15: 0, minAge: age, maxAge: age, maxGap: 0 };
        stats.set(sym, st);
      }
      st.samples++;
      if (age > 15000) st.over15++;
      st.minAge = Math.min(st.minAge, age);
      st.maxAge = Math.max(st.maxAge, age);
      if (l.timestamp !== st.lastTs) {
        st.maxGap = Math.max(st.maxGap, now - st.lastChangeAt);
        st.lastChangeAt = now;
        st.lastTs = l.timestamp;
        st.changes++;
      }
    }
    await sleep(500);
  }

  const done = Date.now();
  const rows = [...stats.entries()].map(([sym, st]) => ({
    sym,
    changes: st.changes,
    minAge: st.minAge,
    maxAge: st.maxAge,
    maxGap: Math.max(st.maxGap, done - st.lastChangeAt),
    pctOver15: st.samples ? Math.round((st.over15 / st.samples) * 1000) / 10 : 0,
  }));
  rows.sort((a, b) => b.maxAge - a.maxAge);

  console.log("\nsymbol      changes  minAge(ms)  maxAge(ms)  maxGap(ms)  %samples>15s");
  for (const r of rows) {
    console.log(
      `${r.sym.padEnd(10)}  ${String(r.changes).padStart(7)}  ${String(r.minAge).padStart(10)}  ${String(r.maxAge).padStart(10)}  ${String(r.maxGap).padStart(10)}  ${String(r.pctOver15).padStart(11)}`
    );
  }
  const missing = CRYPTO_SYMBOLS.filter((s) => !stats.has(s));
  if (missing.length) console.log(`\nno cached price at all: ${missing.join(", ")}`);

  await redis.quit().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});