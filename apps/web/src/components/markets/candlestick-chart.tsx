"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  TickMarkType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";

type CandleChartProps = {
  symbol: string | null;
  market: "NSE" | "CRYPTO";
  candles: Candle[] | null;
  status: "idle" | "loading" | "ready" | "empty" | "unavailable" | "error";
  errorMessage?: string | null;
  onRetry?: () => void;
  selectionKey: string;
};

export function CandlestickChart({ symbol, market, candles, status, errorMessage, onRetry, selectionKey }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastSelectionRef = useRef("");
  const [hovered, setHovered] = useState<CandlestickData<Time> | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0d1724" },
        textColor: "#7f8fa1",
        fontFamily: "Geist Mono, ui-monospace, monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(154, 174, 191, 0.055)" },
        horzLines: { color: "rgba(154, 174, 191, 0.075)" },
      },
      rightPriceScale: { borderColor: "rgba(154, 174, 191, 0.12)", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderColor: "rgba(154, 174, 191, 0.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          if (typeof time !== "number") return null;
          const date = new Date(time * 1000);
          const timeZone = market === "NSE" ? "Asia/Kolkata" : "UTC";
          if (tickMarkType === TickMarkType.Year) return new Intl.DateTimeFormat("en-IN", { timeZone, year: "numeric" }).format(date);
          if (tickMarkType === TickMarkType.Month) return new Intl.DateTimeFormat("en-IN", { timeZone, month: "short" }).format(date);
          if (tickMarkType === TickMarkType.DayOfMonth) return new Intl.DateTimeFormat("en-IN", { timeZone, day: "2-digit", month: "short" }).format(date);
          return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
        },
      },
      crosshair: {
        vertLine: { color: "rgba(112, 229, 194, 0.42)", labelBackgroundColor: "#173b39" },
        horzLine: { color: "rgba(112, 229, 194, 0.32)", labelBackgroundColor: "#173b39" },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
      localization: { priceFormatter: (price: number) => formatNumber(price, price < 1 ? 5 : 2) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#61d2a6",
      downColor: "#e77986",
      borderUpColor: "#61d2a6",
      borderDownColor: "#e77986",
      wickUpColor: "#61d2a6",
      wickDownColor: "#e77986",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const onCrosshairMove = (param: Parameters<typeof chart.subscribeCrosshairMove>[0] extends (event: infer Event) => void ? Event : never) => {
      const datum = param.seriesData.get(series);
      setHovered(datum && "open" in datum ? datum as CandlestickData<Time> : null);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [market]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candles) return;

    const data: CandlestickData<Time>[] = [...candles]
      .sort((left, right) => left.bucketStart - right.bucketStart)
      .map((candle) => ({
        time: Math.floor(candle.bucketStart / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
    series.setData(data);
    if (selectionKey !== lastSelectionRef.current) {
      lastSelectionRef.current = selectionKey;
      if (data.length) chart.timeScale().fitContent();
      setHovered(null);
    }
  }, [candles, selectionKey]);

  return <div className="candle-chart-frame" aria-label={symbol ? `${symbol} ${market} one-minute candlestick chart` : "Candlestick chart"}>
    <div ref={containerRef} className="candle-chart-canvas" />
    {status !== "ready" && <div className="chart-state-overlay">
      {status === "loading" ? <span className="chart-loading-mark" /> : status === "idle" ? <span className="chart-state-icon">⌁</span> : status === "error" ? <span className="chart-state-icon">!</span> : <span className="chart-state-icon">◷</span>}
      <strong>{status === "loading" ? "Loading one-minute candles" : status === "idle" ? "Choose an instrument" : status === "error" ? "Candle data unavailable" : status === "empty" ? "No saved candles for this symbol yet" : "Historical candles aren’t available here yet"}</strong>
      <p>{status === "loading" ? "Loading persisted market candles…" : status === "idle" ? "Select a supported symbol to inspect its market data." : status === "error" ? errorMessage ?? "The candle service could not be reached." : status === "empty" ? "No completed 1-minute candles have been persisted for this instrument yet." : "The platform records 1-minute candles, but no read API exposes them to this page. The chart is left empty rather than synthesizing OHLC values from price ticks."}</p>
      {status === "error" && onRetry && <button className="chart-retry-button" type="button" onClick={onRetry}>Retry</button>}
    </div>}
    {hovered && <div className="chart-crosshair-readout"><span>{new Date(Number(hovered.time) * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })} IST</span><span>O <b>{formatNumber(hovered.open)}</b></span><span>H <b>{formatNumber(hovered.high)}</b></span><span>L <b>{formatNumber(hovered.low)}</b></span><span>C <b>{formatNumber(hovered.close)}</b></span></div>}
    <div className="chart-market-tag">{market === "NSE" ? "NSE · IST" : "BINANCE · UTC"}</div>
  </div>;
}
