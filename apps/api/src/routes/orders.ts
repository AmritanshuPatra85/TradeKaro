import { Router } from "express";
import type { NextFunction, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { redis } from "../redis";
import { getLatestPrice, getFeedHeartbeatAgeMs } from "@tradekaro/shared";
import { syncUser } from "../leaderboard/engine";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { isAllowedSymbol, type Market } from "../lib/symbols";
import { getUsdtInrRate } from "../fx/rate";

const router = Router();

const CRYPTO_FEED_MAX_AGE_MS = 15_000;
const NSE_FEED_MAX_AGE_MS = 30_000;
const CRYPTO_MAX_DECIMALS = 8;
const RPC_TIMEOUT_MS = 10_000;
const SLOW_MS = 1_500;

// TEMPORARY diagnostics for the 1000-user load test. Remove once the stall is found.
let arrivals = 0;
let entered = 0;
let slow = 0;
let failed = 0;
let inflight = 0;
let maxInflight = 0;
setInterval(() => {
  if (arrivals === 0 && inflight === 0) return;
  console.log(
    `[orders] 5s: arrived=${arrivals} passedAuth=${entered} inflight=${inflight} maxInflight=${maxInflight} slow=${slow} failed=${failed}`
  );
  arrivals = 0;
  entered = 0;
  slow = 0;
  failed = 0;
  maxInflight = inflight;
}, 5000).unref();

function countArrival(_req: AuthedRequest, _res: Response, next: NextFunction) {
  arrivals++;
  next();
}

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

router.post("/orders", countArrival, requireAuth, async (req: AuthedRequest, res: Response) => {
  entered++;
  inflight++;
  if (inflight > maxInflight) maxInflight = inflight;
  const t0 = performance.now();
  let tRedis = 0;
  let tRpc = 0;

  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { symbol: requestedSymbol, market, side, quantity } = req.body ?? {};

    if (
      typeof requestedSymbol !== "string" ||
      (market !== "NSE" && market !== "CRYPTO") ||
      (side !== "BUY" && side !== "SELL") ||
      typeof quantity !== "number"
    ) {
      return res.status(400).json({ error: "invalid order payload" });
    }

    const symbol = requestedSymbol.trim().toUpperCase();
    if (!isAllowedSymbol(market as Market, symbol)) {
      return res.status(400).json({ error: `unsupported ${market} symbol` });
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
      // Quiet coins can go longer than 15s between ticks, so check the Binance
      // feed as a whole (heartbeat written on any symbol's tick), not this symbol's age.
      const feedAgeMs = await getFeedHeartbeatAgeMs(redis, "CRYPTO");
      if (feedAgeMs === null || feedAgeMs > CRYPTO_FEED_MAX_AGE_MS) {
        return res.status(422).json({ error: "crypto market data feed is down, try again shortly" });
      }
    }
    tRedis = performance.now() - t0;

    // The RPC keeps fill_price in the market quote currency. The database uses
    // this validated quote only to convert crypto cash movements into INR.
    const fxRate = market === "CRYPTO" ? await getUsdtInrRate() : null;
    if (market === "CRYPTO" && !fxRate) {
      return res.status(503).json({ error: "USDT/INR conversion quote is unavailable or stale; crypto orders are temporarily unavailable" });
    }

    const tr = performance.now();
    const { data, error } = await supabaseAdmin
      .rpc("execute_market_order", {
        p_user_id: userId,
        p_symbol: symbol,
        p_market: market,
        p_side: side,
        p_quantity: quantity,
        p_fill_price: latest.price,
        p_fx_usdt_inr: fxRate?.rate ?? null,
        p_fx_timestamp: fxRate ? new Date(fxRate.timestamp).toISOString() : null,
      })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    tRpc = performance.now() - tr;

    if (error) {
      failed++;
      console.error(`[orders] rpc error after ${Math.round(tRpc)}ms: ${error.message}`);
      const timedOut = /abort|timeout/i.test(error.message);
      return res.status(timedOut ? 504 : 500).json({ error: error.message });
    }

    const result = data?.[0];
    if (!result) {
      return res.status(500).json({ error: "no result from order execution" });
    }

    if (result.status === "REJECTED") {
      return res.status(409).json({
        status: "REJECTED",
        order_id: result.order_id,
        reason: result.reason ?? "order rejected by execution rules",
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
      quote_currency: market === "CRYPTO" ? "USDT" : "INR",
      cash_currency: "INR",
      cash_balance: result.cash_balance,
      holding_quantity: result.holding_quantity,
      holding_avg_cost: result.holding_avg_cost,
    });
  } catch (err) {
    failed++;
    console.error("[orders] handler threw:", err);
    if (!res.headersSent) return res.status(500).json({ error: "internal error" });
  } finally {
    inflight--;
    const total = performance.now() - t0;
    if (total > SLOW_MS) {
      slow++;
      console.warn(
        `[orders] slow ${Math.round(total)}ms (redis ${Math.round(tRedis)}ms, rpc ${Math.round(tRpc)}ms, inflight ${inflight})`
      );
    }
  }
});

export default router;
