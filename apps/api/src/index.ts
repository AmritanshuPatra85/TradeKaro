import path from "path";
import http from "http";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function startApi() {
  // Load environment before importing modules that create Supabase/Redis clients.
  const [expressModule, corsModule, orders, portfolio, trades, watchlist, leaderboard, leaderboardRooms, market, realtime, engine, fx, metrics] = await Promise.all([
    import("express"), import("cors"), import("./routes/orders"), import("./routes/portfolio"),
    import("./routes/trades"), import("./routes/watchlist"), import("./routes/leaderboard"), import("./routes/leaderboard-rooms"),
    import("./routes/market"), import("./realtime/socket"), import("./leaderboard/engine"),
    import("./fx/rate"), import("./lib/metrics"),
  ]);
  const express = expressModule.default;
  const app = express();
  app.use(corsModule.default());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tradekaro-api" });
  });

  metrics.mountMetrics(app); // load-test only, remove before deploy
  app.use(orders.default);
  app.use(portfolio.default);
  app.use(trades.default);
  app.use(watchlist.default);
  app.use(leaderboard.default);
  app.use(leaderboardRooms.default);
  app.use(market.default);

  const server = http.createServer(app);
  realtime.attachRealtime(server);

  const PORT = process.env.PORT ?? 4000;
  server.listen(PORT, () => {
    console.log(`[api] listening on port ${PORT}`);
    metrics.startMetrics(); // load-test only, remove before deploy
    void fx.startFxRateProvider()
      .then(() => engine.startLeaderboard())
      .catch((err: unknown) => console.error("[leaderboard] failed to start:", err));
  });
}

void startApi().catch((err: unknown) => {
  console.error("[api] failed to start:", err);
  process.exitCode = 1;
});
