import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { redis } from "../redis";
import { getLatestPrice } from "@tradekaro/shared";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import type { Response } from "express";

const router = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

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

  const holdings = await Promise.all(
    (holdingsRes.data ?? []).map(async (h) => {
      const quantity = Number(h.quantity);
      const avgCost = Number(h.avg_cost);
      const latest = await getLatestPrice(redis, h.market as "NSE" | "CRYPTO", h.symbol);

      // No cached price: value at cost and return price: null so the UI can flag it.
      const price = latest ? latest.price : null;
      const valuePrice = price ?? avgCost;
      const value = quantity * valuePrice;
      const unrealized = quantity * (valuePrice - avgCost);

      return {
        symbol: h.symbol,
        market: h.market,
        quantity,
        avg_cost: avgCost,
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
