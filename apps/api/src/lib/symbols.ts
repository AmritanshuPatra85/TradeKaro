// Symbols the platform actually streams. Keep in sync with
// apps/worker/src/breeze/watchlist.ts (NSE tickers) and
// apps/worker/src/index.ts (crypto pairs).
export const NSE_SYMBOLS = [
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
  "SBIN", "TATASTEEL", "WIPRO", "ITC", "AXISBANK",
] as const;

export const CRYPTO_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
  "LTCUSDT", "ATOMUSDT", "UNIUSDT", "NEARUSDT", "FILUSDT",
  "XLMUSDT", "TRXUSDT", "ETCUSDT", "SHIBUSDT", "POLUSDT",
] as const;

export type Market = "NSE" | "CRYPTO";

const ALLOWED: Record<Market, ReadonlySet<string>> = {
  NSE: new Set<string>(NSE_SYMBOLS),
  CRYPTO: new Set<string>(CRYPTO_SYMBOLS),
};

export function isAllowedSymbol(market: Market, symbol: string): boolean {
  return ALLOWED[market].has(symbol);
}
