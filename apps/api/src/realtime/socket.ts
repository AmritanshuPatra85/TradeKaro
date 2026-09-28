import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { redis } from "../redis";
import { getLatestPrice } from "@tradekaro/shared";
import { isAllowedSymbol, type Market } from "../lib/symbols";
import { verifyToken } from "../lib/verifyToken";
import { registerPortfolioPush, pushNow } from "../leaderboard/engine";
import { recordPriceDeliveries, recordPortfolioDeliveries } from "../lib/metrics";

const PRICE_TICKS_CHANNEL = "price-ticks";
const CRYPTO_FLUSH_MS = 250;
const MAX_ITEMS_PER_REQUEST = 100;

interface Tick {
  symbol: string;
  market: Market;
  price: number;
  timestamp: number;
}

interface SubItem {
  market: Market;
  symbol: string;
}

const roomOf = (market: Market, symbol: string) => `price:${market}:${symbol}`;
const userRoom = (userId: string) => `user:${userId}`;

// Returns the validated items, or an error message string.
function parseItems(input: unknown): SubItem[] | string {
  if (!Array.isArray(input) || input.length === 0) {
    return "expected a non-empty array of { market, symbol }";
  }
  if (input.length > MAX_ITEMS_PER_REQUEST) {
    return `too many items (max ${MAX_ITEMS_PER_REQUEST})`;
  }
  const items: SubItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return "invalid item";
    const { market, symbol } = raw as Record<string, unknown>;
    if ((market !== "NSE" && market !== "CRYPTO") || typeof symbol !== "string") {
      return "invalid item";
    }
    const sym = symbol.trim().toUpperCase();
    if (!isAllowedSymbol(market, sym)) {
      return `${sym} is not a supported ${market} symbol`;
    }
    items.push({ market, symbol: sym });
  }
  return items;
}

export function attachRealtime(httpServer: HttpServer): Server {
  // Open CORS for development. Restrict to the real frontend origin before deploy.
  const io = new Server(httpServer, { cors: { origin: "*" } });

  // Reject sockets that do not carry a valid token in the handshake.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) return next(new Error("missing token"));
    const user = await verifyToken(token);
    if (!user) return next(new Error("invalid or expired session"));
    socket.data.userId = user.userId;
    next();
  });

  // Live portfolio push: the engine asks whether anyone is listening for a user
  // and hands us the snapshot to emit to that user's room.
  registerPortfolioPush({
    hasListener: (userId) => io.sockets.adapter.rooms.has(userRoom(userId)),
    emit: (userId, snapshot) => {
      const room = userRoom(userId);
      recordPortfolioDeliveries(io.sockets.adapter.rooms.get(room)?.size ?? 0);
      io.to(room).emit("portfolio", snapshot);
    },
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    console.log(`[realtime] client connected (${io.engine.clientsCount} total)`);

    // The room name comes from the verified token, so a client can only ever
    // receive its own portfolio. Then send the first snapshot.
    Promise.resolve(socket.join(userRoom(userId)))
      .then(() => pushNow(userId))
      .catch((err: unknown) => console.error("[realtime] initial portfolio push failed:", err));

    socket.on("subscribe", async (payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const items = parseItems(payload);
        if (typeof items === "string") return reply({ ok: false, error: items });

        for (const it of items) await socket.join(roomOf(it.market, it.symbol));

        // Send the last known price right away so a new client does not wait for a tick.
        for (const it of items) {
          const latest = await getLatestPrice(redis, it.market, it.symbol);
          if (latest) {
            socket.emit("price", {
              market: it.market,
              symbol: it.symbol,
              price: latest.price,
              timestamp: latest.timestamp,
              snapshot: true,
            });
          }
        }
        reply({ ok: true, subscribed: items.map((i) => `${i.market}:${i.symbol}`) });
      } catch (err) {
        console.error("[realtime] subscribe failed:", err);
        reply({ ok: false, error: "subscribe failed" });
      }
    });

    socket.on("unsubscribe", async (payload: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const items = parseItems(payload);
        if (typeof items === "string") return reply({ ok: false, error: items });
        for (const it of items) await socket.leave(roomOf(it.market, it.symbol));
        reply({ ok: true });
      } catch (err) {
        console.error("[realtime] unsubscribe failed:", err);
        reply({ ok: false, error: "unsubscribe failed" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[realtime] client disconnected (${io.engine.clientsCount} total)`);
    });
  });

  // Fan-out: one Redis subscriber for the whole process. A connection in
  // subscribe mode cannot run normal commands, so it gets its own connection.
  const sub = redis.duplicate();
  sub.on("error", (err: unknown) => console.error("[realtime] redis subscriber error:", err));
  sub.subscribe(PRICE_TICKS_CHANNEL).catch((err: unknown) =>
    console.error("[realtime] subscribe to price-ticks failed:", err)
  );

  const emitTick = (tick: Tick) => {
    const room = roomOf(tick.market, tick.symbol);
    recordPriceDeliveries(io.sockets.adapter.rooms.get(room)?.size ?? 0);
    io.to(room).emit("price", {
      market: tick.market,
      symbol: tick.symbol,
      price: tick.price,
      timestamp: tick.timestamp,
    });
  };

  // Crypto ticks are coalesced: keep only the latest per symbol, flush on a timer.
  const pending = new Map<string, Tick>();

  sub.on("message", (_channel: string, message: string) => {
    let tick: Tick;
    try {
      tick = JSON.parse(message);
    } catch {
      return;
    }
    if (
      !tick ||
      typeof tick.symbol !== "string" ||
      (tick.market !== "NSE" && tick.market !== "CRYPTO") ||
      !Number.isFinite(tick.price)
    ) {
      return;
    }

    const room = roomOf(tick.market, tick.symbol);
    // Nobody is watching this symbol, so skip the work.
    if (!io.sockets.adapter.rooms.has(room)) return;

    if (tick.market === "NSE") {
      emitTick(tick); // stocks tick slowly, no need to throttle
    } else {
      pending.set(room, tick);
    }
  });

  setInterval(() => {
    for (const tick of pending.values()) emitTick(tick);
    pending.clear();
  }, CRYPTO_FLUSH_MS).unref();

  console.log("[realtime] Socket.IO attached");
  return io;
}