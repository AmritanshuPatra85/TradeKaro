import { redis } from "../redis";
import { cacheLatestPrice } from "@tradekaro/shared";
import type { PriceTick } from "./types";

export const PRICE_TICKS_CHANNEL = "price-ticks";

export async function publishTick(tick: PriceTick): Promise<void> {
  await cacheLatestPrice(redis, tick as unknown as Parameters<typeof cacheLatestPrice>[1]);
  await redis.publish(PRICE_TICKS_CHANNEL, JSON.stringify(tick));
}
