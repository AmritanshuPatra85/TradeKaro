"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Market } from "@/lib/api/types";
import { useRealtime } from "@/components/providers/realtime-provider";

export interface MarketPrice { market: Market; symbol: string; price: number; timestamp: number; previous?: number }
const latestPrices = new Map<string, MarketPrice>();
const priceSubscribers = new Map<string, Set<() => void>>();
const priceKey = (market: Market, symbol: string) => `${market}:${symbol}`;

function publishPrice(tick: Omit<MarketPrice, "previous">) {
  const key = priceKey(tick.market, tick.symbol);
  const next = { ...tick, previous: latestPrices.get(key)?.price };
  latestPrices.set(key, next);
  for (const subscriber of priceSubscribers.get(key) ?? []) subscriber();
}

export function useMarketPrice(market: Market, symbol: string) {
  const key = priceKey(market, symbol);
  const subscribe = useCallback((notify: () => void) => {
    const group = priceSubscribers.get(key) ?? new Set<() => void>();
    group.add(notify);
    priceSubscribers.set(key, group);
    return () => {
      group.delete(notify);
      if (group.size === 0) priceSubscribers.delete(key);
    };
  }, [key]);
  const getSnapshot = useCallback(() => latestPrices.get(key) ?? null, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function useMarketPrices(symbols: { market: Market; symbol: string }[]) {
  const { socket, connected } = useRealtime();
  const [prices, setPrices] = useState<Record<string, MarketPrice>>({});
  useEffect(() => {
    if (!socket) return;
    const onPrice = (tick: MarketPrice & { snapshot?: boolean }) => {
      if (!Number.isFinite(tick.price)) return;
      const key = `${tick.market}:${tick.symbol}`;
      publishPrice(tick);
      setPrices((current) => ({ ...current, [key]: { ...tick, previous: current[key]?.price } }));
    };
    socket.on("price", onPrice);
    const subscribe = () => {
      if (symbols.length === 0) return;
      socket.emit("subscribe", symbols, (result: { ok?: boolean; error?: string }) => { if (!result?.ok) console.warn("Market subscription failed", result?.error); });
    };
    const unsubscribe = () => { if (symbols.length > 0) socket.emit("unsubscribe", symbols); };
    if (socket.connected) subscribe();
    socket.on("connect", subscribe);
    return () => { socket.off("price", onPrice); socket.off("connect", subscribe); if (socket.connected) unsubscribe(); };
  }, [socket, symbols]);
  return { prices, connected };
}
