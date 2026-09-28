import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const OUT_FILE = path.resolve(__dirname, "../../../../.loadtest/users.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { supabaseAdmin } = await import("../lib/supabase");

  const i = process.argv.indexOf("--count");
  const count = i >= 0 ? Number(process.argv[i + 1]) : 20;
  if (!Number.isInteger(count) || count < 1 || count > 2000) {
    throw new Error("--count must be a whole number from 1 to 2000");
  }

  // Source of truth: the profiles table. Page through it (Supabase caps rows per query).
  const existing = new Map<number, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .like("display_name", "LoadBot-%")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      const m = /^LoadBot-(\d+)$/.exec(p.display_name ?? "");
      if (m) existing.set(Number(m[1]), p.id);
    }
    if ((data ?? []).length < 1000) break;
  }

  const missing: number[] = [];
  for (let n = 1; n <= count; n++) if (!existing.has(n)) missing.push(n);
  console.log(`existing LoadBots: ${existing.size}, to create: ${missing.length}`);

  let created = 0;
  let failed = 0;
  const queue = [...missing];
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift()!;
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: `loadbot-${n}@loadtest.example.com`,
          password: randomUUID() + randomUUID(),
          email_confirm: true,
          user_metadata: { full_name: `LoadBot-${n}` },
        });
        if (!error && data.user) {
          existing.set(n, data.user.id);
          created++;
          ok = true;
        } else {
          await sleep(500 * attempt);
          if (attempt === 3) console.error(`LoadBot-${n} failed: ${error?.message}`);
        }
      }
      if (!ok) failed++;
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));

  const users: { n: number; id: string }[] = [];
  for (let n = 1; n <= count; n++) {
    const id = existing.get(n);
    if (id) users.push({ n, id });
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(users, null, 2));
  console.log(`created ${created}, failed ${failed}, ready ${users.length}`);
  console.log(`wrote ${OUT_FILE}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("seed crashed:", e);
  process.exit(1);
});
