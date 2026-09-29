import { z } from "zod";
import { MarketSchema } from "./schemas";

export const TimeframeSchema = z.enum(["1m"]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const CandleSchema = z.object({
  symbol: z.string(),
  market: MarketSchema,
  timeframe: TimeframeSchema,
  bucketStart: z.number(), // epoch ms — start of the candle's minute
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
});
export type Candle = z.infer<typeof CandleSchema>;
