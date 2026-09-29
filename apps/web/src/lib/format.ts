import type { Market } from "./api/types";

export const formatINR = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : "—";

export const formatNumber = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : "—";

export const formatPct = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%` : "—";

export const formatMarketPrice = (market: Market, value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Waiting for feed";
  return market === "NSE"
    ? formatINR(value)
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 }).format(value)} USDT`;
};
