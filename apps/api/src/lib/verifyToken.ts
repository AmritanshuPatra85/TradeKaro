import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "./supabase";

const authClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface VerifiedUser {
  userId: string;
  isGuest: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Load-test bypass: ONLY active when LOAD_TEST_SECRET is set (16+ chars) and
// NODE_ENV is not "production". Remove before deploy.
function bypassSecret(): string | null {
  const s = process.env.LOAD_TEST_SECRET;
  if (!s || s.length < 16) return null;
  if (process.env.NODE_ENV === "production") return null;
  return s;
}

if (bypassSecret()) {
  console.warn("[auth] WARNING: load-test auth bypass is ENABLED (LOAD_TEST_SECRET is set)");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Even with the right secret, the bypass only works for users named LoadBot-<n>.
const loadBotCache = new Map<string, boolean>();

async function isLoadBot(userId: string): Promise<boolean> {
  const cached = loadBotCache.get(userId);
  if (cached !== undefined) return cached;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  const ok = /^LoadBot-\d+$/.test(data?.display_name ?? "");
  loadBotCache.set(userId, ok);
  return ok;
}

// Returns the verified user, or null if the token is invalid.
export async function verifyToken(token: string): Promise<VerifiedUser | null> {
  if (token.startsWith("loadtest:")) {
    const secret = bypassSecret();
    if (!secret) return null;
    const parts = token.split(":");
    if (parts.length !== 3) return null;
    const [, given, userId] = parts;
    if (!safeEqual(given, secret) || !UUID_RE.test(userId)) return null;
    if (!(await isLoadBot(userId))) return null;
    return { userId, isGuest: true };
  }

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, isGuest: data.user.is_anonymous ?? false };
}
