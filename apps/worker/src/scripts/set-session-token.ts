import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { storeApiSession, authenticateBreeze, notifySessionUpdated } from "../breeze/session";

async function main() {
  const apiSession = process.argv[2];
  if (!apiSession) {
    console.error(
      "Usage: pnpm --filter @tradesim/worker set-session <API_Session from the login redirect URL>"
    );
    process.exit(1);
  }

  try {
    await authenticateBreeze(apiSession);
  } catch (err) {
    console.error("Session verification failed; the existing stored session was left unchanged:", err);
    process.exit(1);
  }

  await storeApiSession(apiSession);
  try {
    await notifySessionUpdated();
    console.log("API_Session verified and stored until India midnight. The running worker was notified to reconnect.");
  } catch (err) {
    console.error("Session is verified and stored until India midnight, but worker notification failed. Restart the worker:", err);
    process.exit(1);
  }
  process.exit(0);
}

main();
