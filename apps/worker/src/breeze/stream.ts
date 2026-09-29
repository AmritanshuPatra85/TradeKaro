import { getBreezeClient } from "./client";
import { WATCHLIST } from "./watchlist";
import { publishTick } from "../feed/publish";
import { redis } from "../redis";
import { setFeedHeartbeat } from "@tradekaro/shared";
import type { PriceTick } from "@tradekaro/shared";

const TICKER_BY_TOKEN = new Map(WATCHLIST.map((e) => [e.token, e.ticker]));
const lastSeen = new Map<string, string>();
const seenFirst = new Set<string>();
let rawLogged = 0;

export function connectBreezeStream(): void {
  const client = getBreezeClient();

  client.onTicks = async (raw: unknown) => {
    if (rawLogged < 3) {
      rawLogged++;
      console.log("[breeze] raw tick:", raw);
    }

    // Any Breeze payload proves the feed is alive, even if it is a repeat.
    if (raw && typeof raw === "object") {
      setFeedHeartbeat(redis, "NSE").catch((err: unknown) =>
        console.error("[breeze] heartbeat write failed:", err)
      );
    }

    const tick = normalizeTick(raw);
    if (!tick) return;

    if (!seenFirst.has(tick.symbol)) {
      seenFirst.add(tick.symbol);
      console.log(`[breeze] first tick ${tick.symbol} price=${tick.price}`);
    }
    await publishTick(tick);
  };

  client.wsConnect();

  for (const entry of WATCHLIST) {
    if (!entry.token) {
      console.warn(`[breeze] skipping ${entry.symbol} - no token set in watchlist.ts`);
      continue;
    }
    client
      .subscribeFeeds({ stockToken: `4.1!${entry.token}` })
      .catch((err: unknown) =>
        console.error(`[breeze] subscribe failed for ${entry.symbol}:`, err)
      );
  }
}

export function disconnectBreezeStream(): void {
  getBreezeClient().wsDisconnect();
}

// Breeze payload: { symbol: "4.1!<token>", last, open, high, low, close,
// change (percent), ltt (IST string, no tz), ttq, ... }
function normalizeTick(raw: unknown): PriceTick | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const token = String(r.symbol ?? "").split("!")[1];
  const ticker = token ? TICKER_BY_TOKEN.get(token) : undefined;
  if (!ticker) return null;

  const price = Number(r.last);
  if (!Number.isFinite(price) || price <= 0) return null;

  // The SDK re-emits the same quote several times; skip exact repeats.
  const key = `${r.ltt}|${r.last}|${r.ttq}`;
  if (lastSeen.get(ticker) === key) return null;
  lastSeen.set(ticker, key);

  // ltt has no timezone (IST), so stamp with local receive time instead.
  return { symbol: ticker, market: "NSE", price, timestamp: Date.now() };
}
