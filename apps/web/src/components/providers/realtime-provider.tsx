"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "@/lib/api/client";
import type { LeaderboardUpdate, Portfolio } from "@/lib/api/types";
import { useAuth } from "./auth-provider";

type ServerToClientEvents = {
  portfolio: (snapshot: Portfolio) => void;
  leaderboard: (snapshot: LeaderboardUpdate) => void;
  price: (tick: { market: "NSE" | "CRYPTO"; symbol: string; price: number; timestamp: number; snapshot?: boolean }) => void;
};
type SubscriptionItem = { market: "NSE" | "CRYPTO"; symbol: string };
type ClientToServerEvents = {
  subscribe: (items: SubscriptionItem[], ack?: (result: { ok: boolean; error?: string }) => void) => void;
  unsubscribe: (items: SubscriptionItem[], ack?: (result: { ok: boolean; error?: string }) => void) => void;
};
type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type RealtimeState = { socket: RealtimeSocket | null; connected: boolean; error: string | null };
const emptyState: RealtimeState = { socket: null, connected: false, error: null };
let realtimeState = emptyState;
const subscribers = new Set<() => void>();
function publish(patch: Partial<RealtimeState>) {
  realtimeState = { ...realtimeState, ...patch };
  for (const subscriber of subscribers) subscriber();
}
function subscribeState(subscriber: () => void) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }
const RealtimeContext = createContext<RealtimeState>(emptyState);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  useEffect(() => {
    if (!session?.access_token) { publish(emptyState); return; }
    const client: RealtimeSocket = io(API_URL, { auth: { token: session.access_token }, autoConnect: false, reconnection: true, reconnectionAttempts: Infinity, timeout: 10_000 });
    const onConnect = () => publish({ connected: true, error: null });
    const onDisconnect = () => publish({ connected: false });
    const onError = (event: Error) => publish({ connected: false, error: event.message || "Realtime connection failed" });
    client.on("connect", onConnect);
    client.on("disconnect", onDisconnect);
    client.on("connect_error", onError);
    publish({ socket: client, connected: false, error: null });
    client.connect();
    return () => {
      client.off("connect", onConnect);
      client.off("disconnect", onDisconnect);
      client.off("connect_error", onError);
      client.disconnect();
      if (realtimeState.socket === client) publish(emptyState);
    };
  }, [session?.access_token]);

  return <RealtimeContext.Provider value={emptyState}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  return useSyncExternalStore(subscribeState, () => realtimeState, () => context);
}
