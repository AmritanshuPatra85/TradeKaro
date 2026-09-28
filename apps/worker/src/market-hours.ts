export type Market = "NSE" | "CRYPTO";

const NSE_OPEN_MINUTES = 9 * 60 + 15;  // 9:15 AM
const NSE_CLOSE_MINUTES = 15 * 60 + 30; // 3:30 PM

// Does NOT account for NSE trading holidays (Diwali, Republic Day, etc.) —
// fine for a demo, but add a static holiday-date list before relying on
// this across a real multi-day period.
export function isMarketOpen(market: Market, at: Date = new Date()): boolean {
  if (market === "CRYPTO") return true;

  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(at.getTime() + istOffsetMs);

  const day = istTime.getUTCDay();
  if (day === 0 || day === 6) return false;

  const minutesSinceMidnight = istTime.getUTCHours() * 60 + istTime.getUTCMinutes();
  return minutesSinceMidnight >= NSE_OPEN_MINUTES && minutesSinceMidnight <= NSE_CLOSE_MINUTES;
}
