import { FxRateSchema, type FxRate } from "@tradekaro/shared";

export interface UsdtInrProvider {
  readonly name: string;
  fetchRate(): Promise<FxRate>;
}

/**
 * Temporary platform reference requested for paper trading:
 * 1 USD = INR 95, with USDT treated at USD parity.
 * This is a declared assumption, not a live market FX quote.
 */
export const TEMPORARY_USD_INR_RATE = 95;

export class ManualUsdtInrReferenceProvider implements UsdtInrProvider {
  readonly name = "manual-usd-inr-95-usdt-parity";

  async fetchRate(): Promise<FxRate> {
    return FxRateSchema.parse({
      base: "USDT",
      quote: "INR",
      rate: TEMPORARY_USD_INR_RATE,
      timestamp: Date.now(),
      source: this.name,
    });
  }
}

export function isFreshFxRate(rate: FxRate, now = Date.now(), maxAgeMs = 90_000): boolean {
  return rate.timestamp <= now + 5_000 && now - rate.timestamp <= maxAgeMs;
}
