import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { authenticateBreeze } from "../breeze/session";
import { getBreezeClient } from "../breeze/client";

const NSE_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "HINDUNILVR",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "KOTAKBANK",
];

async function main() {
  await authenticateBreeze();
  const client = getBreezeClient();

  for (const symbol of NSE_SYMBOLS) {
    try {
      const result = await client.getNames({
        exchangeCode: "NSE",
        stockCode: symbol,
      });
      console.log(`${symbol} ->`, JSON.stringify(result));
    } catch (err) {
      console.error(`${symbol} -> FAILED:`, err);
    }
  }

  process.exit(0);
}

main();
