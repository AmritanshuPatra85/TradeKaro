import type { Market } from "@/lib/api/types";

export interface Instrument {
  symbol: string;
  market: Market;
  name: string;
  quoteCurrency: "INR" | "USDT";
}

// Kept aligned with apps/api/src/lib/symbols.ts; the API and socket server
// validate each symbol against these exact supported sets.
export const INSTRUMENTS: Record<Market, readonly Instrument[]> = {
  NSE: [
    { symbol: "RELIANCE", market: "NSE", name: "Reliance Industries", quoteCurrency: "INR" },
    { symbol: "TCS", market: "NSE", name: "Tata Consultancy Services", quoteCurrency: "INR" },
    { symbol: "INFY", market: "NSE", name: "Infosys", quoteCurrency: "INR" },
    { symbol: "HDFCBANK", market: "NSE", name: "HDFC Bank", quoteCurrency: "INR" },
    { symbol: "ICICIBANK", market: "NSE", name: "ICICI Bank", quoteCurrency: "INR" },
    { symbol: "SBIN", market: "NSE", name: "State Bank of India", quoteCurrency: "INR" },
    { symbol: "TATASTEEL", market: "NSE", name: "Tata Steel", quoteCurrency: "INR" },
    { symbol: "WIPRO", market: "NSE", name: "Wipro", quoteCurrency: "INR" },
    { symbol: "ITC", market: "NSE", name: "ITC Limited", quoteCurrency: "INR" },
    { symbol: "AXISBANK", market: "NSE", name: "Axis Bank", quoteCurrency: "INR" },
  ],
  CRYPTO: [
    { symbol: "BTCUSDT", market: "CRYPTO", name: "Bitcoin", quoteCurrency: "USDT" },
    { symbol: "ETHUSDT", market: "CRYPTO", name: "Ethereum", quoteCurrency: "USDT" },
    { symbol: "BNBUSDT", market: "CRYPTO", name: "BNB", quoteCurrency: "USDT" },
    { symbol: "SOLUSDT", market: "CRYPTO", name: "Solana", quoteCurrency: "USDT" },
    { symbol: "XRPUSDT", market: "CRYPTO", name: "XRP", quoteCurrency: "USDT" },
    { symbol: "ADAUSDT", market: "CRYPTO", name: "Cardano", quoteCurrency: "USDT" },
    { symbol: "DOGEUSDT", market: "CRYPTO", name: "Dogecoin", quoteCurrency: "USDT" },
    { symbol: "DOTUSDT", market: "CRYPTO", name: "Polkadot", quoteCurrency: "USDT" },
    { symbol: "AVAXUSDT", market: "CRYPTO", name: "Avalanche", quoteCurrency: "USDT" },
    { symbol: "LINKUSDT", market: "CRYPTO", name: "Chainlink", quoteCurrency: "USDT" },
    { symbol: "LTCUSDT", market: "CRYPTO", name: "Litecoin", quoteCurrency: "USDT" },
    { symbol: "ATOMUSDT", market: "CRYPTO", name: "Cosmos", quoteCurrency: "USDT" },
    { symbol: "UNIUSDT", market: "CRYPTO", name: "Uniswap", quoteCurrency: "USDT" },
    { symbol: "NEARUSDT", market: "CRYPTO", name: "NEAR Protocol", quoteCurrency: "USDT" },
    { symbol: "FILUSDT", market: "CRYPTO", name: "Filecoin", quoteCurrency: "USDT" },
    { symbol: "XLMUSDT", market: "CRYPTO", name: "Stellar", quoteCurrency: "USDT" },
    { symbol: "TRXUSDT", market: "CRYPTO", name: "TRON", quoteCurrency: "USDT" },
    { symbol: "ETCUSDT", market: "CRYPTO", name: "Ethereum Classic", quoteCurrency: "USDT" },
    { symbol: "SHIBUSDT", market: "CRYPTO", name: "Shiba Inu", quoteCurrency: "USDT" },
    { symbol: "POLUSDT", market: "CRYPTO", name: "POL", quoteCurrency: "USDT" },
  ],
};

export function findInstrument(market: Market, symbol: string) {
  return INSTRUMENTS[market].find((instrument) => instrument.symbol === symbol) ?? null;
}
