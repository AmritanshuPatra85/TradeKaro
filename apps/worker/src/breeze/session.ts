import { redis } from "../redis";
import { getBreezeConfig } from "./config";
import { getBreezeClient } from "./client";

const API_SESSION_REDIS_KEY = "breeze:api_session";
export const BREEZE_SESSION_UPDATED_CHANNEL = "breeze:session_updated";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function secondsUntilIndiaMidnight(now = Date.now()): number {
  const nowInIndia = new Date(now + IST_OFFSET_MS);
  const nextMidnightUtc = Date.UTC(
    nowInIndia.getUTCFullYear(),
    nowInIndia.getUTCMonth(),
    nowInIndia.getUTCDate() + 1,
  ) - IST_OFFSET_MS;
  return Math.max(1, Math.ceil((nextMidnightUtc - now) / 1000));
}

// The API_Session from the browser login is reusable all day (per ICICI's
// docs, it expires at midnight) — so we persist *that*, not a derived
// token, and call generateSession() against it every time the worker starts.
export async function storeApiSession(apiSession: string): Promise<void> {
  await redis.set(API_SESSION_REDIS_KEY, apiSession, "EX", secondsUntilIndiaMidnight());
}

export async function getStoredApiSession(): Promise<string | null> {
  return redis.get(API_SESSION_REDIS_KEY);
}

export async function authenticateBreeze(apiSessionOverride?: string): Promise<void> {
  const apiSession = apiSessionOverride ?? await getStoredApiSession();
  if (!apiSession) {
    throw new Error(
      "No Breeze API_Session in Redis. Run: pnpm --filter @tradesim/worker set-session <API_Session>"
    );
  }

  const { apiSecret } = getBreezeConfig();
  const client = getBreezeClient();
  await client.generateSession(apiSecret, apiSession);
}

export async function notifySessionUpdated(): Promise<void> {
  await redis.publish(BREEZE_SESSION_UPDATED_CHANNEL, "updated");
}
