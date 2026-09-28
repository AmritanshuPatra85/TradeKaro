import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { io } from "socket.io-client";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const API = process.env.API ?? "http://localhost:4000";
const SB = "https://oiwjvjzwzoajcyauojnl.supabase.co";
const KEY = "sb_publishable_mF4DLKyui1dM7nl_cwxWRw_rx4JHYA_";
const SECRET = process.env.LOAD_TEST_SECRET ?? "";
const USERS_FILE = path.resolve(__dirname, "../../../../.loadtest/users.json");

const check = (name: string, ok: boolean, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);

async function status(token: string): Promise<number> {
  const r = await fetch(`${API}/portfolio`, { headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}

function socketResult(token: string): Promise<string> {
  return new Promise((resolve) => {
    const s = io(API, { auth: { token }, reconnection: false });
    const done = (v: string) => {
      s.close();
      resolve(v);
    };
    s.on("portfolio", () => done("portfolio"));
    s.on("connect_error", (e) => done(`rejected: ${e.message}`));
    setTimeout(() => done("timeout"), 5000);
  });
}

async function main() {
  check("LOAD_TEST_SECRET is set in .env", SECRET.length >= 16);
  const users: { n: number; id: string }[] = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  check("users.json has LoadBots", users.length >= 1, `${users.length} users`);
  const bot = users[0];
  const good = `loadtest:${SECRET}:${bot.id}`;

  check("REST accepts a LoadBot token", (await status(good)) === 200);
  check("REST rejects a wrong secret", (await status(`loadtest:wrongwrongwrongwrong:${bot.id}`)) === 401);
  check("REST rejects a malformed token", (await status("loadtest:onlytwo")) === 401);

  // A real guest must not be reachable through the bypass, even with the right secret.
  const gr = await fetch(`${SB}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: "{}",
  });
  const gj: any = await gr.json();
  const realId: string = gj.user?.id;
  check("got a real guest id for the impersonation check", typeof realId === "string");
  check(
    "REST rejects a real (non-LoadBot) user id",
    (await status(`loadtest:${SECRET}:${realId}`)) === 401
  );

  check("socket accepts a LoadBot token and pushes a snapshot", (await socketResult(good)) === "portfolio");
  const bad = await socketResult(`loadtest:wrongwrongwrongwrong:${bot.id}`);
  check("socket rejects a wrong secret", bad.startsWith("rejected"), bad);

  process.exit(0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
