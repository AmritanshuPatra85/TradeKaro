import Redis from "ioredis";
import { applyTick } from "./candleAggregator";
import { persistCandle } from "./candleWriter";
import { isMarketOpen } from "../market-hours";
import type { PriceTick } from "@tradekaro/shared";

export function startPriceFeedSubscriber(): void {
  const subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

  subscriber.subscribe("price-ticks", (err) => {
    if (err) {
      console.error("[persistence] failed to subscribe to price-ticks:", err);
      return;
    }
    console.log("[persistence] subscribed to price-ticks");
  });

  subscriber.on("message", async (_channel, raw) => {
    let tick: PriceTick;
    try {
      tick = JSON.parse(raw);
    } catch {
      return;
    }

    // LOAD-TEST ONLY: the load simulator marks synthetic ticks with a fractional
    // timestamp. Never let them into real candles. Remove before deploy.
    if (typeof tick.timestamp === "number" && !Number.isInteger(tick.timestamp)) {
      return;
    }

    if (!isMarketOpen(tick.market)) {
      // Defensive guard — shouldn't normally fire for NSE since Breeze
      // itself won't push outside market hours, but stops a stray tick
      // from corrupting a candle if it ever does.
      return;
    }

    const finalizedCandle = applyTick(tick);
    if (finalizedCandle) {
      await persistCandle(finalizedCandle);
    }
  });
}