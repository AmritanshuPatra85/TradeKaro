import { FxRateSchema, type FxRate } from "@tradekaro/shared";
import { redis } from "../redis";
import { ManualUsdtInrReferenceProvider, isFreshFxRate, type UsdtInrProvider } from "./provider";

export const FX_RATE_KEY = "fx:USDT:INR";
export const FX_RATE_CHANNEL = "fx-rates";
export const FX_RATE_MAX_AGE_MS = 90_000;
const FX_REFRESH_MS = 30_000;
const FX_CACHE_TTL_SECONDS = 120;
const manualReference = new ManualUsdtInrReferenceProvider();

export async function getUsdtInrRate(): Promise<FxRate | null> {
  const raw = await redis.get(FX_RATE_KEY);
  // The selected manual reference is fixed by policy, so cache absence or expiry
  // must not prevent an order while the startup refresh is warming Redis.
  if (!raw) return manualReference.fetchRate();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return manualReference.fetchRate(); }
  const parsed = FxRateSchema.safeParse(value);
  return parsed.success && isFreshFxRate(parsed.data, Date.now(), FX_RATE_MAX_AGE_MS)
    ? parsed.data
    : manualReference.fetchRate();
}

export async function startFxRateProvider(provider: UsdtInrProvider = manualReference): Promise<void> {
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const rate = await provider.fetchRate();
      if (!isFreshFxRate(rate, Date.now(), FX_RATE_MAX_AGE_MS)) throw new Error("FX provider quote is stale");
      await redis.set(FX_RATE_KEY, JSON.stringify(rate), "EX", FX_CACHE_TTL_SECONDS);
      await redis.publish(FX_RATE_CHANNEL, JSON.stringify(rate));
    } catch (error) {
      console.error("[fx] conversion reference refresh failed:", error);
    } finally {
      refreshing = false;
    }
  };
  await refresh();
  setInterval(() => void refresh(), FX_REFRESH_MS).unref();
}
