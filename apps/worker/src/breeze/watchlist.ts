// Breeze identifies instruments by ISEC numeric token, not by symbol.
// Tokens come from ICICI's NSEScripMaster.txt (Token + ShortName, Series EQ).
export interface WatchlistEntry {
  symbol: string; // Breeze stock_code (ICICI short name)
  ticker: string; // plain NSE ticker used internally and by the frontend
  token: string;  // ISEC numeric token, e.g. "2885" for Reliance
}

export const WATCHLIST: WatchlistEntry[] = [
  { symbol: "RELIND", ticker: "RELIANCE", token: "2885" },
  { symbol: "TCS", ticker: "TCS", token: "11536" },
  { symbol: "INFTEC", ticker: "INFY", token: "1594" },
  { symbol: "HDFBAN", ticker: "HDFCBANK", token: "1333" },
  { symbol: "ICIBAN", ticker: "ICICIBANK", token: "4963" },
  { symbol: "STABAN", ticker: "SBIN", token: "3045" },
  { symbol: "TATSTE", ticker: "TATASTEEL", token: "3499" },
  { symbol: "WIPRO", ticker: "WIPRO", token: "3787" },
  { symbol: "ITC", ticker: "ITC", token: "1660" },
  { symbol: "AXIBAN", ticker: "AXISBANK", token: "5900" },
];
