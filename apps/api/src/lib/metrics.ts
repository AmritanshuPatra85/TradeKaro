import type { Express } from "express";
import { monitorEventLoopDelay } from "perf_hooks";

// LOAD-TEST ONLY. Remove this file and its wiring before deploy.

const SAMPLE_MS = 1000;
const MAX_WINDOWS = 600;

export interface MetricsWindow {
  seq: number;
  ts: number;
  loopLagMs: { p50: number; p95: number; p99: number; max: number };
  rssMb: number;
  heapUsedMb: number;
  priceDeliveries: number;
  portfolioDeliveries: number;
  recomputeCycles: number;
  recomputeMsAvg: number;
  recomputeMsMax: number;
  recomputeUsers: number;
}

export function metricsEnabled(): boolean {
  const secret = process.env.LOAD_TEST_SECRET;
  return !!secret && secret.length >= 16 && process.env.NODE_ENV !== "production";
}

// Counters for the current 1s window. Reset on every sample.
let priceDeliveries = 0;
let portfolioDeliveries = 0;
let cycles: { ms: number; users: number }[] = [];

export function recordPriceDeliveries(n: number): void {
  if (metricsEnabled()) priceDeliveries += n;
}

export function recordPortfolioDeliveries(n: number): void {
  if (metricsEnabled()) portfolioDeliveries += n;
}

export function recordRecompute(ms: number, users: number): void {
  if (metricsEnabled()) cycles.push({ ms, users });
}

const windows: MetricsWindow[] = [];
let seq = 0;

const ns2ms = (ns: number) => Math.round((ns / 1e6) * 100) / 100;
const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

export function startMetrics(): void {
  if (!metricsEnabled()) return;

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();

  setInterval(() => {
    const mem = process.memoryUsage();
    const cyc = cycles;
    cycles = [];
    const w: MetricsWindow = {
      seq: ++seq,
      ts: Date.now(),
      loopLagMs: {
        p50: ns2ms(loop.percentile(50)),
        p95: ns2ms(loop.percentile(95)),
        p99: ns2ms(loop.percentile(99)),
        max: ns2ms(loop.max),
      },
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      priceDeliveries,
      portfolioDeliveries,
      recomputeCycles: cyc.length,
      recomputeMsAvg: cyc.length
        ? Math.round((cyc.reduce((s, c) => s + c.ms, 0) / cyc.length) * 10) / 10
        : 0,
      recomputeMsMax: cyc.length ? Math.round(Math.max(...cyc.map((c) => c.ms)) * 10) / 10 : 0,
      recomputeUsers: cyc.reduce((s, c) => s + c.users, 0),
    };
    priceDeliveries = 0;
    portfolioDeliveries = 0;
    loop.reset();
    windows.push(w);
    if (windows.length > MAX_WINDOWS) windows.shift();
  }, SAMPLE_MS).unref();

  console.log("[metrics] load-test metrics enabled (GET /internal/metrics)");
}

export function mountMetrics(app: Express): void {
  if (!metricsEnabled()) return;
  app.get("/internal/metrics", (req, res) => {
    if (req.header("x-loadtest-secret") !== process.env.LOAD_TEST_SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const since = Number(req.query.since ?? 0);
    const out = Number.isFinite(since) ? windows.filter((w) => w.seq > since) : windows;
    res.json({ latestSeq: seq, windows: out });
  });
}