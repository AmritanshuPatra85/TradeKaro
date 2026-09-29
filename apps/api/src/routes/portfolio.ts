import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { redis } from "../redis";
import { convertToInr, getLatestPrice } from "@tradekaro/shared";
import { getUsdtInrRate } from "../fx/rate";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import type { Response } from "express";

const router = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const HISTORY_PERIODS = { "1D": 24, "1W": 24 * 7, "1M": 24 * 30 } as const;
type HistoryPeriod = keyof typeof HISTORY_PERIODS;

router.get("/portfolio/history", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const rawPeriod = req.query.period;
  const period = rawPeriod === undefined ? "1W" : rawPeriod;
  if (typeof period !== "string" || !Object.prototype.hasOwnProperty.call(HISTORY_PERIODS, period)) {
    return res.status(400).json({ error: "period must be 1D, 1W, or 1M" });
  }

  const since = new Date(Date.now() - HISTORY_PERIODS[period as HistoryPeriod] * 60 * 60 * 1000).toISOString();
  const PAGE_SIZE = 1000;
  const points: { timestamp: number; value: number; pnl: number }[] = [];

  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("portfolio_snapshots")
        .select("captured_at, total_value, pnl")
        .eq("user_id", userId)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;

      const page = data ?? [];
      points.push(...page.map((row) => ({
        timestamp: Date.parse(row.captured_at),
        value: Number(row.total_value),
        pnl: Number(row.pnl),
      })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value) && Number.isFinite(point.pnl)));
      if (page.length < PAGE_SIZE) break;
    }
    return res.json({ base_currency: "INR", period, interval_minutes: 15, points });
  } catch (error) {
    console.error("[portfolio-history] failed to read snapshots:", error);
    return res.status(500).json({ error: "Could not load portfolio history" });
  }
});

router.get("/portfolio", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const [portfolioRes, profileRes, holdingsRes] = await Promise.all([
    supabaseAdmin.from("portfolios").select("cash_balance").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("profiles").select("starting_cash").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("holdings")
      .select("symbol, market, quantity, avg_cost")
      .eq("user_id", userId)
      .order("symbol", { ascending: true }),
  ]);

  if (portfolioRes.error || profileRes.error || holdingsRes.error) {
    const msg =
      portfolioRes.error?.message ?? profileRes.error?.message ?? holdingsRes.error?.message;
    return res.status(500).json({ error: msg });
  }
  if (!portfolioRes.data || !profileRes.data) {
    return res.status(404).json({ error: "portfolio not found" });
  }

  const cash = Number(portfolioRes.data.cash_balance);
  const startingCash = Number(profileRes.data.starting_cash);
  const requiresFx = (holdingsRes.data ?? []).some((holding) => holding.market === "CRYPTO");
  // Return the active conversion reference even for an empty crypto portfolio
  // so the order preview can show the same INR estimate the API will apply.
  const fxRate = await getUsdtInrRate();
  if (requiresFx && !fxRate) {
    return res.status(503).json({ error: "USDT/INR conversion quote is unavailable or stale; crypto portfolio valuation is temporarily unavailable" });
  }

  const holdings = await Promise.all(
    (holdingsRes.data ?? []).map(async (h) => {
      const quantity = Number(h.quantity);
      const avgCost = Number(h.avg_cost);
      const latest = await getLatestPrice(redis, h.market as "NSE" | "CRYPTO", h.symbol);

      // Prices and avg_cost retain their market quote currency. Account values are INR.
      const price = latest ? latest.price : null;
      const quotePrice = price ?? avgCost;
      const quoteCurrency = h.market === "CRYPTO" ? "USDT" : "INR";
      const valuePriceInr = convertToInr(quotePrice, quoteCurrency, fxRate);
      const avgCostInr = convertToInr(avgCost, quoteCurrency, fxRate);
      const value = quantity * valuePriceInr;
      const unrealized = quantity * (valuePriceInr - avgCostInr);

      return {
        symbol: h.symbol,
        market: h.market,
        quantity,
        quote_currency: quoteCurrency,
        avg_cost: avgCost,
        avg_cost_inr: round2(avgCostInr),
        price,
        value: round2(value),
        unrealized_pnl: round2(unrealized),
      };
    })
  );

  const holdingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalValue = cash + holdingsValue;
  const pnl = totalValue - startingCash;

  return res.json({
    base_currency: "INR",
    fx_rate: fxRate,
    cash: round2(cash),
    holdings_value: round2(holdingsValue),
    total_value: round2(totalValue),
    starting_cash: round2(startingCash),
    pnl: round2(pnl),
    pnl_pct: startingCash > 0 ? round2((pnl / startingCash) * 100) : 0,
    holdings,
  });
});

export default router;
