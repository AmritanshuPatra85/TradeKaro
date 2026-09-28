export function getBreezeConfig() {
  const apiKey = process.env.BREEZE_API_KEY;
  const apiSecret = process.env.BREEZE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Missing BREEZE_API_KEY / BREEZE_API_SECRET in environment");
  }

  return { apiKey, apiSecret };
}
