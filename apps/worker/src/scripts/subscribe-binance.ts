import { connectBinanceTickers, BinanceTicker } from "../binance/client";
import { publishTick } from "../feed/publish";
import type { PriceTick } from "../feed/types";

const BINANCE_PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "POLUSDT", "LTCUSDT", "TRXUSDT", "SHIBUSDT", "ATOMUSDT",
  "UNIUSDT", "XLMUSDT", "NEARUSDT", "ETCUSDT", "FILUSDT",
];

function toPriceTick(raw: BinanceTicker): PriceTick {
  return {
    symbol: raw.symbol,
    market: "CRYPTO",
    price: Number(raw.lastPrice),
    timestamp: raw.eventTime,
  };
}

connectBinanceTickers(BINANCE_PAIRS, (raw) => {
  const tick = toPriceTick(raw);
  console.log(`[${tick.symbol}] price=${tick.price}`);
  void publishTick(tick);
});
