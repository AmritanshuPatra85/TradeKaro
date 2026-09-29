"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bitcoin, Check, ChevronDown,
  CircleHelp, Clock3, Plus, Radio, RefreshCw, Search, Star,
  Trash2, TrendingUp, Wifi, WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthLoadingScreen, QuickOrder, SignInScreen, TopNavigation } from "@/components/dashboard/dashboard";
import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { useMarketPrice, useMarketPrices } from "@/hooks/use-market-prices";
import { api } from "@/lib/api/client";
import type { Candle, Market, OrderResponse, Portfolio, WatchlistItem, WatchlistResponse } from "@/lib/api/types";
import { formatINR, formatMarketPrice, formatNumber, formatPct } from "@/lib/format";
import { findInstrument, INSTRUMENTS, type Instrument } from "@/lib/markets/instruments";
import { CandlestickChart } from "./candlestick-chart";

type LoadState<T> = { data: T | null; loading: boolean; error: string | null };
type CandleState = { key: string; refresh: number; status: "idle" | "loading" | "ready" | "empty" | "error"; candles: Candle[] | null; error: string | null };
const initialWatchlist: LoadState<WatchlistResponse> = { data: null, loading: true, error: null };
const initialPortfolio: LoadState<Portfolio> = { data: null, loading: true, error: null };

function MarketPriceBridge({ symbols }: { symbols: { market: Market; symbol: string }[] }) {
  // Only this small bridge re-renders on price ticks; the page shell and search stay still.
  useMarketPrices(symbols);
  return null;
}

function useMinuteClock() {
  const [, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const timer = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 30_000);
    return () => clearInterval(timer);
  }, []);
}

function getSessionStatus(market: Market) {
  if (market === "CRYPTO") return { label: "24 / 7", detail: "Crypto market", insideSchedule: true };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekday = value("weekday");
  const minuteOfDay = Number(value("hour")) * 60 + Number(value("minute"));
  const weekdaySession = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const insideSchedule = weekdaySession && minuteOfDay >= 9 * 60 + 15 && minuteOfDay < 15 * 60 + 30;
  return {
    label: insideSchedule ? "Within posted hours" : "Outside posted hours",
    detail: "NSE · Mon–Fri · 09:15–15:30 IST",
    insideSchedule,
  };
}

function MarketSession({ market }: { market: Market }) {
  useMinuteClock();
  const status = getSessionStatus(market);
  return <div className={`market-session ${status.insideSchedule ? "session-active" : "session-quiet"}`} title={market === "NSE" ? "Schedule only; exchange holidays are not included." : "Crypto trades around the clock."}>
    <span className="session-icon">{market === "CRYPTO" ? <Bitcoin size={14} /> : <Clock3 size={14} />}</span>
    <span><strong>{status.label}</strong><small>{status.detail}</small></span>
    {market === "NSE" && <CircleHelp className="session-help" size={13} />}
  </div>;
}

function PriceReadout({ instrument, fallbackPrice, compact = false }: { instrument: Instrument; fallbackPrice?: number | null; compact?: boolean }) {
  const tick = useMarketPrice(instrument.market, instrument.symbol);
  const price = tick?.price ?? fallbackPrice ?? null;
  const change = tick?.previous !== undefined ? tick.price - tick.previous : null;
  const changePct = change !== null && tick?.previous ? (change / tick.previous) * 100 : null;
  const trend = change === null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const changeText = change === null ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${instrument.quoteCurrency === "INR" ? formatINR(Math.abs(change)) : `${formatNumber(Math.abs(change), Math.abs(change) < 1 ? 5 : 2)} USDT`}`;
  return <div className={compact ? "price-readout compact" : "price-readout"}>
    <strong className="readout-price">{price === null ? "—" : formatMarketPrice(instrument.market, price)}</strong>
    <div className={`readout-change ${trend}`} title="Change from the previous price tick received by this page.">
      {trend === "up" ? <ArrowUpRight size={13} /> : trend === "down" ? <ArrowDownRight size={13} /> : null}
      <span>{changeText}</span><span>{changePct === null ? "" : `(${formatPct(changePct)})`}</span>
    </div>
  </div>;
}

function InstrumentMark({ instrument, small = false }: { instrument: Instrument; small?: boolean }) {
  const acronym = instrument.market === "CRYPTO" ? instrument.symbol.slice(0, 1) : instrument.symbol.slice(0, 1);
  return <span className={`instrument-mark ${instrument.market === "CRYPTO" ? "crypto-mark" : "stock-mark"} ${small ? "mark-small" : ""}`}>{acronym}</span>;
}

function WatchlistRow({ item, active, onSelect, onRemove, busy }: {
  item: WatchlistItem; active: boolean; onSelect: () => void; onRemove: () => void; busy: boolean;
}) {
  const instrument = findInstrument(item.market, item.symbol) ?? {
    symbol: item.symbol, market: item.market, name: item.symbol, quoteCurrency: item.market === "NSE" ? "INR" : "USDT",
  };
  const tick = useMarketPrice(item.market, item.symbol);
  return <motion.div className={`watch-row ${active ? "watch-row-active" : ""}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -8 }}>
    <button className="watch-select" onClick={onSelect} aria-label={`Select ${item.symbol}`} aria-current={active ? "true" : undefined}>
      <InstrumentMark instrument={instrument} small />
      <span className="watch-identity"><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
    </button>
    <PriceReadout instrument={instrument} fallbackPrice={tick?.price ?? item.price} compact />
    <button className="watch-remove" onClick={onRemove} disabled={busy} aria-label={`Remove ${item.symbol} from watchlist`} title="Remove from watchlist"><Trash2 size={14} /></button>
  </motion.div>;
}

function SearchResult({ instrument, watched, selected, busy, onSelect, onToggleWatchlist }: {
  instrument: Instrument; watched: boolean; selected: boolean; busy: boolean; onSelect: () => void; onToggleWatchlist: () => void;
}) {
  return <motion.div className={`instrument-result ${selected ? "instrument-result-selected" : ""}`} layout initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}>
    <button className="result-select" onClick={onSelect}>
      <InstrumentMark instrument={instrument} small />
      <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      {selected && <Check size={14} className="result-selected-check" />}
    </button>
    <button className={`result-watch ${watched ? "is-watched" : ""}`} onClick={onToggleWatchlist} disabled={busy} aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`} title={watched ? "Remove from watchlist" : "Add to watchlist"}>
      {busy ? <span className="tiny-spinner" /> : watched ? <Star size={15} fill="currentColor" /> : <Plus size={16} />}
    </button>
  </motion.div>;
}

function InstrumentPicker({ market, selected, watchlist, busyKey, onSelect, onToggleWatchlist }: {
  market: Market; selected: string | null; watchlist: WatchlistItem[]; busyKey: string | null;
  onSelect: (symbol: string) => void; onToggleWatchlist: (instrument: Instrument, watched: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const instruments = INSTRUMENTS[market];
    if (!needle) return instruments;
    return instruments.filter((instrument) => `${instrument.symbol} ${instrument.name}`.toLowerCase().includes(needle));
  }, [market, query]);
  const selectedInstrument = selected ? findInstrument(market, selected) : null;
  const selectedIsInFilter = selectedInstrument && filtered.some((item) => item.symbol === selectedInstrument.symbol);
  const options = selectedInstrument && !selectedIsInFilter ? [selectedInstrument, ...filtered] : filtered;
  const showResults = focused && query.trim().length > 0;
  const watchedSymbols = new Set(watchlist.filter((item) => item.market === market).map((item) => item.symbol));

  return <div className="instrument-picker">
    <label className="instrument-select-wrap"><span className="sr-only">Select an instrument</span>
      <select aria-label="Select an instrument" value={selected ?? ""} onChange={(event) => onSelect(event.currentTarget.value)}>
        <option value="">Select instrument</option>
        {options.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol} · {instrument.name}</option>)}
      </select><ChevronDown size={14} />
    </label>
    <div className="instrument-search-wrap">
      <label className="market-search"><Search size={16} /><input id="market-search" type="search" value={query} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 120)} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${market === "NSE" ? "NSE stocks" : "crypto pairs"}`} autoComplete="off" /><kbd>/</kbd></label>
      <AnimatePresence>{showResults && <motion.div className="search-results" initial={{ opacity: 0, y: 5, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 3 }}>
        <div className="search-results-heading"><span>SUPPORTED INSTRUMENTS</span><span>{filtered.length}</span></div>
        {filtered.length ? filtered.map((instrument) => {
          const watched = watchedSymbols.has(instrument.symbol);
          const key = `${market}:${instrument.symbol}`;
          return <SearchResult key={instrument.symbol} instrument={instrument} watched={watched} selected={selected === instrument.symbol} busy={busyKey === key} onSelect={() => { onSelect(instrument.symbol); setQuery(""); setFocused(false); }} onToggleWatchlist={() => onToggleWatchlist(instrument, watched)} />;
        }) : <div className="search-no-results">No supported instrument matches “{query}”.</div>}
      </motion.div>}</AnimatePresence>
    </div>
  </div>;
}

function WatchlistPanel({ market, items, loading, error, activeSymbol, busyKey, actionError, onSelect, onRemove, onRetry }: {
  market: Market; items: WatchlistItem[]; loading: boolean; error: string | null; activeSymbol: string | null; busyKey: string | null; actionError: string | null;
  onSelect: (item: WatchlistItem) => void; onRemove: (item: WatchlistItem) => void; onRetry: () => void;
}) {
  const visibleItems = items.filter((item) => item.market === market);
  return <section className="market-card watchlist-panel">
    <div className="market-card-heading"><div><span className="eyebrow">YOUR SHORTLIST</span><h2>Watchlist <span className="watch-count">{loading ? "··" : visibleItems.length}</span></h2></div><span className="watchlist-market-tag">{market}</span></div>
    <div className="watchlist-columns"><span>INSTRUMENT</span><span>LAST / TICK CHANGE</span><span /></div>
    {loading ? <div className="market-skeleton-list">{[0, 1, 2, 3].map((item) => <div className="market-skeleton-row" key={item}><i /><span /><b /></div>)}</div> : error ? <div className="market-panel-state"><CircleHelp size={18} /><strong>Watchlist unavailable</strong><p>{error}</p><button className="market-text-button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div> : visibleItems.length === 0 ? <div className="market-panel-state empty-watchlist"><span className="empty-watch-icon"><Star size={19} /></span><strong>No {market === "NSE" ? "stocks" : "crypto pairs"} saved yet</strong><p>Search supported instruments above, then tap the plus button to add one.</p></div> : <div className="watchlist-rows"><AnimatePresence initial={false}>{visibleItems.map((item) => <WatchlistRow key={`${item.market}:${item.symbol}`} item={item} active={activeSymbol === item.symbol} busy={busyKey === `${market}:${item.symbol}`} onSelect={() => onSelect(item)} onRemove={() => onRemove(item)} />)}</AnimatePresence></div>}
    {actionError && <div className="watchlist-action-error" role="alert">{actionError}</div>}
    <div className="watchlist-foot"><span><Star size={12} /> Saved instruments only</span><span>MAX 50</span></div>
  </section>;
}

function SupportedInstrumentsPanel({ market, items, busyKey, onSelect, onToggleWatchlist }: {
  market: Market; items: WatchlistItem[]; busyKey: string | null;
  onSelect: (instrument: Instrument) => void;
  onToggleWatchlist: (instrument: Instrument, watched: boolean) => void;
}) {
  const instruments = INSTRUMENTS[market];
  const watchedSymbols = new Set(items.filter((item) => item.market === market).map((item) => item.symbol));
  return <section className="market-card supported-instruments-panel">
    <div className="market-card-heading"><div><span className="eyebrow">SUPPORTED UNIVERSE</span><h2>{market === "NSE" ? "NSE stocks" : "Crypto pairs"} <span className="watch-count">{instruments.length}</span></h2></div><span className="watchlist-market-tag">{market === "NSE" ? "INR" : "USDT"}</span></div>
    <div className="directory-caption"><span>INSTRUMENT</span><span>LAST PRICE</span><span /></div>
    <div className="directory-rows">
      {instruments.map((instrument) => {
        const watched = watchedSymbols.has(instrument.symbol);
        const key = `${market}:${instrument.symbol}`;
        return <div className="directory-row" key={instrument.symbol}>
          <button className="directory-select" type="button" onClick={() => onSelect(instrument)} aria-label={`Open ${instrument.symbol}`}>
            <InstrumentMark instrument={instrument} small />
            <span className="directory-identity"><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
          </button>
          <PriceReadout instrument={instrument} compact />
          <button className={`directory-watch ${watched ? "is-watched" : ""}`} type="button" onClick={() => onToggleWatchlist(instrument, watched)} disabled={busyKey === key || (busyKey !== null && busyKey !== key)} aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`} title={watched ? "Remove from watchlist" : "Add to watchlist"}>
            {busyKey === key ? <span className="tiny-spinner" /> : watched ? <Star size={14} fill="currentColor" /> : <Plus size={15} />}
          </button>
        </div>;
      })}
    </div>
    <div className="directory-foot"><Radio size={12} /><span>Live prices · {market === "NSE" ? "Breeze" : "Binance"}</span></div>
  </section>;
}

function InstrumentHeader({ instrument, priceFallback, isWatched, busy, onToggleWatchlist, onTrade }: {
  instrument: Instrument | null; priceFallback?: number | null; isWatched: boolean; busy: boolean; onToggleWatchlist: () => void; onTrade: () => void;
}) {
  const currentTick = useMarketPrice(instrument?.market ?? "NSE", instrument?.symbol ?? "");
  if (!instrument) return <div className="instrument-header no-instrument"><span className="no-instrument-mark"><Activity size={17} /></span><div><strong>Select a supported instrument</strong><small>Use search or the selector to open its market view.</small></div></div>;
  return <motion.div className="instrument-header" key={`${instrument.market}:${instrument.symbol}`} initial={{ opacity: .65, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }}>
    <div className="instrument-title"><InstrumentMark instrument={instrument} /><div><div className="instrument-title-row"><h2>{instrument.symbol}</h2><span className="quote-pill">{instrument.quoteCurrency}</span></div><span>{instrument.name} <i>·</i> {instrument.market === "NSE" ? "National Stock Exchange of India" : "Binance Spot"}</span></div></div>
    <div className="instrument-header-data"><PriceReadout instrument={instrument} fallbackPrice={priceFallback} /><span className="tick-stamp">{currentTick ? `Updated ${new Date(currentTick.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })} IST` : "Awaiting first price tick"}</span></div>
    <div className="instrument-actions">
      <button className="market-trade-button" type="button" onClick={onTrade}><TrendingUp size={14} /> Trade</button>
      <button className={`watchlist-toggle ${isWatched ? "watchlist-toggle-active" : ""}`} onClick={onToggleWatchlist} disabled={busy} aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"} title={isWatched ? "Remove from watchlist" : "Add to watchlist"}>{busy ? <span className="tiny-spinner" /> : isWatched ? <><Star size={15} fill="currentColor" /> Saved</> : <><Plus size={15} /> Watchlist</>}</button>
    </div>
  </motion.div>;
}

function CandleToolbar({ market }: { market: Market }) {
  return <div className="candle-toolbar">
    <div className="timeframe-controls" aria-label="Candle timeframe">
      <span className="timeframe-label">INTERVAL</span>
      <button className="timeframe-option selected" aria-pressed="true" title="The shared candle schema currently supports one-minute candles">1m</button>
      <button className="timeframe-option" disabled title="This interval is not available from the backend">5m</button>
      <button className="timeframe-option" disabled title="This interval is not available from the backend">15m</button>
      <button className="timeframe-option" disabled title="This interval is not available from the backend">1h</button>
    </div>
    <span className="chart-quote-unit">PRICE IN {market === "NSE" ? "INR" : "USDT"}</span>
  </div>;
}

function QuoteInfoPanel({ market, instrument, priceFallback }: { market: Market; instrument: Instrument | null; priceFallback?: number | null }) {
  const session = getSessionStatus(market);
  const tick = useMarketPrice(market, instrument?.symbol ?? "");
  const change = tick?.previous !== undefined ? tick.price - tick.previous : null;
  const changePct = change !== null && tick?.previous ? (change / tick.previous) * 100 : null;
  const quote = instrument?.quoteCurrency ?? (market === "NSE" ? "INR" : "USDT");
  return <section className="market-card info-panel">
    <div className="market-card-heading"><div><span className="eyebrow">MARKET INFORMATION</span><h2>{instrument ? instrument.symbol : "Instrument details"}</h2></div><span className="info-market-badge">{market}</span></div>
    {instrument ? <div className="quote-info-grid">
      <div><span>LAST PRICE</span><strong>{tick?.price !== undefined ? formatMarketPrice(market, tick.price) : priceFallback != null ? formatMarketPrice(market, priceFallback) : "—"}</strong></div>
      <div><span>LAST TICK Δ</span><strong className={change === null ? "" : change > 0 ? "positive" : change < 0 ? "negative" : ""}>{change === null ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${quote === "INR" ? formatINR(Math.abs(change)) : `${formatNumber(Math.abs(change), 3)} USDT`}`}</strong></div>
      <div><span>LAST TICK Δ%</span><strong className={changePct === null ? "" : changePct > 0 ? "positive" : changePct < 0 ? "negative" : ""}>{changePct === null ? "—" : formatPct(changePct)}</strong></div>
      <div><span>QUOTE CURRENCY</span><strong>{quote}</strong></div>
      <div className="quote-info-wide"><span>DATA SOURCE</span><strong>{market === "NSE" ? "ICICI Direct · Breeze" : "Binance WebSocket"}</strong></div>
    </div> : <div className="quote-info-empty"><p>Choose an instrument to see its current quote details.</p></div>}
    <div className="session-info"><span className={`session-info-icon ${session.insideSchedule ? "on" : ""}`}>{market === "CRYPTO" ? <Radio size={14} /> : <Clock3 size={14} />}</span><span><strong>{session.label}</strong><small>{session.detail}</small></span></div>
    {market === "NSE" && <p className="session-disclaimer">Schedule indicator only; exchange holidays and exceptional sessions are not queried.</p>}
  </section>;
}

function MarketPage() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { socket, connected, error: socketError } = useRealtime();
  const token = session?.access_token;
  const [market, setMarket] = useState<Market>("NSE");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<LoadState<WatchlistResponse>>(initialWatchlist);
  const [watchlistRevision, setWatchlistRevision] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [order, setOrder] = useState<{ symbol: string; market: Market } | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<OrderResponse | null>(null);
  const [portfolio, setPortfolio] = useState<LoadState<Portfolio>>(initialPortfolio);
  const [portfolioRevision, setPortfolioRevision] = useState(0);
  const orderSubmitting = useRef(false);
  const [candleRefresh, setCandleRefresh] = useState(0);
  const [candleState, setCandleState] = useState<CandleState>({ key: "", refresh: -1, status: "idle", candles: null, error: null });

  const refreshWatchlist = useCallback(() => setWatchlistRevision((revision) => revision + 1), []);
  const refreshPortfolio = useCallback(() => setPortfolioRevision((revision) => revision + 1), []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void api.portfolio(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPortfolio({ data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPortfolio((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Could not load your portfolio." }));
    });
    return () => controller.abort();
  }, [token, portfolioRevision]);
  useEffect(() => {
    if (!socket) return;
    const receivePortfolio = (snapshot: Portfolio) => setPortfolio({ data: snapshot, loading: false, error: null });
    socket.on("portfolio", receivePortfolio);
    return () => { socket.off("portfolio", receivePortfolio); };
  }, [socket]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void api.watchlist(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) setWatchlist({ data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setWatchlist({ data: null, loading: false, error: error instanceof Error ? error.message : "Could not load your watchlist." });
    });
    return () => controller.abort();
  }, [token, watchlistRevision]);

  const watchlistItems = useMemo(() => watchlist.data?.watchlist ?? [], [watchlist.data?.watchlist]);
  const currentMarketWatchlist = watchlistItems.filter((item) => item.market === market);
  const activeSymbol = selectedSymbol ?? currentMarketWatchlist[0]?.symbol ?? null;
  const candleKey = `${market}:${activeSymbol ?? "none"}:1m`;
  const selectedInstrument = activeSymbol ? findInstrument(market, activeSymbol) : null;
  const selectedWatchlistEntry = watchlistItems.find((item) => item.market === market && item.symbol === activeSymbol);
  const isSelectedWatched = Boolean(selectedWatchlistEntry);
  const subscriptions = useMemo(() => {
    const items = new Map<string, { market: Market; symbol: string }>();
    for (const instrument of INSTRUMENTS[market]) items.set(`${instrument.market}:${instrument.symbol}`, { market: instrument.market, symbol: instrument.symbol });
    for (const item of watchlistItems) items.set(`${item.market}:${item.symbol}`, { market: item.market, symbol: item.symbol });
    if (selectedSymbol) items.set(`${market}:${selectedSymbol}`, { market, symbol: selectedSymbol });
    return [...items.values()];
  }, [market, selectedSymbol, watchlistItems]);

  useEffect(() => {
    if (!activeSymbol) return;
    const controller = new AbortController();
    void api.marketCandles(market, activeSymbol, 500, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setCandleState({ key: candleKey, refresh: candleRefresh, status: response.candles.length ? "ready" : "empty", candles: response.candles, error: null });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setCandleState({ key: candleKey, refresh: candleRefresh, status: "error", candles: null, error: error instanceof Error ? error.message : "Could not load market candles." });
    });
    return () => controller.abort();
  }, [activeSymbol, candleKey, candleRefresh, market]);

  const toggleWatchlist = useCallback(async (instrument: Instrument, watched: boolean) => {
    if (!token) return;
    const key = `${instrument.market}:${instrument.symbol}`;
    setBusyKey(key); setActionError(null);
    try {
      if (watched) await api.removeFromWatchlist(token, instrument.market, instrument.symbol);
      else await api.addToWatchlist(token, instrument.symbol, instrument.market);
      refreshWatchlist();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update your watchlist.");
    } finally { setBusyKey(null); }
  }, [refreshWatchlist, token]);

  const submitOrder = async (side: "BUY" | "SELL", quantity: number) => {
    if (!token || !order || orderSubmitting.current) return;
    orderSubmitting.current = true;
    setOrderBusy(true); setOrderError(null); setOrderResult(null);
    try {
      const result = await api.placeOrder(token, { symbol: order.symbol, market: order.market, side, quantity });
      if (result.status === "REJECTED") { setOrderError(result.reason ?? "The order could not be completed."); return; }
      setOrderResult(result);
      refreshPortfolio();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "The order could not be completed.");
    } finally { orderSubmitting.current = false; setOrderBusy(false); }
  };
  const showOrder = (instrument: Instrument) => {
    setOrderError(null); setOrderResult(null);
    setOrder({ symbol: instrument.symbol, market: instrument.market });
  };

  const chooseMarket = (next: Market) => {
    if (next === market) return;
    setMarket(next); setSelectedSymbol(null); setActionError(null);
  };
  const chooseInstrument = (symbol: string) => setSelectedSymbol(symbol || null);
  const { displayName, avatar } = useMemo(() => {
    const profile = session?.user.user_metadata ?? {};
    return {
      displayName: String(profile.full_name ?? profile.name ?? session?.user.email?.split("@")[0] ?? "Trader"),
      avatar: typeof profile.avatar_url === "string" ? profile.avatar_url : undefined,
    };
  }, [session]);
  const socketReady = connected;
  const candleStateMatches = candleState.key === candleKey && candleState.refresh === candleRefresh;
  const candleStatus = !activeSymbol ? "idle" : candleStateMatches ? candleState.status : "loading";
  const candles = candleStateMatches ? candleState.candles : null;
  const priceFallback = selectedWatchlistEntry?.price ?? null;

  if (authLoading) return <AuthLoadingScreen />;
  if (!session) return <SignInScreen />;

  return <div className="app-shell markets-shell" id="markets-top">
    <MarketPriceBridge symbols={subscriptions} />
    <TopNavigation name={displayName} avatar={avatar} connected={connected} activePage="markets" onSignOut={() => void signOut()} />
    <main className="markets-main">
      <div className="markets-content">
        <header className="markets-page-header">
          <div><div className="welcome-kicker"><span className="welcome-spark"><Activity size={13} /></span> TRADEKARO MARKETS <span className="welcome-separator">/</span> LIVE VIEW</div><h1>Markets<span className="header-period">.</span></h1><p>Find a move. Follow the price. Stay close to the tape.</p></div>
          <div className="market-header-status"><span className={`market-connection ${socketReady ? "is-connected" : "is-disconnected"}`}>{socketReady ? <Wifi size={14} /> : <WifiOff size={14} />}{socketReady ? "Feed connected" : "Feed disconnected"}</span><MarketSession market={market} /></div>
        </header>

        <section className="markets-controls" aria-label="Market and instrument controls">
          <div className="markets-switcher" role="tablist" aria-label="Choose market">
            <button type="button" role="tab" aria-selected={market === "NSE"} className={market === "NSE" ? "market-switch active" : "market-switch"} onClick={() => chooseMarket("NSE")}><span className="market-switch-icon flag-mark">IN</span><span><strong>Stocks</strong><small>NSE · INR</small></span>{market === "NSE" && <motion.i layoutId="markets-switch-marker" />}</button>
            <button type="button" role="tab" aria-selected={market === "CRYPTO"} className={market === "CRYPTO" ? "market-switch active" : "market-switch"} onClick={() => chooseMarket("CRYPTO")}><span className="market-switch-icon crypto-switch-icon"><Bitcoin size={16} /></span><span><strong>Crypto</strong><small>Binance · USDT</small></span>{market === "CRYPTO" && <motion.i layoutId="markets-switch-marker" />}</button>
          </div>
          <InstrumentPicker market={market} selected={selectedSymbol ?? activeSymbol} watchlist={watchlistItems} busyKey={busyKey} onSelect={chooseInstrument} onToggleWatchlist={(instrument, watched) => void toggleWatchlist(instrument, watched)} />
        </section>

        <section className="markets-terminal-grid" aria-label="Market terminal">
          <div className="market-main-column">
            <section className="market-card chart-panel">
              <InstrumentHeader instrument={selectedInstrument} priceFallback={priceFallback} isWatched={isSelectedWatched} busy={busyKey === `${market}:${activeSymbol}`} onToggleWatchlist={() => { if (selectedInstrument) void toggleWatchlist(selectedInstrument, isSelectedWatched); }} onTrade={() => { if (selectedInstrument) showOrder(selectedInstrument); }} />
              <CandleToolbar market={market} />
              <CandlestickChart symbol={activeSymbol} market={market} candles={candles} status={candleStatus} errorMessage={candleState.error} onRetry={() => setCandleRefresh((value) => value + 1)} selectionKey={candleKey} />
              <div className="chart-disclaimer"><span><Clock3 size={12} /> Persisted 1-minute candles · no higher intervals published</span><span>OHLC from database records</span></div>
            </section>
            <QuoteInfoPanel market={market} instrument={selectedInstrument} priceFallback={priceFallback} />
          </div>
          <aside className="market-side-column">
            <WatchlistPanel market={market} items={watchlistItems} loading={watchlist.loading} error={watchlist.error} activeSymbol={activeSymbol} busyKey={busyKey} actionError={actionError} onSelect={(item) => { setSelectedSymbol(item.symbol); }} onRemove={(item) => { const instrument = findInstrument(item.market, item.symbol); if (instrument) void toggleWatchlist(instrument, true); }} onRetry={refreshWatchlist} />
            <SupportedInstrumentsPanel market={market} items={watchlistItems} busyKey={busyKey} onSelect={(instrument) => setSelectedSymbol(instrument.symbol)} onToggleWatchlist={(instrument, watched) => void toggleWatchlist(instrument, watched)} />
          </aside>
        </section>
        {socketError && <div className="socket-error-strip" role="status"><Radio size={14} /> Realtime is reconnecting. Showing the last available watchlist quotes where possible.</div>}
        <footer className="dashboard-footer markets-footer"><span>TRADEKARO <i>·</i> MARKET VIEW</span><span><span className="feed-key" /> Price changes show tick-to-tick movement, not daily performance</span><Link href="/">Back to overview <ArrowUpRight size={13} /></Link></footer>
      </div>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Quick navigation"><Link href="/"><Activity size={18} /><span>Home</span></Link><Link href="/markets" className="selected" aria-current="page"><TrendingUp size={18} /><span>Markets</span></Link><Link href="/portfolio"><Activity size={18} /><span>Portfolio</span></Link><Link href="/leaderboard"><Star size={18} /><span>Board</span></Link><Link href="/orders"><Clock3 size={18} /><span>Orders</span></Link></nav>
    <QuickOrder key={`${order?.market}:${order?.symbol}`} order={order} portfolio={portfolio.data} portfolioError={portfolio.error} onClose={() => { if (!orderBusy) setOrder(null); }} onSubmit={(side, quantity) => void submitOrder(side, quantity)} busy={orderBusy} error={orderError} result={orderResult} />
  </div>;
}

export default function MarketsPage() {
  return <MarketPage />;
}
