import { redis } from "../redis";
import { getBreezeConfig } from "./config";
import { getBreezeClient } from "./client";

const API_SESSION_REDIS_KEY = "breeze:api_session";

// The API_Session from the browser login is reusable all day (per ICICI's
// docs, it expires at midnight) — so we persist *that*, not a derived
// token, and call generateSession() against it every time the worker starts.
export async function storeApiSession(apiSession: string): Promise<void> {
  await redis.set(API_SESSION_REDIS_KEY, apiSession, "EX", 20 * 60 * 60);
}

export async function getStoredApiSession(): Promise<string | null> {
  return redis.get(API_SESSION_REDIS_KEY);
}

export async function authenticateBreeze(): Promise<void> {
  const apiSession = await getStoredApiSession();
  if (!apiSession) {
    throw new Error(
      "No Breeze API_Session in Redis. Run: pnpm --filter @tradesim/worker set-session <API_Session>"
    );
  }

  const { apiSecret } = getBreezeConfig();
  const client = getBreezeClient();
  await client.generateSession(apiSecret, apiSession);
}
