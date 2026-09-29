import type { PriceTick } from "./schemas";

// Called from publishTick(), so both feeds get cached the same way
// through one choke point instead of duplicating this in each stream handler.
export async function cacheLatestPrice(
  redis: { set: (key: string, val: string) => Promise<unknown> },
  tick: PriceTick
): Promise<void> {
  await redis.set(
    `latest:${tick.market}:${tick.symbol}`,
    JSON.stringify({ price: tick.price, timestamp: tick.timestamp })
  );
}

export async function getLatestPrice(
  redis: { get: (key: string) => Promise<string | null> },
  market: PriceTick["market"],
  symbol: string
): Promise<{ price: number; timestamp: number } | null> {
  const raw = await redis.get(`latest:${market}:${symbol}`);
  return raw ? JSON.parse(raw) : null;
}

// Feed-liveness heartbeat: written on every tick from ANY symbol of a market,
// so quiet stocks don't look stale while the feed itself is alive.
export async function setFeedHeartbeat(
  redis: { set: (key: string, val: string) => Promise<unknown> },
  market: PriceTick["market"]
): Promise<void> {
  await redis.set(`feed:heartbeat:${market}`, String(Date.now()));
}

export async function getFeedHeartbeatAgeMs(
  redis: { get: (key: string) => Promise<string | null> },
  market: PriceTick["market"]
): Promise<number | null> {
  const raw = await redis.get(`feed:heartbeat:${market}`);
  if (!raw) return null;
  const ts = Number(raw);
  return Number.isFinite(ts) ? Date.now() - ts : null;
}
