import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import type { Candle } from "@tradekaro/shared";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const loadApiRouteModule = createRequire(__filename);
const { createMarketRouter, mapCandleRow } = loadApiRouteModule("./market") as typeof import("./market");

const minute = 60_000;
const oldCandle: Candle = {
  market: "NSE", symbol: "RELIANCE", timeframe: "1m", bucketStart: 1_800_000_000_000,
  open: 100, high: 104, low: 98, close: 102.5,
};
const newCandle: Candle = {
  market: "NSE", symbol: "RELIANCE", timeframe: "1m", bucketStart: oldCandle.bucketStart + minute,
  open: 102.5, high: 105, low: 101, close: 104.25,
};

async function requestCandles(
  url: string,
  reader: (query: { market: "NSE" | "CRYPTO"; symbol: string; limit: number }) => Promise<Candle[]>,
) {
  const app = express();
  app.use(createMarketRouter(reader));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${url}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("returns supported candle rows publicly with canonical fields and unchanged OHLC", async () => {
  let received: unknown;
  const response = await requestCandles("/market/candles?market=NSE&symbol=reliance", async (query) => {
    received = query;
    return [newCandle, oldCandle];
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { market: "NSE", symbol: "RELIANCE", limit: 500 });
  assert.deepEqual(await response.json(), {
    market: "NSE", symbol: "RELIANCE", timeframe: "1m", candles: [oldCandle, newCandle],
  });
});

test("uses an explicit valid limit and rejects zero, non-integers, and values above the maximum", async () => {
  let receivedLimit = 0;
  const response = await requestCandles("/market/candles?market=CRYPTO&symbol=BTCUSDT&limit=3", async (query) => {
    receivedLimit = query.limit;
    return [];
  });
  assert.equal(response.status, 200);
  assert.equal(receivedLimit, 3);

  for (const limit of ["0", "1.5", "1001", "nope"]) {
    const invalid = await requestCandles(`/market/candles?market=CRYPTO&symbol=BTCUSDT&limit=${limit}`, async () => []);
    assert.equal(invalid.status, 400, `expected ${limit} to be rejected`);
  }
});

test("rejects unsupported symbols and markets before reading the database", async () => {
  let reads = 0;
  const reader = async () => { reads += 1; return []; };
  const invalidSymbol = await requestCandles("/market/candles?market=NSE&symbol=NOTREAL", reader);
  assert.equal(invalidSymbol.status, 400);
  assert.match(((await invalidSymbol.json()) as { error: string }).error, /not a supported NSE symbol/);
  const invalidMarket = await requestCandles("/market/candles?market=FX&symbol=BTCUSDT", reader);
  assert.equal(invalidMarket.status, 400);
  assert.equal(reads, 0);
});

test("returns an empty candle array when storage has no matching rows", async () => {
  const response = await requestCandles("/market/candles?market=CRYPTO&symbol=ETHUSDT", async () => []);
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as { candles: Candle[] }).candles, []);
});

test("maps the persisted ISO bucket timestamp and OHLC columns without rescaling", () => {
  const candle = mapCandleRow({
    symbol: "RELIANCE", market: "NSE", timeframe: "1m",
    bucket_start: "2026-09-29T03:20:00.000Z", open: 1208.9, high: 1210.25, low: 1206.4, close: 1209.75,
  });
  assert.deepEqual(candle, {
    symbol: "RELIANCE", market: "NSE", timeframe: "1m", bucketStart: Date.parse("2026-09-29T03:20:00.000Z"),
    open: 1208.9, high: 1210.25, low: 1206.4, close: 1209.75,
  });
});
