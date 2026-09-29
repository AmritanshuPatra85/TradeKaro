"use client";

import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell,
  Bitcoin, BriefcaseBusiness, Check, ChevronDown, CircleHelp, Clock3, Command,
  LayoutDashboard, LogOut, Menu, MoreHorizontal, Radio, RefreshCw, Search,
  ShieldCheck, Sparkles, Trophy, Wallet, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { useMarketPrice, useMarketPrices } from "@/hooks/use-market-prices";
import { api } from "@/lib/api/client";
import type { LeaderboardEntry, LeaderboardUpdate, Market, OrderResponse, Portfolio, Trade, TradesResponse, WatchlistResponse } from "@/lib/api/types";
import { formatINR, formatMarketPrice, formatNumber, formatPct } from "@/lib/format";

type LoadState<T> = { data: T | null; loading: boolean; error: string | null };
const loadingState = <T,>(): LoadState<T> => ({ data: null, loading: true, error: null });

const SYMBOLS: Record<Market, string[]> = {
  NSE: ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "TATASTEEL", "WIPRO", "ITC", "AXISBANK"],
  CRYPTO: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT", "ATOMUSDT", "UNIUSDT", "NEARUSDT", "FILUSDT", "XLMUSDT", "TRXUSDT", "ETCUSDT", "SHIBUSDT", "POLUSDT"],
};
const SYMBOL_NAMES: Record<string, string> = {
  RELIANCE: "Reliance Industries", TCS: "Tata Consultancy Services", INFY: "Infosys",
  HDFCBANK: "HDFC Bank", ICICIBANK: "ICICI Bank", SBIN: "State Bank of India",
  ITC: "ITC Limited", WIPRO: "Wipro", BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum",
  BNBUSDT: "BNB", SOLUSDT: "Solana", XRPUSDT: "XRP", ADAUSDT: "Cardano",
  DOGEUSDT: "Dogecoin", LINKUSDT: "Chainlink",
};

function useDashboardData(token: string | undefined) {
  const [portfolio, setPortfolio] = useState<LoadState<Portfolio>>(loadingState);
  const [leaderboard, setLeaderboard] = useState<LoadState<{ rows: LeaderboardEntry[]; totalUsers: number }>>(loadingState);
  const [watchlist, setWatchlist] = useState<LoadState<WatchlistResponse>>(loadingState);
  const [trades, setTrades] = useState<LoadState<TradesResponse>>(loadingState);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const load = <T,>(fetcher: () => Promise<T>, update: (state: LoadState<T>) => void) => {
      void fetcher().then((data) => {
        if (!controller.signal.aborted) update({ data, loading: false, error: null });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) update({ data: null, loading: false, error: error instanceof Error ? error.message : "Something went wrong" });
      });
    };
    load(() => api.portfolio(token, controller.signal), (state) => setPortfolio(state));
    load(() => api.leaderboard(token, 20, controller.signal), (state) => setLeaderboard(state.data ? { data: { rows: state.data.leaderboard, totalUsers: state.data.total_users }, loading: false, error: null } : { data: null, loading: state.loading, error: state.error }));
    load(() => api.watchlist(token, controller.signal), (state) => setWatchlist(state));
    load(() => api.trades(token, 6, controller.signal), (state) => setTrades(state));
    return () => controller.abort();
  }, [token, revision]);

  const receivePortfolio = useCallback((data: Portfolio) => setPortfolio({ data, loading: false, error: null }), []);
  const receiveLeaderboard = useCallback((data: LeaderboardUpdate) => setLeaderboard({ data: { rows: data.leaderboard, totalUsers: data.total_users }, loading: false, error: null }), []);
  return { portfolio, leaderboard, watchlist, trades, refresh, receivePortfolio, receiveLeaderboard };
}

function Brand() {
  return <Link className="brand" href="/" aria-label="TradeKaro home">
    <span className="brand-mark"><span /><span /><span /><span /></span>
    <span className="brand-word">trade<span>karo</span></span>
    <span className="brand-beta">PAPER</span>
  </Link>;
}

export type PrimaryPage = "overview" | "markets" | "portfolio" | "orders" | "leaderboard";

export function TopNavigation({ onSignOut, name, avatar, connected, activePage = "overview" }: { onSignOut: () => void; name: string; avatar?: string; connected: boolean; activePage?: PrimaryPage }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [
    { label: "Overview", href: "/", icon: LayoutDashboard },
    { label: "Markets", href: "/markets", icon: Activity },
    { label: "Portfolio", href: "/portfolio", icon: BriefcaseBusiness },
    { label: "Orders", href: "/orders", icon: ArrowLeftRight },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
  ];
  const hrefByPage: Record<PrimaryPage, string> = { overview: "/", markets: "/markets", portfolio: "/portfolio", orders: "/orders", leaderboard: "/leaderboard" };
  return <header className="topbar">
    <div className="topbar-inner">
      <Brand />
      <nav className="desktop-nav" aria-label="Main navigation">
        {links.map(({ label, href }) => <Link key={label} href={href} aria-current={href === hrefByPage[activePage] ? "page" : undefined} className={href === hrefByPage[activePage] ? "nav-link active" : "nav-link"}>{label}</Link>)}
      </nav>
      <div className="topbar-actions">
        <span className="nav-market-status"><i className={connected ? "status-dot" : "status-dot off"} />{connected ? "Markets live" : "Feed reconnecting"}</span>
          <button className="icon-button desktop-search" aria-label="Search markets" onClick={() => {
            const target = document.getElementById("market-search") ?? document.getElementById("market-snapshot");
            if (target instanceof HTMLInputElement) target.focus();
            else target?.scrollIntoView({ behavior: "smooth" });
          }}><Search size={17} /></button>
        <button className="icon-button notifications" aria-label="Notifications"><Bell size={17} /></button>
        <div className="account-wrap">
          <button className="account-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
            {avatar ? <Image className="avatar" src={avatar} alt="" width={31} height={31} unoptimized /> : <span className="avatar avatar-initials">{name.slice(0, 1).toUpperCase()}</span>}
            <span className="account-name">{name}</span><ChevronDown size={14} />
          </button>
          {menuOpen && <div className="account-menu"><span className="account-menu-name">{name}</span><span className="account-menu-caption">Paper trading account</span><button onClick={onSignOut}><LogOut size={15} /> Sign out</button></div>}
        </div>
        <button className="icon-button mobile-menu-button" aria-label="Toggle menu" onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
    </div>
    <AnimatePresence>{mobileOpen && <motion.nav className="mobile-nav" aria-label="Mobile navigation" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>{links.map(({ label, href, icon: Icon }) => <Link key={label} href={href} aria-current={href === hrefByPage[activePage] ? "page" : undefined} className={href === hrefByPage[activePage] ? "active" : undefined} onClick={() => setMobileOpen(false)}><Icon size={16} />{label}</Link>)}</motion.nav>}</AnimatePresence>
  </header>;
}

export function SignInScreen() {
  const { signIn, signInAsGuest, error, loading } = useAuth();
  return <main className="auth-screen"><div className="auth-card">
    <Brand /><div className="auth-symbol"><Command size={27} /></div>
    <span className="eyebrow">YOUR MARKET, YOUR MOVE</span><h1>Build your edge.</h1>
    <p>Practice with real market prices. Learn by doing, without putting real money at risk.</p>
    <button className="button button-primary auth-cta" onClick={() => void signIn()} disabled={loading}>Continue with Google <ArrowRight size={17} /></button>
    <button className="button button-quiet guest-cta" onClick={() => void signInAsGuest()} disabled={loading}>Explore as a guest</button>
    {error && <p className="inline-error">{error}</p>}
    <div className="auth-foot"><ShieldCheck size={15} /> No real money. Just real learning.</div>
  </div></main>;
}

export function AuthLoadingScreen() {
  return <div className="boot-screen"><span className="boot-mark"><span /></span><span>Getting your desk ready</span></div>;
}

function SectionHeader({ eyebrow, title, action, id }: { eyebrow?: string; title: string; action?: React.ReactNode; id?: string }) {
  return <div className="section-heading" id={id}><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>;
}

function CardError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="card-state card-error"><span className="state-icon"><CircleHelp size={19} /></span><strong>Couldn’t load this section</strong><p>{message}</p><button className="text-button" onClick={retry}><RefreshCw size={13} /> Try again</button></div>;
}

function LoadingRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-stack" aria-label="Loading"><span className="sr-only">Loading</span>{Array.from({ length: count }, (_, index) => <div className="skeleton-row" key={index}><i /><span /><b /></div>)}</div>;
}

function PerformanceCard() {
  // The API currently has no portfolio history. Keep an explicit adapter seam for a future endpoint.
  const history: { status: "unavailable" | "loading" | "error" | "ready"; points?: { timestamp: number; value: number }[] } = { status: "unavailable" };
  return <section className="panel performance-panel">
    <div className="performance-top"><div><span className="eyebrow">PORTFOLIO PERFORMANCE</span><div className="performance-total">Your journey, over time</div></div><button className="history-period" disabled aria-label="History range unavailable">1W <ChevronDown size={13} /></button></div>
    <div className="history-empty" data-history-status={history.status}>
      <div className="empty-chart" aria-hidden="true"><div className="chart-grid"><span /><span /><span /><span /></div><div className="chart-placeholder"><div className="chart-orbit"><Clock3 size={20} /></div><div className="chart-placeholder-line" /></div></div>
      <div className="history-copy"><span className="history-pill"><Clock3 size={12} /> HISTORY NOT AVAILABLE</span><strong>Your performance story starts here</strong><p>Portfolio snapshots aren’t being recorded yet. Your live balance is available above; this chart will fill in once history is supported.</p></div>
    </div>
    <div className="history-footer"><span><i className="history-dot" /> Portfolio value</span><span>Historical snapshots coming soon</span></div>
  </section>;
}

function MarketSnapshot({ market, setMarket, symbols, prices, watchlist, loading, onTrade }: {
  market: Market; setMarket: (market: Market) => void;
  symbols: { market: Market; symbol: string }[];
  prices: Record<string, { price: number; timestamp: number; previous?: number }>;
  watchlist: WatchlistResponse | null; loading: boolean;
  onTrade: (symbol: string, market: Market) => void;
}) {
  const listed = watchlist?.watchlist.filter((item) => item.market === market).map((item) => item.symbol) ?? [];
  const displayed = listed.length ? symbols.filter((item) => listed.includes(item.symbol)) : symbols;
  return <section className="panel market-panel" id="market-snapshot">
    <div className="market-head"><div><span className="eyebrow">LIVE MARKET SNAPSHOT</span><div className="panel-title-line"><h2>Market pulse</h2><span className="live-label"><i className="status-dot" /> LIVE</span></div></div><button className="more-button" aria-label="More market options"><MoreHorizontal size={20} /></button></div>
    <div className="market-tabs" role="tablist" aria-label="Choose market">
      {(["NSE", "CRYPTO"] as Market[]).map((value) => <button key={value} role="tab" aria-selected={market === value} className={market === value ? "market-tab selected" : "market-tab"} onClick={() => setMarket(value)}>{value === "NSE" ? <span className="flag-icon">🇮🇳</span> : <Bitcoin size={14} />}{value === "NSE" ? "India · NSE" : "Crypto"}{market === value && <motion.span className="tab-indicator" layoutId="market-tab-indicator" />}</button>)}
    </div>
    <div className="market-caption"><span>{listed.length ? "Your watchlist" : "Trending instruments"}</span><span>PRICE <span className="market-unit">· {market === "NSE" ? "INR" : "USDT"}</span></span></div>
    <div className="market-list">
      {loading ? <LoadingRows count={5} /> : displayed.slice(0, 5).map(({ symbol }) => {
        const tick = prices[`${market}:${symbol}`];
        const isWatched = listed.includes(symbol);
        return <motion.div className="market-row" key={`${market}:${symbol}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <div className={`asset-icon ${market === "CRYPTO" ? "asset-crypto" : "asset-stock"}`}>{market === "CRYPTO" ? symbol.slice(0, 1) : symbol.slice(0, 1)}</div>
          <div className="asset-name"><strong>{symbol.replace("USDT", "")}</strong><span>{SYMBOL_NAMES[symbol]}{isWatched && <span className="watch-star"> · WATCHLIST</span>}</span></div>
          <div className="market-price">{tick ? <AnimatePresence mode="wait" initial={false}><motion.strong key={tick.timestamp} initial={{ opacity: .45, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: .35, y: -3 }} transition={{ duration: .18 }}>{formatMarketPrice(market, tick.price)}</motion.strong></AnimatePresence> : <span className="waiting-price">Awaiting tick</span>}<span className="price-change neutral">—</span></div>
          <button className="trade-mini" onClick={() => onTrade(symbol, market)}>Trade</button>
        </motion.div>;
      })}
      {!loading && displayed.length === 0 && <div className="small-empty">No {market === "NSE" ? "NSE" : "crypto"} instruments in your watchlist yet.</div>}
    </div>
    <div className="market-foot"><span><Radio size={14} /> Live feed · {market === "NSE" ? "Breeze" : "Binance"}</span><a href="#activity">Market activity <ArrowRight size={13} /></a></div>
  </section>;
}

function HoldingsPanel({ portfolio, loading, error, retry, onTrade }: {
  portfolio: LoadState<Portfolio>; loading: boolean; error: string | null; retry: () => void;
  onTrade: (symbol: string, market: Market) => void;
}) {
  const holdings = portfolio.data?.holdings ?? [];
  return <section className="panel holdings-panel" id="holdings">
    <SectionHeader eyebrow="YOUR POSITIONS" title="Holdings" action={<a href="#activity" className="text-button">View activity <ArrowRight size={14} /></a>} />
    {loading ? <LoadingRows count={3} /> : error ? <CardError message={error} retry={retry} /> : holdings.length === 0 ? <div className="card-state holdings-empty"><span className="state-icon mint"><BriefcaseBusiness size={19} /></span><strong>Your portfolio is ready</strong><p>When you place your first paper trade, your positions will show up here.</p><a href="#market-snapshot" className="button button-soft">Explore markets <ArrowRight size={15} /></a></div> : <>
      <div className="holdings-table-head"><span>ASSET</span><span>QUANTITY</span><span>AVG. COST</span><span>MARKET VALUE <small>INR</small></span><span>UNREALIZED P&amp;L</span><span /></div>
      <div className="holdings-list">{holdings.slice(0, 5).map((holding) => <div className="holding-row" key={`${holding.market}:${holding.symbol}`}>
        <div className="holding-asset"><span className={`asset-icon small ${holding.market === "CRYPTO" ? "asset-crypto" : "asset-stock"}`}>{holding.symbol.slice(0, 1)}</span><span><strong>{holding.symbol.replace("USDT", "")}</strong><small>{SYMBOL_NAMES[holding.symbol] ?? holding.market} · {holding.market === "CRYPTO" ? "Crypto" : "NSE"}</small></span></div>
        <span className="table-number">{formatNumber(holding.quantity, holding.market === "CRYPTO" ? 4 : 0)}</span>
        <span className="table-number">{formatINR(holding.avg_cost_inr)}</span>
        <span className="table-number value-number">{formatINR(holding.value)}</span>
        <span className={`pnl-cell ${holding.unrealized_pnl > 0 ? "positive" : holding.unrealized_pnl < 0 ? "negative" : ""}`}>{holding.unrealized_pnl > 0 ? <ArrowUpRight size={13} /> : holding.unrealized_pnl < 0 ? <ArrowDownRight size={13} /> : null}{formatINR(holding.unrealized_pnl)}</span>
        <button className="row-more" aria-label={`Trade ${holding.symbol}`} onClick={() => onTrade(holding.symbol, holding.market)}><ArrowLeftRight size={15} /></button>
      </div>)}</div>
      {holdings.length > 5 && <div className="table-tail">Showing 5 of {holdings.length} positions</div>}
      {portfolio.data?.fx_rate && holdings.some((item) => item.market === "CRYPTO") && <div className="fx-foot"><span className="fx-tag">FX</span><span>Temporary reference · USDT treated at USD parity</span><span>1 USD / USDT = {formatINR(portfolio.data.fx_rate.rate)}</span></div>}
    </>}
  </section>;
}

function LeaderboardPanel({ data, loading, error, retry, isGuest }: {
  data: LoadState<{ rows: LeaderboardEntry[]; totalUsers: number }>; loading: boolean; error: string | null; retry: () => void; isGuest: boolean;
}) {
  const leaders = data.data?.rows ?? [];
  return <section className="panel leaderboard-panel" id="leaderboard">
    <div className="leaderboard-head"><SectionHeader eyebrow="THE COMMUNITY" title="Leaderboard" /><span className="leaderboard-live"><i className="status-dot" /> LIVE</span></div>
    <div className="leaderboard-subtitle"><span>Top traders by portfolio value</span><span>INR</span></div>
    {loading ? <LoadingRows count={5} /> : error ? <CardError message={error} retry={retry} /> : leaders.length === 0 ? <div className="card-state leaderboard-empty"><span className="state-icon mint"><Trophy size={19} /></span><strong>The leaderboard is warming up</strong><p>Make your first move and claim your place on the board.</p></div> : <div className="leader-list">
      <AnimatePresence initial={false}>{leaders.slice(0, 5).map((entry, index) => <motion.div className={`leader-row ${entry.is_you ? "you-row" : ""}`} key={`${entry.rank}:${entry.display_name}`} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: .24, delay: index * .025 }}>
        <span className={`rank-number rank-${entry.rank <= 3 ? entry.rank : "other"}`}>{String(entry.rank).padStart(2, "0")}</span>
        <span className={`leader-avatar leader-avatar-${index % 5}`}>{entry.display_name.trim().slice(0, 1).toUpperCase()}</span>
        <span className="leader-name">{entry.display_name}{entry.is_you && <small>YOU</small>}</span>
        <span className="leader-value">{formatINR(entry.total_value)}</span>
        <span className={`leader-pnl ${entry.pnl >= 0 ? "positive" : "negative"}`}>{formatPct(entry.pnl_pct)}</span>
      </motion.div>)}</AnimatePresence>
      {isGuest && <div className="leaderboard-note"><Sparkles size={13} /> Guest traders compete alongside everyone</div>}
    </div>}
    <div className="leaderboard-foot"><span>{data.data ? `${data.data.totalUsers.toLocaleString("en-IN")} traders competing` : "Updated from the live leaderboard"}</span><Trophy size={15} /></div>
  </section>;
}

function ActivityPanel({ trades, loading, error, retry }: { trades: LoadState<TradesResponse>; loading: boolean; error: string | null; retry: () => void }) {
  return <section className="panel activity-panel" id="activity">
    <SectionHeader eyebrow="YOUR TRADING LOG" title="Recent activity" action={<span className="activity-limit">LATEST 6</span>} />
    {loading ? <LoadingRows count={3} /> : error ? <CardError message={error} retry={retry} /> : !trades.data?.trades.length ? <div className="activity-empty"><span className="activity-empty-icon"><Clock3 size={18} /></span><span><strong>Nothing on the tape yet</strong><small>Your filled paper orders will appear here.</small></span></div> : <div className="activity-list">{trades.data.trades.slice(0, 4).map((trade) => <TradeRow key={trade.trade_id} trade={trade} />)}</div>}
  </section>;
}

function TradeRow({ trade }: { trade: Trade }) {
  return <div className="activity-row"><span className={`trade-side ${trade.side.toLowerCase()}`}>{trade.side === "BUY" ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}</span><span className="activity-symbol"><strong>{trade.side} {trade.symbol.replace("USDT", "")}</strong><small>{formatNumber(trade.quantity, trade.market === "CRYPTO" ? 4 : 0)} {trade.market === "CRYPTO" ? "units" : "shares"} · {new Date(trade.executed_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span><span className="activity-value"><strong>{formatNumber(trade.value)} {trade.quote_currency}</strong><small>at {formatMarketPrice(trade.market, trade.fill_price)}</small></span></div>;
}

export function QuickOrder({ order, portfolio, portfolioError, onClose, onSubmit, busy, error, result }: {
  order: { symbol: string; market: Market } | null; onClose: () => void;
  portfolio?: Portfolio | null;
  portfolioError?: string | null;
  onSubmit: (side: "BUY" | "SELL", quantity: number) => void; busy: boolean; error: string | null; result: OrderResponse | null;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState(order?.market === "CRYPTO" ? "0.01" : "1");
  const tick = useMarketPrice(order?.market ?? "NSE", order?.symbol ?? "");
  const parsedQuantity = Number(quantity);
  const validQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0
    && (order?.market !== "NSE" || Number.isInteger(parsedQuantity))
    && (order?.market !== "CRYPTO" || Number(parsedQuantity.toFixed(8)) === parsedQuantity);
  const quoteCurrency = order?.market === "CRYPTO" ? "USDT" : "INR";
  const estimate = validQuantity && tick
    ? parsedQuantity * tick.price
    : null;
  const position = order ? portfolio?.holdings.find((holding) => holding.symbol === order.symbol && holding.market === order.market) : undefined;
  const estimateInr = order?.market === "CRYPTO" && estimate !== null && portfolio?.fx_rate
    ? estimate * portfolio.fx_rate.rate
    : order?.market === "NSE" ? estimate : null;
  return <AnimatePresence>{order && <motion.div className="modal-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <motion.section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ duration: .2 }}>
      <button className="modal-close" onClick={onClose} aria-label="Close order dialog"><X size={18} /></button>
      {result?.status === "FILLED" ? <div className="order-result"><span className="result-check"><Check size={23} /></span><span className="eyebrow">PAPER ORDER FILLED</span><h2>Order complete</h2><p>{side} {quantity} {order.symbol.replace("USDT", "")} at {formatMarketPrice(order.market, result.fill_price)}</p><div className="result-info"><span>Available cash · INR</span><strong>{result.cash_balance === undefined ? "Updating…" : formatINR(result.cash_balance)}</strong></div><div className="result-info"><span>Order ID</span><strong>{result.order_id.slice(0, 12)}…</strong></div><button className="button button-primary" onClick={onClose}>Done <ArrowRight size={15} /></button></div> : <>
        <div className="modal-eyebrow"><span className="live-label"><i className="status-dot" /> {tick ? "LIVE PRICE" : "WAITING FOR PRICE"}</span><span>{order.market === "NSE" ? "NSE · INR" : "CRYPTO · USDT"}</span></div>
        <h2 id="order-title">Place a paper order</h2><p className="modal-subtitle">{SYMBOL_NAMES[order.symbol]} <span>·</span> {order.symbol}</p>
        <div className="order-quote-row"><span>Current market price</span><strong>{tick ? formatMarketPrice(order.market, tick.price) : "Waiting for feed"}</strong></div>
        <div className="order-quote-row"><span>Available account cash · INR</span><strong>{portfolio ? formatINR(portfolio.cash) : portfolioError ? "Portfolio unavailable" : "Loading portfolio…"}</strong></div>
        {side === "SELL" && <div className="order-quote-row"><span>Available holding</span><strong>{position ? `${formatNumber(position.quantity, order.market === "CRYPTO" ? 8 : 0)} ${order.market === "NSE" ? "shares" : order.symbol.replace("USDT", "")}` : "No open position"}</strong></div>}
        <div className="order-side-toggle"><button className={side === "BUY" ? "buy-selected" : ""} onClick={() => setSide("BUY")}>Buy</button><button className={side === "SELL" ? "sell-selected" : ""} onClick={() => setSide("SELL")}>Sell</button></div>
        <label className="quantity-label" htmlFor="order-quantity">Quantity <span>{order.market === "NSE" ? "whole shares" : "up to 8 decimals"}</span></label>
        <div className="quantity-input"><input id="order-quantity" type="number" min={order.market === "NSE" ? "1" : "0.00000001"} step={order.market === "NSE" ? "1" : "any"} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><span>{order.market === "NSE" ? "shares" : order.symbol.replace("USDT", "")}</span></div>
        <div className="order-quote-row"><span>Estimated order value · {quoteCurrency}</span><strong>{estimate === null ? "Unavailable until a live price arrives" : `${formatNumber(estimate, 2)} ${quoteCurrency}`}</strong></div>
        {order.market === "CRYPTO" && <div className="order-quote-row"><span>Estimated account value · INR</span><strong>{estimateInr === null ? "FX quote unavailable" : formatINR(estimateInr)}</strong></div>}
        {order.market === "CRYPTO" && <div className="order-info-note"><ShieldCheck size={15} /><span>Temporary conversion reference: 1 USD = ₹95; USDT is treated at USD parity. The backend applies this rate to INR cash and portfolio values.</span></div>}
        {order.market === "NSE" && <div className="order-info-note"><ShieldCheck size={15} /><span>Paper trading only. Estimated value uses the displayed INR price; the backend sets the final fill and validates cash or holdings.</span></div>}
        {error && <div className="order-error">{error}</div>}
        <button className={`button ${side === "BUY" ? "button-primary" : "button-sell"} order-submit`} disabled={busy || !validQuantity} onClick={() => onSubmit(side, parsedQuantity)}>{busy ? "Submitting…" : `${side === "BUY" ? "Buy" : "Sell"} ${order.symbol.replace("USDT", "")}`}<ArrowRight size={16} /></button>
        <p className="order-market-note">Market order · execution may differ from the displayed live tick</p>
      </>}
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

function Dashboard() {
  const { session, loading: authLoading, signOut } = useAuth();
  const token = session?.access_token;
  const { socket, connected } = useRealtime();
  const data = useDashboardData(token);
  const [market, setMarket] = useState<Market>("NSE");
  const [order, setOrder] = useState<{ symbol: string; market: Market } | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<OrderResponse | null>(null);
  const orderSubmitting = useRef(false);
  const symbols = useMemo(() => SYMBOLS[market].map((symbol) => ({ market, symbol })), [market]);
  const { prices, connected: priceConnected } = useMarketPrices(symbols);

  useEffect(() => {
    if (!socket) return;
    socket.on("portfolio", data.receivePortfolio);
    socket.on("leaderboard", data.receiveLeaderboard);
    return () => { socket.off("portfolio", data.receivePortfolio); socket.off("leaderboard", data.receiveLeaderboard); };
  }, [socket, data.receivePortfolio, data.receiveLeaderboard]);

  const submitOrder = async (side: "BUY" | "SELL", quantity: number) => {
    if (!token || !order || orderSubmitting.current) return;
    orderSubmitting.current = true;
    setOrderBusy(true); setOrderError(null); setOrderResult(null);
    try {
      const result = await api.placeOrder(token, { symbol: order.symbol, market: order.market, side, quantity });
      if (result.status === "REJECTED") { setOrderError(result.reason ?? "The order could not be completed."); return; }
      setOrderResult(result); data.refresh();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "The order could not be completed.");
    } finally { orderSubmitting.current = false; setOrderBusy(false); }
  };
  const showOrder = (symbol: string, selectedMarket: Market) => { setOrderError(null); setOrderResult(null); setOrder({ symbol, market: selectedMarket }); };

  if (authLoading) return <AuthLoadingScreen />;
  if (!session) return <SignInScreen />;

  const profile = session.user.user_metadata ?? {};
  const name = String(profile.full_name ?? profile.name ?? session.user.email?.split("@")[0] ?? "Trader");
  const avatar = typeof profile.avatar_url === "string" ? profile.avatar_url : undefined;
  const currentHour = Number(new Intl.DateTimeFormat("en-IN", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "2-digit", month: "long", timeZone: "Asia/Kolkata" }).format(new Date()).toUpperCase();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 17 ? "Good afternoon" : "Good evening";
  const portfolio = data.portfolio.data;
  const liveStatus = connected && priceConnected;
  return <div className="app-shell" id="top">
    <TopNavigation name={name} avatar={avatar} connected={connected} activePage="overview" onSignOut={() => void signOut()} />
    <main className="dashboard-main">
      <motion.div className="dashboard-content" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .38, ease: "easeOut" }}>
        <div className="welcome-row"><div><div className="welcome-kicker"><span className="welcome-spark"><Sparkles size={13} /></span> {dateLabel} <span className="welcome-separator">/</span> YOUR MARKET DESK</div><h1>{greeting}, <span>{name.split(" ")[0]}.</span></h1><p>Your market desk is ready. Here’s your portfolio at a glance.</p></div><div className="welcome-actions"><span className={`connection-chip ${liveStatus ? "connected" : "disconnected"}`}><i className="status-dot" />{liveStatus ? "Live connection" : "Reconnecting"}</span><button className="button button-outline" onClick={data.refresh}><RefreshCw size={14} /> Refresh</button></div></div>

        <section className="hero-grid" aria-label="Portfolio summary">
          <div className="portfolio-hero panel">
            <div className="hero-top"><span className="eyebrow">TOTAL PORTFOLIO VALUE <span className="currency-chip">INR</span></span><button className="hero-menu" aria-label="Portfolio information"><CircleHelp size={16} /></button></div>
            {data.portfolio.loading ? <div className="hero-value-skeleton" /> : data.portfolio.error ? <div className="hero-error"><span>Portfolio unavailable</span><button className="text-button" onClick={data.refresh}><RefreshCw size={13} /> Retry</button></div> : <>
              <div className="hero-value">{formatINR(portfolio?.total_value)}</div>
              <div className="hero-pnl-line"><span className={`pnl-chip ${portfolio && portfolio.pnl >= 0 ? "gain" : "loss"}`}>{portfolio && portfolio.pnl >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{formatINR(portfolio?.pnl)} <span>({formatPct(portfolio?.pnl_pct)})</span></span><span className="pnl-since">since starting balance</span></div>
            </>}
            <div className="hero-divider" />
            <div className="hero-metrics">
              <div className="hero-metric"><span><Wallet size={14} /> Available cash</span><strong>{data.portfolio.loading ? "······" : formatINR(portfolio?.cash)}</strong></div>
              <div className="hero-metric"><span><BriefcaseBusiness size={14} /> Invested value</span><strong>{data.portfolio.loading ? "······" : formatINR(portfolio?.holdings_value)}</strong></div>
              <div className="hero-metric fx-metric"><span><Radio size={14} /> Temporary FX reference</span><strong>{portfolio?.fx_rate ? `1 USD / USDT = ${formatINR(portfolio.fx_rate.rate)}` : "Loading reference"}</strong></div>
            </div>
            <div className="hero-decoration"><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><div className="hero-decoration-cross">+</div></div>
          </div>
          <PerformanceCard />
        </section>

        <div className="dashboard-grid">
          <div className="dashboard-column main-column">
            <MarketSnapshot market={market} setMarket={setMarket} symbols={symbols} prices={prices} watchlist={data.watchlist.data} loading={data.watchlist.loading} onTrade={showOrder} />
            <HoldingsPanel portfolio={data.portfolio} loading={data.portfolio.loading} error={data.portfolio.error} retry={data.refresh} onTrade={showOrder} />
            <ActivityPanel trades={data.trades} loading={data.trades.loading} error={data.trades.error} retry={data.refresh} />
          </div>
          <div className="dashboard-column side-column">
            <LeaderboardPanel data={data.leaderboard} loading={data.leaderboard.loading} error={data.leaderboard.error} retry={data.refresh} isGuest={Boolean(session.user.is_anonymous)} />
            <div className="coach-card"><div className="coach-icon"><Sparkles size={16} /></div><div><strong>Every expert started somewhere.</strong><p>Learn the market, make a move, and track your progress.</p></div><a href="#market-snapshot" aria-label="Go to markets"><ArrowRight size={16} /></a><div className="coach-glow" /></div>
          </div>
        </div>
        <footer className="dashboard-footer"><span>TRADEKARO <i>·</i> A SIMULATED MARKET EXPERIENCE</span><span><ShieldCheck size={13} /> No real money is involved</span><a href="#top">Back to top <ArrowUpRight size={13} /></a></footer>
      </motion.div>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Quick navigation"><Link href="/" className="selected" aria-current="page"><LayoutDashboard size={18} /><span>Home</span></Link><Link href="/markets"><Activity size={18} /><span>Markets</span></Link><Link href="/portfolio"><BriefcaseBusiness size={18} /><span>Portfolio</span></Link><Link href="/leaderboard"><Trophy size={18} /><span>Board</span></Link><Link href="/orders"><ArrowLeftRight size={18} /><span>Orders</span></Link></nav>
    <QuickOrder key={`${order?.market}:${order?.symbol}`} order={order} portfolio={data.portfolio.data} portfolioError={data.portfolio.error} onClose={() => { if (!orderBusy) setOrder(null); }} onSubmit={(side, quantity) => void submitOrder(side, quantity)} busy={orderBusy} error={orderError} result={orderResult} />
  </div>;
}

export default function DashboardPage() { return <Dashboard />; }
