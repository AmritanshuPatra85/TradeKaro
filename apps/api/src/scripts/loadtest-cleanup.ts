import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

import { redis } from "../redis";
import { supabaseAdmin } from "../lib/supabase";

// LOAD-TEST ONLY. Removes every LoadBot-<n> user, their Postgres data
// (via ON DELETE CASCADE) and their leaderboard keys in Redis.
// Dry run by default. Pass --yes to actually delete.

const PNL_KEY = "lb:pnl";
const ENTRIES_KEY = "lb:entries";
const BATCH = 10;
const USERS_FILE = path.resolve(__dirname, "../../../../.loadtest/users.json");

async function findLoadBots(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", "LoadBot-%")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`profiles: ${error.message}`);
    const page = data ?? [];
    for (const r of page) {
      // Strict check in JS so only names of the exact form LoadBot-<digits> match.
      if (typeof r.display_name === "string" && /^LoadBot-\d+$/.test(r.display_name)) {
        out.push({ id: r.id as string, name: r.display_name });
      }
    }
    if (page.length < PAGE) break;
  }
  return out;
}

// Remove one user's leaderboard footprint from Redis.
async function sweepRedis(userId: string): Promise<void> {
  const posKeys = await redis.smembers(`lb:userpos:${userId}`);
  const pipe = redis.pipeline();
  for (const k of posKeys) pipe.srem(`lb:holders:${k}`, userId);
  pipe.zrem(PNL_KEY, userId);
  pipe.hdel(ENTRIES_KEY, userId);
  pipe.del(`lb:portfolio:${userId}`);
  pipe.del(`lb:userpos:${userId}`);
  await pipe.exec();
}

async function main() {
  const confirm = process.argv.includes("--yes");
  const bots = await findLoadBots();
  console.log(`Found ${bots.length} LoadBot user(s).`);
  if (bots.length === 0) return;

  if (!confirm) {
    for (const b of bots.slice(0, 10)) console.log(`  ${b.name}  ${b.id}`);
    if (bots.length > 10) console.log(`  ... and ${bots.length - 10} more`);
    console.log("Dry run only. Re-run with --yes to delete them.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < bots.length; i += BATCH) {
    const batch = bots.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (b) => {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(b.id);
        if (error) {
          failed++;
          console.error(`  FAILED ${b.name} ${b.id}: ${error.message}`);
          return;
        }
        await sweepRedis(b.id);
        deleted++;
      })
    );
    console.log(`  progress: ${Math.min(i + BATCH, bots.length)}/${bots.length}`);
  }

  console.log(`Deleted ${deleted}, failed ${failed}.`);
  if (failed === 0 && fs.existsSync(USERS_FILE)) {
    fs.unlinkSync(USERS_FILE);
    console.log("Removed .loadtest/users.json");
  }
}

main()
  .catch((err) => {
    console.error("cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.quit().catch(() => {});
  });