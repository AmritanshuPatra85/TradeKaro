import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

async function main() {
  const { authenticateBreeze } = await import("./breeze/session");
  const { connectBreezeStream } = await import("./breeze/stream");
  const { startPriceFeedSubscriber } = await import("./persistence/priceFeedSubscriber");
  const { connectBinanceTickers } = await import("./binance/client");
  const { publishTick } = await import("./feed/publish");

  console.log("[worker] starting up");

  try {
    await authenticateBreeze();
    console.log("[worker] Breeze session authenticated");
  } catch (err) {
    console.error("[worker]", (err as Error).message);
  }

  connectBreezeStream();
  startPriceFeedSubscriber();

  const BINANCE_PAIRS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
    "POLUSDT", "LTCUSDT", "TRXUSDT", "SHIBUSDT", "ATOMUSDT",
    "UNIUSDT", "XLMUSDT", "NEARUSDT", "ETCUSDT", "FILUSDT",
  ];

  connectBinanceTickers(BINANCE_PAIRS, (raw) => {
    const tick = {
      symbol: raw.symbol,
      market: "CRYPTO" as const,
      price: Number(raw.lastPrice),
      timestamp: raw.eventTime,
    };
    console.log(`[${tick.symbol}] price=${tick.price}`);
    void publishTick(tick);
  });
}

main();
