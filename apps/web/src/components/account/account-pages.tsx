"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BriefcaseBusiness,
  ChevronDown, CircleHelp, Clock3, RefreshCw, ShieldCheck, Trophy, Wifi, WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AuthLoadingScreen, SignInScreen, TopNavigation, type PrimaryPage } from "@/components/dashboard/dashboard";
import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { api } from "@/lib/api/client";
import type { LeaderboardEntry, LeaderboardResponse, LeaderboardRoom, LeaderboardUpdate, Portfolio, PortfolioHistoryPeriod, PrivateLeaderboardResponse, Trade } from "@/lib/api/types";
import { formatINR, formatMarketPrice, formatNumber, formatPct } from "@/lib/format";

type LoadState<T> = { data: T | null; loading: boolean; error: string | null };
const initial = <T,>(): LoadState<T> => ({ data: null, loading: true, error: null });
const displaySymbol = (symbol: string) => symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
const nameForSymbol: Record<string, string> = {
  RELIANCE: "Reliance Industries", TCS: "Tata Consultancy Services", INFY: "Infosys",
  HDFCBANK: "HDFC Bank", ICICIBANK: "ICICI Bank", SBIN: "State Bank of India",
  WIPRO: "Wipro", ITC: "ITC Limited", BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum",
  BNBUSDT: "BNB", SOLUSDT: "Solana", XRPUSDT: "XRP", ADAUSDT: "Cardano",
};

function AccountFrame({ page, children }: { page: PrimaryPage; children: React.ReactNode }) {
  const { session, loading: authLoading, signOut } = useAuth();
  const { connected } = useRealtime();
  if (authLoading) return <AuthLoadingScreen />;
  if (!session) return <SignInScreen />;

  const metadata = session.user.user_metadata ?? {};
  const name = String(metadata.full_name ?? metadata.name ?? session.user.email?.split("@")[0] ?? "Trader");
  const avatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url : undefined;
  const mobileItems: { page: PrimaryPage; label: string; icon: typeof Activity }[] = [
    { page: "overview", label: "Home", icon: Activity },
    { page: "markets", label: "Markets", icon: Activity },
    { page: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
    { page: "leaderboard", label: "Board", icon: Trophy },
    { page: "orders", label: "Orders", icon: Clock3 },
  ];
  const hrefs: Record<PrimaryPage, string> = { overview: "/", markets: "/markets", portfolio: "/portfolio", orders: "/orders", leaderboard: "/leaderboard" };
  return <div className="app-shell account-shell">
    <TopNavigation name={name} avatar={avatar} connected={connected} activePage={page} onSignOut={() => void signOut()} />
    <main className="account-main">
      <motion.div className="account-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28, ease: "easeOut" }}>{children}</motion.div>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Quick navigation">{mobileItems.map(({ page: itemPage, label, icon: Icon }) => <Link key={itemPage} href={hrefs[itemPage]} className={page === itemPage ? "selected" : undefined} aria-current={page === itemPage ? "page" : undefined}><Icon size={18} /><span>{label}</span></Link>)}</nav>
  </div>;
}

function PageHeading({ eyebrow, title, description, side }: { eyebrow: string; title: string; description: string; side?: React.ReactNode }) {
  return <header className="account-heading">
    <div><span className="welcome-kicker"><span className="welcome-spark"><Activity size={13} /></span>{eyebrow}</span><h1>{title}<span className="header-period">.</span></h1><p>{description}</p></div>
    {side}
  </header>;
}

function LiveState({ connected, error }: { connected: boolean; error: string | null }) {
  return <span className={`account-live-state ${connected ? "is-live" : "is-offline"}`} title={error ?? undefined}>
    {connected ? <Wifi size={14} /> : <WifiOff size={14} />}{connected ? "Realtime connected" : "Realtime reconnecting"}
  </span>;
}

function SectionError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="account-state account-error" role="alert"><CircleHelp size={20} /><strong>Couldn’t load this section</strong><p>{message}</p><button className="text-button" onClick={retry}><RefreshCw size={13} /> Try again</button></div>;
}

function LoadingLine({ wide = false }: { wide?: boolean }) {
  return <span className={`account-skeleton ${wide ? "is-wide" : ""}`} aria-hidden="true" />;
}

function PortfolioHistoryPanel({ token }: { token: string | undefined }) {
  const [period, setPeriod] = useState<PortfolioHistoryPeriod>("1W");
  const [points, setPoints] = useState<{ timestamp: number; value: number; pnl: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let requestPending = false;
    const controller = new AbortController();
    const load = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const response = await api.portfolioHistory(token, period, controller.signal);
        if (!active) return;
        setPoints(response.points);
        setError(null);
        setLoading(false);
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Portfolio history request failed");
        setLoading(false);
      } finally {
        requestPending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [token, period, revision]);

  const retry = () => { setLoading(true); setError(null); setRevision((value) => value + 1); };
  const hasChart = points.length >= 2;
  const latest = points[points.length - 1];
  const first = points[0];
  const delta = latest && first ? latest.value - first.value : 0;
  const deltaPct = first?.value ? delta / first.value * 100 : 0;
  const minValue = points.length ? Math.min(...points.map((point) => point.value)) : 0;
  const maxValue = points.length ? Math.max(...points.map((point) => point.value)) : 0;
  const span = maxValue - minValue || Math.max(1, Math.abs(maxValue) * 0.0001);
  const coords = points.map((point, index) => ({
    x: 28 + (points.length > 1 ? index / (points.length - 1) : 0.5) * 744,
    y: 18 + ((maxValue - point.value) / span) * 112,
  }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const area = coords.length ? `${line} L ${coords[coords.length - 1].x},148 L ${coords[0].x},148 Z` : "";
  const timeLabel = (timestamp: number) => new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(timestamp);

  return <section className="account-panel performance-empty-panel portfolio-history-panel">
    <div className="account-section-heading history-panel-heading">
      <div><span className="eyebrow">PERFORMANCE</span><h2>Portfolio history</h2></div>
      <div className="history-period-controls" role="group" aria-label="Portfolio history period">
        {(["1D", "1W", "1M"] as const).map((value) => <button key={value} className={period === value ? "selected" : ""} onClick={() => { setLoading(true); setPeriod(value); }}>{value}</button>)}
      </div>
    </div>
    {loading && points.length === 0 ? <div className="history-loading"><span className="history-loading-line" /><span className="history-loading-line short" /><span className="history-loading-line" /></div>
      : error && points.length === 0 ? <div className="history-unavailable" role="alert"><span className="history-unavailable-icon"><CircleHelp size={20} /></span><div><strong>Portfolio history couldn’t load</strong><p>{error}</p><button className="text-button" onClick={retry}><RefreshCw size={13} /> Try again</button></div></div>
        : !hasChart ? <div className="history-unavailable"><span className="history-unavailable-icon"><Clock3 size={20} /></span><div><strong>{points.length === 1 ? "Recording your portfolio history" : "Portfolio history starts now"}</strong><p>{points.length === 1 ? `First real snapshot recorded ${timeLabel(points[0].timestamp)} IST. The chart will appear after another snapshot.` : "Real INR portfolio snapshots are recorded every 15 minutes from today onward. Earlier values are not available."}</p></div></div>
          : <div className="history-chart-wrap">
            <div className="history-chart-summary"><div><span>PORTFOLIO VALUE · INR</span><strong>{formatINR(latest.value)}</strong></div><div className={delta < 0 ? "negative" : "positive"}><span>{period} CHANGE</span><strong>{delta >= 0 ? "+" : ""}{formatINR(delta)} <small>{deltaPct >= 0 ? "+" : ""}{formatPct(deltaPct)}</small></strong></div></div>
            <svg className="portfolio-history-chart" viewBox="0 0 800 166" preserveAspectRatio="none" role="img" aria-label={`Portfolio value history for ${period}`}>
              <defs><linearGradient id="history-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#70e5c2" stopOpacity=".2" /><stop offset="100%" stopColor="#70e5c2" stopOpacity="0" /></linearGradient></defs>
              {[30, 70, 110, 148].map((y) => <line key={y} x1="22" x2="785" y1={y} y2={y} className="history-gridline" />)}
              <path d={area} fill="url(#history-fill)" />
              <path d={line} className="history-line" />
              {coords.length > 0 && <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="3.5" className="history-last-point" />}
            </svg>
            <div className="history-axis-labels"><span>{first ? timeLabel(first.timestamp) : ""} IST</span><span>{latest ? timeLabel(latest.timestamp) : ""} IST</span></div>
            {error && <p className="history-refresh-note">Showing saved history; refresh failed: {error}</p>}
          </div>}
  </section>;
}

function usePortfolioData(token: string | undefined) {
  const [state, setState] = useState<LoadState<Portfolio>>(initial);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setRevision((value) => value + 1);
  }, []);
  const { socket } = useRealtime();

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void api.portfolio(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Portfolio request failed" });
    });
    return () => controller.abort();
  }, [token, revision]);

  useEffect(() => {
    if (!socket) return;
    const onPortfolio = (snapshot: Portfolio) => setState({ data: snapshot, loading: false, error: null });
    socket.on("portfolio", onPortfolio);
    return () => { socket.off("portfolio", onPortfolio); };
  }, [socket]);
  return { ...state, retry };
}

function Metric({ label, value, detail, dominant = false, tone }: { label: string; value: string; detail?: string; dominant?: boolean; tone?: "positive" | "negative" }) {
  return <div className={`account-metric ${dominant ? "metric-dominant" : ""}`}>
    <span className="metric-label">{label}</span>
    <strong className={tone ? `metric-value ${tone}` : "metric-value"}>{value}</strong>
    {detail && <span className="metric-detail">{detail}</span>}
  </div>;
}

function PortfolioView() {
  const { session } = useAuth();
  const realtime = useRealtime();
  const state = usePortfolioData(session?.access_token);
  const data = state.data;
  const holdings = data?.holdings ?? [];
  const pnlTone = data && data.pnl < 0 ? "negative" : "positive";

  return <AccountFrame page="portfolio">
    <PageHeading eyebrow="YOUR ACCOUNT / POSITIONS" title="Portfolio" description="Your positions and performance." side={<div className="base-currency"><span>BASE CURRENCY</span><strong>INR</strong></div>} />

    <section className="account-summary" aria-label="Portfolio summary">
      <div className="account-summary-primary">
        {state.loading && !data ? <><span className="metric-label">TOTAL PORTFOLIO VALUE</span><LoadingLine wide /></> : state.error && !data ? <SectionError message={state.error} retry={state.retry} /> : <Metric dominant label="Total portfolio value · INR" value={formatINR(data?.total_value)} detail={data ? `Base currency · ${data.base_currency}` : undefined} />}
      </div>
      <Metric label="Available cash" value={state.loading && !data ? "—" : formatINR(data?.cash)} detail="INR" />
      <Metric label="Holdings value" value={state.loading && !data ? "—" : formatINR(data?.holdings_value)} detail="INR" />
      <Metric label="Total P&L" value={state.loading && !data ? "—" : formatINR(data?.pnl)} detail={data ? formatPct(data.pnl_pct) : undefined} tone={data ? pnlTone : undefined} />
    </section>

    <PortfolioHistoryPanel token={session?.access_token} />

    <section className="account-panel holdings-section">
      <div className="account-section-heading"><div><span className="eyebrow">CURRENT POSITIONS</span><h2>Holdings <span className="section-count">{state.loading && !data ? "—" : holdings.length}</span></h2></div><div className="section-heading-actions"><LiveState connected={realtime.connected} error={realtime.error} /><Link className="button button-soft" href="/markets">Explore markets <ArrowRight size={14} /></Link></div></div>
      {state.loading && !data ? <div className="holding-loading-list">{[0, 1, 2].map((row) => <div className="holding-loading-row" key={row}><LoadingLine /><LoadingLine /><LoadingLine /></div>)}</div>
        : state.error && !data ? <SectionError message={state.error} retry={state.retry} />
          : holdings.length === 0 ? <div className="account-state account-empty"><span className="account-empty-icon"><BriefcaseBusiness size={19} /></span><strong>No open positions yet</strong><p>Trade an instrument from Markets to see your holdings here.</p><Link className="button button-primary" href="/markets">Explore Markets <ArrowRight size={15} /></Link></div>
            : <>
              <div className="holdings-table-wrap"><table className="account-table holdings-table"><thead><tr><th>Asset</th><th>Market</th><th>Quantity</th><th>Average cost</th><th>Current price</th><th>Position value · INR</th><th>Unrealized P&amp;L · INR</th></tr></thead><tbody>
                {holdings.map((holding) => <tr key={`${holding.market}:${holding.symbol}`}>
                  <td><div className="table-asset"><span className={`asset-icon small ${holding.market === "CRYPTO" ? "asset-crypto" : "asset-stock"}`}>{displaySymbol(holding.symbol).slice(0, 1)}</span><span><strong>{displaySymbol(holding.symbol)}</strong><small>{nameForSymbol[holding.symbol] ?? holding.market}</small></span></div></td>
                  <td><span className={`market-tag ${holding.market === "CRYPTO" ? "crypto" : "nse"}`}>{holding.market}</span></td>
                  <td className="mono">{formatNumber(holding.quantity, holding.market === "CRYPTO" ? 6 : 0)}</td>
                  <td className="mono">{formatMarketPrice(holding.market, holding.avg_cost)}</td>
                  <td className="mono">{holding.price === null ? <span className="muted-price">Waiting for feed</span> : formatMarketPrice(holding.market, holding.price)}</td>
                  <td className="mono value-cell">{formatINR(holding.value)}</td>
                  <td className={`mono pnl-table-cell ${holding.unrealized_pnl > 0 ? "positive" : holding.unrealized_pnl < 0 ? "negative" : ""}`}>{holding.unrealized_pnl > 0 ? <ArrowUpRight size={13} /> : holding.unrealized_pnl < 0 ? <ArrowDownRight size={13} /> : null}{formatINR(holding.unrealized_pnl)}</td>
                </tr>)}
              </tbody></table></div>
              <div className="holdings-mobile-list">{holdings.map((holding) => <article className="holding-mobile-card" key={`${holding.market}:${holding.symbol}`}>
                <div className="holding-mobile-head"><div className="table-asset"><span className={`asset-icon small ${holding.market === "CRYPTO" ? "asset-crypto" : "asset-stock"}`}>{displaySymbol(holding.symbol).slice(0, 1)}</span><span><strong>{displaySymbol(holding.symbol)}</strong><small>{nameForSymbol[holding.symbol] ?? holding.market}</small></span></div><span className={`market-tag ${holding.market === "CRYPTO" ? "crypto" : "nse"}`}>{holding.market}</span></div>
                <div className="holding-mobile-grid"><div><span>Quantity</span><strong>{formatNumber(holding.quantity, holding.market === "CRYPTO" ? 6 : 0)}</strong></div><div><span>Average cost · {holding.quote_currency}</span><strong>{formatMarketPrice(holding.market, holding.avg_cost)}</strong></div><div><span>Current price</span><strong>{formatMarketPrice(holding.market, holding.price)}</strong></div><div><span>Position value · INR</span><strong>{formatINR(holding.value)}</strong></div><div className="holding-mobile-pnl"><span>Unrealized P&amp;L · INR</span><strong className={holding.unrealized_pnl > 0 ? "positive" : holding.unrealized_pnl < 0 ? "negative" : ""}>{formatINR(holding.unrealized_pnl)}</strong></div></div>
              </article>)}</div>
              {data?.fx_rate && holdings.some((holding) => holding.market === "CRYPTO") && <div className="account-fx-note"><ShieldCheck size={14} /><span>Temporary reference: 1 USD = ₹95; USDT is treated at USD parity for INR valuation.</span><strong>1 USDT = {formatINR(data.fx_rate.rate)}</strong></div>}
            </>}
    </section>
    <footer className="account-footer"><span>PORTFOLIO VALUES ARE DENOMINATED IN INR</span><Link href="/markets">Explore Markets <ArrowRight size={13} /></Link></footer>
  </AccountFrame>;
}

function tradeTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(date);
}

function OrdersView() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [trades, setTrades] = useState<Trade[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    setLoading(true); setError(null);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void api.trades(token, 50, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setTrades(response.trades); setNextBefore(response.next_before); setLoading(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Trading activity request failed"); setLoading(false);
    });
    return () => controller.abort();
  }, [token, revision]);

  const loadMore = async () => {
    if (!token || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await api.trades(token, 50, undefined, nextBefore);
      setTrades((current) => [...current, ...response.trades]); setNextBefore(response.next_before);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t load older trades");
    } finally { setLoadingMore(false); }
  };

  return <AccountFrame page="orders">
    <PageHeading eyebrow="YOUR ACCOUNT / ACTIVITY" title="Orders" description="Your trading activity." side={<span className="account-live-state is-neutral"><Activity size={14} /> EXECUTED TRADES</span>} />
    <section className="account-panel orders-panel">
      <div className="account-section-heading orders-heading"><div><span className="eyebrow">ACTIVITY LOG</span><h2>Recent orders</h2></div><span className="activity-count">{loading ? "Loading" : `${trades.length} ${trades.length === 1 ? "trade" : "trades"}`}</span></div>
      <div className="orders-column-labels"><span>Side / Instrument</span><span>Executed</span><span>Quantity</span><span>Fill price</span><span>Trade value</span><span>Status</span></div>
      {loading ? <div className="orders-loading">{[0, 1, 2, 3].map((row) => <div className="orders-loading-row" key={row}><LoadingLine /><LoadingLine /><LoadingLine /></div>)}</div>
        : error && trades.length === 0 ? <SectionError message={error} retry={retry} />
          : trades.length === 0 ? <div className="account-state account-empty"><span className="account-empty-icon"><Clock3 size={19} /></span><strong>No trades yet</strong><p>Your executed orders will appear here.</p><Link className="button button-primary" href="/markets">Explore Markets <ArrowRight size={15} /></Link></div>
            : <div className="order-activity-list">{trades.map((trade) => <TradeActivity key={trade.trade_id} trade={trade} />)}</div>}
      {error && trades.length > 0 && <div className="inline-load-error" role="alert">Couldn’t load more activity: {error}</div>}
      {nextBefore && !loading && <button className="load-more-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading older activity…" : "Load older activity"}<ChevronDown size={15} /></button>}
    </section>
    <div className="activity-contract-note"><ShieldCheck size={14} /><span>This feed lists executed trades from the current API. Pending and rejected order history isn’t exposed by the existing orders contract.</span></div>
    <footer className="account-footer"><span>TRADEKARO · PAPER TRADING ACTIVITY</span><Link href="/markets">Trade from Markets <ArrowRight size={13} /></Link></footer>
  </AccountFrame>;
}

function TradeActivity({ trade }: { trade: Trade }) {
  const time = tradeTime(trade.executed_at);
  return <motion.article className="order-activity-row" layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
    <div className="order-instrument"><span className={`trade-side ${trade.side.toLowerCase()}`}>{trade.side === "BUY" ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}</span><span><strong>{displaySymbol(trade.symbol)}</strong><small>{trade.side} · {trade.market === "CRYPTO" ? "Binance crypto" : "NSE"}</small></span></div>
    <span className="order-time">{time}</span>
    <span className="order-quantity mono">{formatNumber(trade.quantity, trade.market === "CRYPTO" ? 6 : 0)}<small>{trade.market === "CRYPTO" ? displaySymbol(trade.symbol) : "shares"}</small></span>
    <span className="order-fill mono">{formatMarketPrice(trade.market, trade.fill_price)}</span>
    <span className="order-value mono">{formatNumber(trade.value, 2)} {trade.quote_currency}</span>
    <span className="trade-status">EXECUTED</span>
  </motion.article>;
}

function useLeaderboardData(token: string | undefined) {
  const [state, setState] = useState<LoadState<LeaderboardResponse>>(initial);
  const { socket } = useRealtime();
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void api.leaderboard(token, 20, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: reason instanceof Error ? reason.message : "Leaderboard request failed" });
    });
    return () => controller.abort();
  }, [token, revision]);

  useEffect(() => {
    if (!socket || !token) return;
    let active = true;
    const onLeaderboard = (snapshot: LeaderboardUpdate) => {
      setState((current) => ({ data: current.data ? { ...current.data, ...snapshot } : { ...snapshot, you: null }, loading: false, error: null }));
      // The socket snapshot contains the public top list, not the authenticated user's rank.
      // Re-fetch that authoritative field when an event arrives; there is no polling.
      void api.leaderboard(token, 20).then((response) => {
        if (active) setState({ data: response, loading: false, error: null });
      }).catch(() => { /* Keep the newer socket snapshot if this supplemental read fails. */ });
    };
    socket.on("leaderboard", onLeaderboard);
    return () => { active = false; socket.off("leaderboard", onLeaderboard); };
  }, [socket, token]);
  return { ...state, retry };
}

function LeaderboardView() {
  const { session } = useAuth();
  const { connected, error: socketError } = useRealtime();
  const state = useLeaderboardData(session?.access_token);
  const entries = state.data?.leaderboard ?? [];
  const you = state.data?.you;
  return <AccountFrame page="leaderboard">
    <PageHeading eyebrow="TRADEKARO / COMMUNITY" title="Leaderboard" description="See how your portfolio performs against other traders." side={<LiveState connected={connected} error={socketError} />} />
    {you && <section className="your-position-panel"><div><span className="eyebrow">YOUR POSITION</span><strong>#{String(you.rank).padStart(2, "0")}</strong><small>{you.display_name}</small></div><div className="your-position-values"><span>Portfolio P&amp;L · INR</span><strong className={you.pnl >= 0 ? "positive" : "negative"}>{formatINR(you.pnl)}</strong><small>{formatPct(you.pnl_pct)}</small></div></section>}
    <section className="account-panel leaderboard-page-panel">
      <div className="account-section-heading"><div><span className="eyebrow">LIVE RANKING</span><h2>Traders <span className="section-count">{state.data ? state.data.total_users.toLocaleString("en-IN") : "—"}</span></h2></div><span className="base-currency compact"><span>RANKED BY</span><strong>INR P&amp;L</strong></span></div>
      <div className="leaderboard-column-labels"><span>RANK</span><span>TRADER</span><span>PORTFOLIO VALUE</span><span>P&amp;L · INR</span><span>CHANGE</span></div>
      {state.loading && !state.data ? <div className="leaderboard-loading">{[0, 1, 2, 3, 4].map((row) => <div className="leaderboard-loading-row" key={row}><LoadingLine /><LoadingLine /><LoadingLine /></div>)}</div>
        : state.error && !state.data ? <SectionError message={state.error} retry={state.retry} />
          : entries.length === 0 ? <div className="account-state account-empty"><span className="account-empty-icon"><Trophy size={19} /></span><strong>The leaderboard is empty</strong><p>Trader rankings will appear here when the backend has entries.</p></div>
            : <div className="leaderboard-table-list"><AnimatePresence initial={false}>{entries.map((entry, index) => <LeaderboardRow key={`${entry.rank}:${entry.display_name}`} entry={entry} index={index} />)}</AnimatePresence></div>}
      <div className="leaderboard-footnote"><ShieldCheck size={14} /><span>Rank and P&amp;L come from the backend. Crypto valuation uses the temporary reference 1 USD = ₹95 (USDT at USD parity).</span>{!connected && <small>Waiting for realtime updates.</small>}</div>
    </section>
    <footer className="account-footer"><span>LIVE RANKING · {state.data?.base_currency ?? "INR"} BASE CURRENCY</span><Link href="/portfolio">View portfolio <ArrowRight size={13} /></Link></footer>
  </AccountFrame>;
}

function LeaderboardRow({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  return <motion.div className={`leaderboard-account-row ${entry.is_you ? "is-you" : ""}`} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18, delay: Math.min(index, 8) * .018 }}>
    <span className={`account-rank rank-${entry.rank <= 3 ? entry.rank : "other"}`}>{String(entry.rank).padStart(2, "0")}</span>
    <span className="account-trader"><span className={`leader-avatar leader-avatar-${index % 5}`}>{entry.display_name.trim().slice(0, 1).toUpperCase()}</span><strong>{entry.display_name}</strong>{entry.is_you && <small>YOU</small>}</span>
    <span className="mono leaderboard-total">{formatINR(entry.total_value)}</span>
    <span className={`mono leaderboard-pnl ${entry.pnl >= 0 ? "positive" : "negative"}`}>{formatINR(entry.pnl)}</span>
    <span className={`mono leaderboard-pct ${entry.pnl_pct >= 0 ? "positive" : "negative"}`}>{formatPct(entry.pnl_pct)}</span>
  </motion.div>;
}

export function PortfolioPage() { return <PortfolioView />; }
export function OrdersPage() { return <OrdersView />; }
export function LeaderboardPage() { return <LeaderboardView />; }
