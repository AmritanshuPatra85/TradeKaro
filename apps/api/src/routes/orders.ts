import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { redis } from "../redis";
import { getLatestPrice, getFeedHeartbeatAgeMs } from "@tradekaro/shared";
import { syncUser } from "../leaderboard/engine";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import type { Response } from "express";

const router = Router();

const CRYPTO_MAX_AGE_MS = 15_000;
const NSE_FEED_MAX_AGE_MS = 30_000;
const CRYPTO_MAX_DECIMALS = 8;

// Returns an error message, or null if the quantity is valid for the market.
function validateQuantity(market: "NSE" | "CRYPTO", quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return "quantity must be a positive number";
  }
  if (market === "NSE") {
    if (!Number.isInteger(quantity)) {
      return "NSE quantity must be a whole number of shares";
    }
    return null;
  }
  // Round-trip check: works for tiny values that print in exponent form (1e-9).
  if (Number(quantity.toFixed(CRYPTO_MAX_DECIMALS)) !== quantity) {
    return `crypto quantity supports at most ${CRYPTO_MAX_DECIMALS} decimal places`;
  }
  return null;
}

router.post("/orders", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { symbol, market, side, quantity } = req.body ?? {};

  if (
    typeof symbol !== "string" ||
    (market !== "NSE" && market !== "CRYPTO") ||
    (side !== "BUY" && side !== "SELL") ||
    typeof quantity !== "number"
  ) {
    return res.status(400).json({ error: "invalid order payload" });
  }

  const qtyError = validateQuantity(market, quantity);
  if (qtyError) {
    return res.status(400).json({ error: qtyError });
  }

  const latest = await getLatestPrice(redis, market, symbol);
  if (!latest) {
    return res.status(422).json({ error: `no live price available for ${symbol}` });
  }

  if (market === "NSE") {
    // Stocks tick only when they trade, so per-symbol age is meaningless.
    // Require the Breeze feed as a whole to be alive instead.
    const feedAgeMs = await getFeedHeartbeatAgeMs(redis, "NSE");
    if (feedAgeMs === null || feedAgeMs > NSE_FEED_MAX_AGE_MS) {
      return res.status(422).json({ error: "NSE market data feed is down, try again shortly" });
    }
  } else {
    const ageMs = Date.now() - latest.timestamp;
    if (ageMs > CRYPTO_MAX_AGE_MS) {
      return res.status(422).json({ error: "price feed is stale, try again shortly" });
    }
  }

  const { data, error } = await supabaseAdmin.rpc("execute_market_order", {
    p_user_id: userId,
    p_symbol: symbol,
    p_market: market,
    p_side: side,
    p_quantity: quantity,
    p_fill_price: latest.price,
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const result = data?.[0];
  if (!result) {
    return res.status(500).json({ error: "no result from order execution" });
  }

  if (result.status === "REJECTED") {
    return res.status(409).json({
      status: "REJECTED",
      order_id: result.order_id,
      reason: "market closed, insufficient balance, or insufficient holdings",
    });
  }

  // Refresh this user's leaderboard entry right away. Failures must not fail the order.
  syncUser(userId).catch((err: unknown) =>
    console.error("[leaderboard] sync after trade failed:", err)
  );

  return res.status(201).json({
    status: "FILLED",
    order_id: result.order_id,
    trade_id: result.trade_id,
    fill_price: latest.price,
    cash_balance: result.cash_balance,
    holding_quantity: result.holding_quantity,
    holding_avg_cost: result.holding_avg_cost,
  });
});

export default router;
