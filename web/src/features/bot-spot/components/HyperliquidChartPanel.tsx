import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useBotSpotChart } from "../hooks/useBotSpotChart.js";

function toSec(ms: number): UTCTimestamp {
  return (ms > 1e12 ? Math.floor(ms / 1000) : ms) as UTCTimestamp;
}

export function HyperliquidChartPanel() {
  const { chart, loading, error, refresh } = useBotSpotChart("15m");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !chart || chart.candles.length === 0) return;

    const cw = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "#0b0f14" }, textColor: "#c9d1d9" },
      width: el.clientWidth,
      height: 440,
      grid: { vertLines: { color: "#21262d" }, horzLines: { color: "#21262d" } },
    });

    const series = cw.addSeries(CandlestickSeries, {
      upColor: "#3fb950",
      downColor: "#f85149",
      borderVisible: false,
      wickUpColor: "#3fb950",
      wickDownColor: "#f85149",
    });

    series.setData(
      chart.candles.map((c) => ({
        time: toSec(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const lines = chart.lines;
    if (lines.nextBuyLevel != null) {
      series.createPriceLine({ price: lines.nextBuyLevel, color: "#58a6ff", title: "Próxima compra", lineWidth: 2 });
    }
    if (lines.avgEntryPrice != null) {
      series.createPriceLine({ price: lines.avgEntryPrice, color: "#d29922", title: "Média", lineWidth: 2 });
    }
    if (lines.targetSellPrice != null) {
      series.createPriceLine({ price: lines.targetSellPrice, color: "#a371f7", title: "Alvo venda", lineWidth: 2 });
    }

    const markerData: SeriesMarker<UTCTimestamp>[] = chart.markers
      .map((m) => {
        const side = String((m as { side?: string }).side ?? "");
        const price = Number((m as { price?: number }).price);
        const qty = Number((m as { qty?: number }).qty);
        const time = toSec(Number((m as { time?: number }).time));
        if (side !== "BUY" && side !== "SELL") return null;
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(time)) {
          return null;
        }
        return {
          time,
          position: side === "BUY" ? "belowBar" : "aboveBar",
          shape: side === "BUY" ? "arrowUp" : "arrowDown",
          color: side === "BUY" ? "#3fb950" : "#f85149",
          text: `${side} ${qty} @ ${price}`,
        } as SeriesMarker<UTCTimestamp>;
      })
      .filter((m): m is SeriesMarker<UTCTimestamp> => m != null);

    if (markerData.length > 0) {
      createSeriesMarkers(series, markerData);
    }

    const ro = new ResizeObserver(() => {
      cw.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      cw.remove();
    };
  }, [chart]);

  if (loading) return <p className="muted">Carregando candles Hyperliquid…</p>;
  if (error && (!chart || chart.candles.length === 0)) {
    return (
      <div className="panel">
        <p className="muted">{error}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Gráfico BTC (Hyperliquid)</h2>
      <p className="muted small">
        Candles reais via backend · marcadores BUY/SELL de fills persistidos na CoinEx
      </p>
      <div ref={containerRef} className="hl-chart" />
    </div>
  );
}
