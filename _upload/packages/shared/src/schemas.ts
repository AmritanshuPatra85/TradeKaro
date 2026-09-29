import { z } from "zod";

export const MarketSchema = z.enum(["NSE", "CRYPTO"]);
export type Market = z.infer<typeof MarketSchema>;

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
