import { redis } from "../redis";
import { cacheLatestPrice, setFeedHeartbeat } from "@tradekaro/shared";
import type { PriceTick } from "./types";

export const PRICE_TICKS_CHANNEL = "price-ticks";

export async function publishTick(tick: PriceTick): Promise<void> {
  await cacheLatestPrice(redis, tick as unknown as Parameters<typeof cacheLatestPrice>[1]);
  // Crypto feed-liveness heartbeat, written on ANY symbol's tick so quiet coins
  // do not make a healthy feed look dead. NSE's is written in breeze/stream.ts.
  if (tick.market === "CRYPTO") await setFeedHeartbeat(redis, "CRYPTO");
  await redis.publish(PRICE_TICKS_CHANNEL, JSON.stringify(tick));
}