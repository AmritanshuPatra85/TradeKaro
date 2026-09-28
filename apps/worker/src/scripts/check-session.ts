import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { getStoredApiSession, authenticateBreeze } from "../breeze/session";

async function main() {
  const apiSession = await getStoredApiSession();

  if (!apiSession) {
    console.error(
      "No Breeze API_Session found in Redis (missing or expired).\n" +
        "Log in via the Breeze login flow, copy the API_Session from the redirect URL, then run:\n" +
        "  pnpm --filter @tradekaro/worker set-session <API_Session>"
    );
    process.exit(1);
  }

  try {
    await authenticateBreeze();
    console.log("Breeze session is valid and verified for today.");
    process.exit(0);
  } catch (err) {
    console.error(
      "A session is stored but Breeze rejected it (likely expired or invalidated).\n" +
        "Get a fresh API_Session and run:\n" +
        "  pnpm --filter @tradekaro/worker set-session <API_Session>"
    );
    console.error(err);
    process.exit(1);
  }
}

main();
