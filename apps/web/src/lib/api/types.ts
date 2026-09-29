export type { Candle, CandleResponse } from "../../../../../packages/shared/src/candle";

export type Market = "NSE" | "CRYPTO";
export type Currency = "INR" | "USDT";

export interface FxRate {
  base: "USDT";
  quote: "INR";
  rate: number;
  timestamp: number;
  source: string;
}

export interface Holding {
  symbol: string;
  market: Market;
  quantity: number;
  quote_currency: Currency;
  avg_cost: number;
  avg_cost_inr: number;
  price: number | null;
  value: number;
  unrealized_pnl: number;
}

export interface Portfolio {
  base_currency: "INR";
  fx_rate: FxRate | null;
  cash: number;
  holdings_value: number;
  total_value: number;
  starting_cash: number;
  pnl: number;
  pnl_pct: number;
  holdings: Holding[];
}

export type PortfolioHistoryPeriod = "1D" | "1W" | "1M";

export interface PortfolioHistoryResponse {
  base_currency: "INR";
  period: PortfolioHistoryPeriod;
  interval_minutes: 15;
  points: { timestamp: number; value: number; pnl: number }[];
}

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  total_value: number;
  pnl: number;
  pnl_pct: number;
  is_you?: boolean;
}

export interface LeaderboardResponse {
  base_currency: "INR";
  fx_rate: FxRate;
  leaderboard: LeaderboardEntry[];
  you: LeaderboardEntry | null;
  total_users: number;
}

export interface LeaderboardRoom {
  id: string;
  code: string;
  name: string;
  created_by: string;
  created_at: string;
  is_owner: boolean;
  joined_at?: string;
  member_count?: number;
}

export interface LeaderboardRoomsResponse { rooms: LeaderboardRoom[] }

export interface PrivateLeaderboardResponse {
  room: LeaderboardRoom;
  base_currency: "INR";
  fx_rate: FxRate;
  leaderboard: LeaderboardEntry[];
  total_users: number;
  updated_at: number;
}

export interface LeaderboardUpdate {
  base_currency: "INR";
  fx_rate: FxRate;
  leaderboard: LeaderboardEntry[];
  total_users: number;
  updated_at: number;
}

export interface WatchlistItem {
  symbol: string;
  market: Market;
  price: number | null;
  added_at: string;
}

export interface WatchlistResponse {
  watchlist: WatchlistItem[];
}

export interface WatchlistMutationResponse {
  symbol: string;
  market: Market;
  added: boolean;
}

export interface Trade {
  trade_id: string;
  order_id: string;
  symbol: string;
  market: Market;
  quote_currency: Currency;
  side: "BUY" | "SELL";
  quantity: number;
  fill_price: number;
  value: number;
  executed_at: string;
}

export interface TradesResponse {
  trades: Trade[];
  next_before: string | null;
}

export interface OrderRequest {
  symbol: string;
  market: Market;
  side: "BUY" | "SELL";
  quantity: number;
}

export interface OrderResponse {
  status: "FILLED" | "REJECTED";
  order_id: string;
  trade_id?: string;
  fill_price?: number;
  quote_currency?: Currency;
  cash_currency?: "INR";
  cash_balance?: number;
  holding_quantity?: number;
  holding_avg_cost?: number;
  reason?: string;
}
