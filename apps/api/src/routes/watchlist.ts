import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { redis } from "../redis";
import { getLatestPrice } from "@tradekaro/shared";
import { isAllowedSymbol, type Market } from "../lib/symbols";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import type { Response } from "express";

const router = Router();

const MAX_WATCHLIST = 50;

const isMarket = (m: unknown): m is Market => m === "NSE" || m === "CRYPTO";

router.get("/watchlist", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { data, error } = await supabaseAdmin
    .from("watchlist")
    .select("symbol, market, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const watchlist = await Promise.all(
    (data ?? []).map(async (w) => {
      const latest = await getLatestPrice(redis, w.market as Market, w.symbol);
      return {
        symbol: w.symbol,
        market: w.market,
        price: latest ? latest.price : null,
        added_at: w.created_at,
      };
    })
  );

  return res.json({ watchlist });
});

router.post("/watchlist", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { symbol: symbolRaw, market } = req.body ?? {};
  if (typeof symbolRaw !== "string" || !isMarket(market)) {
    return res.status(400).json({ error: "invalid watchlist payload" });
  }
  const symbol = symbolRaw.trim().toUpperCase();

  if (!isAllowedSymbol(market, symbol)) {
    return res.status(400).json({ error: `${symbol} is not a supported ${market} symbol` });
  }

  const existing = await supabaseAdmin
    .from("watchlist")
    .select("symbol", { count: "exact" })
    .eq("user_id", userId);
  if (existing.error) return res.status(500).json({ error: existing.error.message });

  const alreadyThere = (existing.data ?? []).some((r) => r.symbol === symbol);
  if (alreadyThere) {
    // Adding twice is a harmless no-op.
    const check = await supabaseAdmin
      .from("watchlist")
      .select("symbol")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("market", market)
      .maybeSingle();
    if (check.data) return res.status(200).json({ symbol, market, added: false });
  }

  if ((existing.count ?? 0) >= MAX_WATCHLIST) {
    return res.status(409).json({ error: `watchlist is full (max ${MAX_WATCHLIST})` });
  }

  const { error } = await supabaseAdmin
    .from("watchlist")
    .upsert({ user_id: userId, symbol, market }, { onConflict: "user_id,symbol,market", ignoreDuplicates: true });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({ symbol, market, added: true });
});

router.delete("/watchlist/:market/:symbol", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { market, symbol } = req.params;
  if (!isMarket(market)) {
    return res.status(400).json({ error: "market must be NSE or CRYPTO" });
  }

  const { error } = await supabaseAdmin
    .from("watchlist")
    .delete()
    .eq("user_id", userId)
    .eq("market", market)
    .eq("symbol", symbol.toUpperCase());
  if (error) return res.status(500).json({ error: error.message });

  // 204 whether or not the entry existed.
  return res.status(204).send();
});

export default router;
