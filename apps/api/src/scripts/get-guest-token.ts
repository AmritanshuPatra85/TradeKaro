import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in root .env");
    process.exit(1);
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error || !data.session) {
    console.error("Guest sign-in failed:", error);
    process.exit(1);
  }

  console.log("USER_ID=" + data.user?.id);
  console.log("ACCESS_TOKEN=" + data.session.access_token);
  process.exit(0);
}

main();