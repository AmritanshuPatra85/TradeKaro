import { supabase } from "./db";
import type { Candle } from "@tradekaro/shared";

export async function persistCandle(candle: Candle): Promise<void> {
  const { error } = await supabase.from("candles").upsert(
    {
      symbol: candle.symbol,
      market: candle.market,
      timeframe: candle.timeframe,
      bucket_start: new Date(candle.bucketStart).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    },
    { onConflict: "symbol,market,timeframe,bucket_start" }
  );

  if (error) {
    console.error("[candles] failed to persist candle:", error.message);
  }
}
