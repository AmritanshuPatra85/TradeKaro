import type { PriceTick, Candle } from "@tradekaro/shared";

const TIMEFRAME_MS = 60 * 1000;

interface OpenCandle {
  bucketStart: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const openCandles = new Map<string, OpenCandle>();

function keyFor(symbol: string, market: string): string {
  return `${market}:${symbol}`;
}

function bucketStartFor(timestamp: number): number {
  return Math.floor(timestamp / TIMEFRAME_MS) * TIMEFRAME_MS;
}

// Feeds a tick into the in-progress candle for its symbol. Returns the
// finalized previous candle if this tick just opened a new minute bucket
// (meaning the prior bucket is done and ready to persist), else null.
export function applyTick(tick: PriceTick): Candle | null {
  const key = keyFor(tick.symbol, tick.market);
  const bucketStart = bucketStartFor(tick.timestamp);
  const existing = openCandles.get(key);

  if (!existing || existing.bucketStart !== bucketStart) {
    const finalized = existing
      ? toCandle(tick.symbol, tick.market as Candle["market"], existing)
      : null;

    openCandles.set(key, {
      bucketStart,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
    });

    return finalized;
  }

  existing.high = Math.max(existing.high, tick.price);
  existing.low = Math.min(existing.low, tick.price);
  existing.close = tick.price;
  return null;
}

function toCandle(symbol: string, market: Candle["market"], c: OpenCandle): Candle {
  return {
    symbol,
    market,
    timeframe: "1m",
    bucketStart: c.bucketStart,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}
