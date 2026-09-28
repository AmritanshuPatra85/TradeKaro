import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { storeApiSession, authenticateBreeze } from "../breeze/session";

async function main() {
  const apiSession = process.argv[2];
  if (!apiSession) {
    console.error(
      "Usage: pnpm --filter @tradesim/worker set-session <API_Session from the login redirect URL>"
    );
    process.exit(1);
  }

  await storeApiSession(apiSession);

  try {
    await authenticateBreeze();
    console.log("API_Session stored and verified — Breeze session is live for today.");
    process.exit(0);
  } catch (err) {
    console.error("Stored the session, but verification failed:", err);
    process.exit(1);
  }
}

main();
