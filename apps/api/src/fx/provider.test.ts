import test from "node:test";
import assert from "node:assert/strict";
import { convertToInr, FxRateSchema } from "@tradekaro/shared";
import { isFreshFxRate, ManualUsdtInrReferenceProvider, TEMPORARY_USD_INR_RATE } from "./provider";

test("accepts a positive INR quote for USDT", () => {
  assert.equal(FxRateSchema.safeParse({ base: "USDT", quote: "INR", rate: 83.7, timestamp: 1_800_000_000_000, source: "test" }).success, true);
});

test("rejects zero, missing, or wrong-currency FX quotes", () => {
  assert.equal(FxRateSchema.safeParse({ base: "USDT", quote: "INR", rate: 0, timestamp: 1_800_000_000_000, source: "test" }).success, false);
  assert.equal(FxRateSchema.safeParse({ base: "USD", quote: "INR", rate: 83.7, timestamp: 1_800_000_000_000, source: "test" }).success, false);
});

test("rejects stale and future-dated FX quotes", () => {
  const now = 1_800_000_000_000;
  const quote = { base: "USDT" as const, quote: "INR" as const, rate: 83.7, timestamp: now, source: "test" };
  assert.equal(isFreshFxRate(quote, now + 90_000, 90_000), true);
  assert.equal(isFreshFxRate(quote, now + 90_001, 90_000), false);
  assert.equal(isFreshFxRate({ ...quote, timestamp: now + 5_001 }, now, 90_000), false);
});

test("converts USDT amounts to INR and leaves INR amounts unchanged", () => {
  const quote = { base: "USDT" as const, quote: "INR" as const, rate: 83.7, timestamp: 1_800_000_000_000, source: "test" };
  assert.equal(convertToInr(10, "USDT", quote), 837);
  assert.equal(convertToInr(10, "INR", quote), 10);
  assert.throws(() => convertToInr(10, "USDT", null));
});

test("provides the declared temporary INR 95 reference without external credentials", async () => {
  const quote = await new ManualUsdtInrReferenceProvider().fetchRate();
  assert.equal(quote.base, "USDT");
  assert.equal(quote.quote, "INR");
  assert.equal(quote.rate, 95);
  assert.equal(quote.rate, TEMPORARY_USD_INR_RATE);
  assert.equal(quote.source, "manual-usd-inr-95-usdt-parity");
  assert.equal(isFreshFxRate(quote), true);
});
