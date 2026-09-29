import type { CandleResponse, LeaderboardResponse, LeaderboardRoom, LeaderboardRoomsResponse, Market, OrderRequest, OrderResponse, Portfolio, PortfolioHistoryPeriod, PortfolioHistoryResponse, PrivateLeaderboardResponse, TradesResponse, WatchlistMutationResponse, WatchlistResponse } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

async function requestPublic<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

async function mutate<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.reason || `Request failed (${response.status})`);
  return payload as T;
}

async function remove(path: string, token: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
}

export const api = {
  marketCandles: (market: Market, symbol: string, limit = 500, signal?: AbortSignal) =>
    requestPublic<CandleResponse>(`/market/candles?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}&limit=${limit}`, signal),
  portfolio: (token: string, signal?: AbortSignal) => request<Portfolio>("/portfolio", token, signal),
  portfolioHistory: (token: string, period: PortfolioHistoryPeriod, signal?: AbortSignal) =>
    request<PortfolioHistoryResponse>(`/portfolio/history?period=${period}`, token, signal),
  leaderboard: (token: string, limit = 20, signal?: AbortSignal) =>
    request<LeaderboardResponse>(`/leaderboard?limit=${limit}`, token, signal),
  leaderboardRooms: (token: string, signal?: AbortSignal) => request<LeaderboardRoomsResponse>("/leaderboard/rooms", token, signal),
  createLeaderboardRoom: (token: string, name: string) => mutate<{ room: LeaderboardRoom }>("/leaderboard/rooms", token, { name }),
  joinLeaderboardRoom: (token: string, code: string) => mutate<{ room: LeaderboardRoom; already_joined: boolean }>("/leaderboard/rooms/join", token, { code }),
  privateLeaderboard: (token: string, roomId: string, signal?: AbortSignal) =>
    request<PrivateLeaderboardResponse>(`/leaderboard/rooms/${encodeURIComponent(roomId)}`, token, signal),
  watchlist: (token: string, signal?: AbortSignal) => request<WatchlistResponse>("/watchlist", token, signal),
  addToWatchlist: (token: string, symbol: string, market: Market) =>
    mutate<WatchlistMutationResponse>("/watchlist", token, { symbol, market }),
  removeFromWatchlist: (token: string, market: Market, symbol: string) =>
    remove(`/watchlist/${encodeURIComponent(market)}/${encodeURIComponent(symbol)}`, token),
  trades: (token: string, limit = 50, signal?: AbortSignal, before?: string) =>
    request<TradesResponse>(`/trades?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`, token, signal),
  placeOrder: (token: string, order: OrderRequest) => mutate<OrderResponse>("/orders", token, order),
};
