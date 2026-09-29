import { Router, type Request, type Response } from "express";
import { CandleResponseSchema, CandleSchema, type Candle, type Market, TimeframeSchema } from "@tradekaro/shared";
import { supabaseAdmin } from "../lib/supabase";
import { isAllowedSymbol } from "../lib/symbols";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

interface CandleRow {
  symbol: string;
  market: string;
  timeframe: string;
  bucket_start: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandleQuery {
  market: Market;
  symbol: string;
  limit: number;
}

export type CandleReader = (query: CandleQuery) => Promise<Candle[]>;

function parseSingleQueryValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function parseCandleQuery(req: Request): CandleQuery | string {
  const marketValue = parseSingleQueryValue(req.query.market);
  if (marketValue !== "NSE" && marketValue !== "CRYPTO") {
    return "market must be NSE or CRYPTO";
  }

  const symbolValue = parseSingleQueryValue(req.query.symbol);
  if (!symbolValue) return "symbol is required";
  const symbol = symbolValue.toUpperCase();
  if (!isAllowedSymbol(marketValue, symbol)) {
    return `${symbol} is not a supported ${marketValue} symbol`;
  }

  let limit = DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    const value = parseSingleQueryValue(req.query.limit);
    if (!value || !/^\d+$/.test(value)) {
      return `limit must be a whole number from 1 to ${MAX_LIMIT}`;
    }
    limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return `limit must be a whole number from 1 to ${MAX_LIMIT}`;
    }
  }

  return { market: marketValue, symbol, limit };
}

export function mapCandleRow(row: CandleRow): Candle {
  const bucketStart = Date.parse(row.bucket_start);
  return CandleSchema.parse({
    symbol: row.symbol,
    market: row.market,
    timeframe: row.timeframe,
    bucketStart,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
  });
}

const readPersistedCandles: CandleReader = async ({ market, symbol, limit }) => {
  const { data, error } = await supabaseAdmin
    .from("candles")
    .select("symbol, market, timeframe, bucket_start, open, high, low, close")
    .eq("market", market)
    .eq("symbol", symbol)
    .eq("timeframe", "1m")
    // Select the most recent window; the router sorts it ascending for charts.
    .order("bucket_start", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapCandleRow(row as CandleRow));
};

export function createMarketRouter(readCandles: CandleReader = readPersistedCandles) {
  const router = Router();

  router.get("/market/candles", async (req: Request, res: Response) => {
    const query = parseCandleQuery(req);
    if (typeof query === "string") return res.status(400).json({ error: query });

    try {
      const candles = (await readCandles(query)).sort((left, right) => left.bucketStart - right.bucketStart);
      const timeframe = TimeframeSchema.parse("1m");
      return res.json(CandleResponseSchema.parse({ market: query.market, symbol: query.symbol, timeframe, candles }));
    } catch (error) {
      console.error("[market] failed to read candles:", error);
      return res.status(500).json({ error: "Could not load market candles" });
    }
  });

  return router;
}

export default createMarketRouter();
