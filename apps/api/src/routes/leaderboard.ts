import { Router } from "express";
import { redis } from "../redis";
import { PNL_KEY, ENTRIES_KEY, type LeaderboardEntry } from "../leaderboard/engine";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { getUsdtInrRate } from "../fx/rate";
import type { Response } from "express";

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.get("/leaderboard", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  let limit = DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be a whole number from 1 to ${MAX_LIMIT}` });
    }
  }

  const ids = await redis.zrevrange(PNL_KEY, 0, limit - 1);
  const raws = ids.length ? await redis.hmget(ENTRIES_KEY, ...ids) : [];

  const leaderboard = ids.flatMap((id, i) => {
    const raw = raws[i];
    if (!raw) return [];
    const e: LeaderboardEntry = JSON.parse(raw);
    return [{ rank: i + 1, ...e, is_you: id === userId }];
  });

  let you: (LeaderboardEntry & { rank: number }) | null = null;
  const myRank = await redis.zrevrank(PNL_KEY, userId);
  if (myRank !== null) {
    const raw = await redis.hget(ENTRIES_KEY, userId);
    if (raw) you = { rank: myRank + 1, ...(JSON.parse(raw) as LeaderboardEntry) };
  }

  const totalUsers = await redis.zcard(PNL_KEY);
  const fxRate = await getUsdtInrRate();
  if (!fxRate) {
    return res.status(503).json({ error: "USDT/INR conversion quote is unavailable or stale; leaderboard valuation is temporarily unavailable" });
  }
  return res.json({ base_currency: "INR", fx_rate: fxRate, leaderboard, you, total_users: totalUsers });
});

export default router;
