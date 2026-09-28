import path from "path";
import http from "http";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import cors from "cors";
import ordersRouter from "./routes/orders";
import portfolioRouter from "./routes/portfolio";
import tradesRouter from "./routes/trades";
import watchlistRouter from "./routes/watchlist";
import leaderboardRouter from "./routes/leaderboard";
import { attachRealtime } from "./realtime/socket";
import { startLeaderboard } from "./leaderboard/engine";
import { mountMetrics, startMetrics } from "./lib/metrics";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tradekaro-api" });
});

mountMetrics(app); // load-test only, remove before deploy

app.use(ordersRouter);
app.use(portfolioRouter);
app.use(tradesRouter);
app.use(watchlistRouter);
app.use(leaderboardRouter);

const server = http.createServer(app);
attachRealtime(server);

const PORT = process.env.PORT ?? 4000;
server.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  startMetrics(); // load-test only, remove before deploy
  startLeaderboard().catch((err: unknown) =>
    console.error("[leaderboard] failed to start:", err)
  );
});