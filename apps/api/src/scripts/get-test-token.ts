import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = "tester@tradekaro.test";
const TEST_PASSWORD = "TradeKaro-Test-123!";

async function main() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    console.error("Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY in root .env");
    process.exitCode = 1;
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });

  const created = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (created.error) {
    console.log("createUser note (fine if user already exists):", created.error.message);
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error || !data.session) {
    console.error("Sign-in failed:", error);
    process.exitCode = 1;
    return;
  }

  console.log("USER_ID=" + data.user.id);
  console.log("ACCESS_TOKEN=" + data.session.access_token);
}

main();