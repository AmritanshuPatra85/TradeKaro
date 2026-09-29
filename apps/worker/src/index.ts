import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

async function main() {
  const { authenticateBreeze, BREEZE_SESSION_UPDATED_CHANNEL } = await import("./breeze/session");
  const { connectBreezeStream, disconnectBreezeStream } = await import("./breeze/stream");
  const { startPriceFeedSubscriber } = await import("./persistence/priceFeedSubscriber");
  const { connectBinanceTickers } = await import("./binance/client");
  const { publishTick } = await import("./feed/publish");
  const { redis } = await import("./redis");

  console.log("[worker] starting up");

  let breezeConnected = false;
  let refreshingBreeze = false;
  let refreshRequested = false;
  const connectWithCurrentSession = async () => {
    if (refreshingBreeze) {
      refreshRequested = true;
      return;
    }
    refreshingBreeze = true;
    try {
      do {
        refreshRequested = false;
        if (breezeConnected) disconnectBreezeStream();
        try {
          await authenticateBreeze();
          connectBreezeStream();
          breezeConnected = true;
          console.log("[worker] Breeze session authenticated; NSE stream connected");
        } catch (err) {
          breezeConnected = false;
          console.error("[worker] Breeze session unavailable:", err instanceof Error ? err.message : String(err));
        }
      } while (refreshRequested);
    } finally {
      refreshingBreeze = false;
    }
  };

  await connectWithCurrentSession();

  const sessionSubscriber = redis.duplicate();
  sessionSubscriber.on("error", (err: unknown) => console.error("[worker] session subscriber error:", err));
  await sessionSubscriber.subscribe(BREEZE_SESSION_UPDATED_CHANNEL);
  sessionSubscriber.on("message", (_channel: string) => {
    void connectWithCurrentSession();
  });

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
