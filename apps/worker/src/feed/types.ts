export type Market = "NSE" | "CRYPTO";

export type PriceTick = {
  symbol: string;
  market: Market;
  price: number;
  timestamp: number;
};
