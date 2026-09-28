import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import type { Response } from "express";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;

router.get("/trades", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { limit: limitRaw, before, market, symbol } = req.query;

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be a whole number from 1 to ${MAX_LIMIT}` });
    }
  }

  if (before !== undefined) {
    if (typeof before !== "string" || Number.isNaN(Date.parse(before))) {
      return res.status(400).json({ error: "before must be an ISO timestamp" });
    }
  }

  if (market !== undefined && market !== "NSE" && market !== "CRYPTO") {
    return res.status(400).json({ error: "market must be NSE or CRYPTO" });
  }

  if (symbol !== undefined && typeof symbol !== "string") {
    return res.status(400).json({ error: "symbol must be a string" });
  }

  let query = supabaseAdmin
    .from("trades")
    .select("id, order_id, symbol, market, side, quantity, fill_price, executed_at")
    .eq("user_id", userId)
    .order("executed_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("executed_at", before as string);
  if (market) query = query.eq("market", market as string);
  if (symbol) query = query.eq("symbol", symbol as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const trades = (data ?? []).map((t) => {
    const quantity = Number(t.quantity);
    const fillPrice = Number(t.fill_price);
    return {
      trade_id: t.id,
      order_id: t.order_id,
      symbol: t.symbol,
      market: t.market,
      side: t.side,
      quantity,
      fill_price: fillPrice,
      value: round2(quantity * fillPrice),
      executed_at: t.executed_at,
    };
  });

  // Pass this back as ?before= to get the next page. Null means no more pages.
  const nextBefore =
    trades.length === limit ? trades[trades.length - 1].executed_at : null;

  return res.json({ trades, next_before: nextBefore });
});

export default router;
