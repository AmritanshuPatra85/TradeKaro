import WebSocket from "ws";

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  eventTime: number;
};

type OnTick = (tick: BinanceTicker) => void;

export function connectBinanceTickers(symbols: string[], onTick: OnTick): void {
  const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");
  const url = `${BINANCE_WS_BASE}?streams=${streams}`;

  let reconnectDelay = RECONNECT_BASE_DELAY_MS;
  let ws: WebSocket | null = null;

  function connect() {
    ws = new WebSocket(url);

    ws.on("open", () => {
      console.log(`[binance] connected, subscribed to ${symbols.length} tickers`);
      reconnectDelay = RECONNECT_BASE_DELAY_MS;
    });

    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        const data = parsed.data;
        if (!data) return;

        const tick: BinanceTicker = {
          symbol: data.s,
          lastPrice: data.c,
          priceChangePercent: data.P,
          eventTime: data.E,
        };
        onTick(tick);
      } catch (err) {
        console.error("[binance] failed to parse message:", err);
      }
    });

    ws.on("close", (code, reason) => {
      console.warn(
        `[binance] connection closed (code ${code}, reason: ${reason.toString() || "none"}). Reconnecting in ${reconnectDelay}ms...`
      );
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[binance] websocket error:", err);
      ws?.close();
    });
  }

  function scheduleReconnect() {
    setTimeout(() => {
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    }, reconnectDelay);
  }

  connect();
}
