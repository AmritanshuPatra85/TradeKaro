import { z } from "zod";

export const MarketSchema = z.enum(["NSE", "CRYPTO"]);
export type Market = z.infer<typeof MarketSchema>;

export const CurrencySchema = z.enum(["INR", "USDT"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const FxRateSchema = z.object({
  base: z.literal("USDT"),
  quote: z.literal("INR"),
  rate: z.number().positive(),
  timestamp: z.number().int().positive(),
  source: z.string().min(1),
});
export type FxRate = z.infer<typeof FxRateSchema>;

export function convertToInr(amount: number, currency: Currency, fxRate: FxRate | null): number {
  if (!Number.isFinite(amount)) throw new Error("amount must be finite");
  if (currency === "INR") return amount;
  if (!fxRate || fxRate.base !== "USDT" || fxRate.quote !== "INR") {
    throw new Error("a valid USDT/INR quote is required");
  }
  return amount * fxRate.rate;
}

export const PortfolioHoldingSchema = z.object({
  symbol: z.string(),
  market: MarketSchema,
  quantity: z.number(),
  quote_currency: CurrencySchema,
  avg_cost: z.number(),
  avg_cost_inr: z.number(),
  price: z.number().nullable(),
  value: z.number(),
  unrealized_pnl: z.number(),
});
export type PortfolioHolding = z.infer<typeof PortfolioHoldingSchema>;

export const PortfolioSchema = z.object({
  base_currency: z.literal("INR"),
  fx_rate: FxRateSchema.nullable(),
  cash: z.number(),
  holdings_value: z.number(),
  total_value: z.number(),
  starting_cash: z.number(),
  pnl: z.number(),
  pnl_pct: z.number(),
  holdings: z.array(PortfolioHoldingSchema),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  display_name: z.string(),
  total_value: z.number(),
  pnl: z.number(),
  pnl_pct: z.number(),
  is_you: z.boolean().optional(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardUpdateSchema = z.object({
  base_currency: z.literal("INR"),
  fx_rate: FxRateSchema,
  leaderboard: z.array(LeaderboardEntrySchema),
  total_users: z.number().int().nonnegative(),
  updated_at: z.number().int().positive(),
});
export type LeaderboardUpdate = z.infer<typeof LeaderboardUpdateSchema>;

export const LeaderboardResponseSchema = z.object({
  base_currency: z.literal("INR"),
  fx_rate: FxRateSchema,
  leaderboard: z.array(LeaderboardEntrySchema),
  you: LeaderboardEntrySchema.nullable(),
  total_users: z.number().int().nonnegative(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const PriceTickSchema = z.object({
  symbol: z.string(),
  market: MarketSchema,
  price: z.number().positive(),
  timestamp: z.number(),
});
export type PriceTick = z.infer<typeof PriceTickSchema>;

export const OrderSideSchema = z.enum(["BUY", "SELL"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  symbol: z.string(),
  market: MarketSchema,
  side: OrderSideSchema,
  quantity: z.number().positive(),
  requestedAt: z.number(),
});
export type Order = z.infer<typeof OrderSchema>;

export const TradeSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  symbol: z.string(),
  market: MarketSchema,
  side: OrderSideSchema,
  quantity: z.number().positive(),
  fillPrice: z.number().positive(),
  executedAt: z.number(),
});
export type Trade = z.infer<typeof TradeSchema>;
