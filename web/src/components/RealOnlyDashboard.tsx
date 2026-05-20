import { useMemo } from "react";
import { fmtNum } from "../lib/format.js";
import { computeClosedPnlStats, normalizeSparklineY } from "../lib/overview-analytics.js";
import { fmtBalLine, parseSpotMarketPair, pickAsset, reconcHealthSummary } from "../lib/balances.js";
import { priceSourceLabel, trCycleStatus, trRuntimeStatus } from "../lib/translations.js";
import { trAutoDecision } from "../lib/auto-decision-i18n.js";
import type { BtcDropPanelSnapshot } from "./BtcDropStrategyPanel.js";
import { KvNum, StatCard, cycleStatusClass } from "./parts.js";

type OperationalPayload = {
  checks?: Array<{ id: string; ok: boolean; label: string; detail?: string }>;
  readyForAutoLive?: boolean;
  blockingSummary?: string[];
};

type Props = {
  cfg: Record<string, unknown>;
  rt: Record<string, unknown>;
  ticker: Record<string, unknown>;
  specInfo: Record<string, unknown>;
  bal: Record<string, unknown> | null;
  reconc: Record<string, unknown> | null;
  liveCycle: Record<string, unknown> | null;
  operational: OperationalPayload | null;
  btcDrop: BtcDropPanelSnapshot | null;
  openOrders: number;
  openCycles: number;
  cSum: Record<string, unknown> | null;
  cyclesRecent: unknown[] | undefined;
};

function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function WalletCard({ asset, bal }: { asset: string; bal: ReturnType<typeof pickAsset> }) {
  if (!bal) {
    return (
      <div className="ov-wallet-card">
        <span className="ov-wallet-asset mono">{asset}</span>
        <p className="ov-wallet-main muted">—</p>
      </div>
    );
  }
  return (
    <div className="ov-wallet-card">
      <span className="ov-wallet-asset mono">{asset}</span>
      <p className="ov-wallet-main mono">{bal.available}</p>
      <p className="ov-wallet-sub muted tiny">
        bloq. {bal.frozen} · total {bal.total}
      </p>
    </div>
  );
}

function BtcDropGauge({
  last,
  anchor,
  nextBuy,
  stepUsdt,
}: {
  last: number | null;
  anchor: string | null;
  nextBuy: string | null;
  stepUsdt: string;
}) {
  const anchorN = parsePrice(anchor);
  const nextN = parsePrice(nextBuy);
  if (last == null || anchorN == null || nextN == null) {
    return <p className="muted small">Aguardando preço e níveis da estratégia.</p>;
  }
  const lo = Math.min(anchorN, nextN, last);
  const hi = Math.max(anchorN, nextN, last);
  const span = hi - lo || 1;
  const pct = (v: number) => `${Math.max(4, Math.min(96, ((v - lo) / span) * 100))}%`;
  const dist = last - nextN;
  const distLabel =
    dist <= 0
      ? "no gatilho ou abaixo — compra pode disparar"
      : `${dist.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} USDT até o gatilho`;

  return (
    <div className="ov-btc-gauge">
      <div className="ov-btc-gauge-track">
        <span className="ov-btc-marker ov-btc-marker--anchor" style={{ left: pct(anchorN) }} title={`Anchor ${anchorN}`} />
        <span className="ov-btc-marker ov-btc-marker--next" style={{ left: pct(nextN) }} title={`Próxima compra ${nextN}`} />
        <span className="ov-btc-marker ov-btc-marker--last" style={{ left: pct(last) }} title={`Último ${last}`} />
      </div>
      <div className="ov-btc-gauge-legend">
        <span>
          <i className="ov-dot ov-dot--anchor" /> Anchor <strong className="mono">{anchorN.toLocaleString("pt-BR")}</strong>
        </span>
        <span>
          <i className="ov-dot ov-dot--next" /> Gatilho ≤ <strong className="mono">{nextN.toLocaleString("pt-BR")}</strong>
        </span>
        <span>
          <i className="ov-dot ov-dot--last" /> Agora <strong className="mono">{last.toLocaleString("pt-BR")}</strong>
        </span>
      </div>
      <p className="ov-btc-dist muted small">
        Passo <strong className="mono">{stepUsdt} USDT</strong> · {distLabel}
      </p>
    </div>
  );
}

function MiniSparkline({ values, className }: { values: number[]; className?: string }) {
  const model = useMemo(() => {
    const w = 320;
    const h = 64;
    const pad = 6;
    if (values.length < 2) return { mode: "empty" as const };
    const { norm } = normalizeSparklineY(values);
    const step = (w - pad * 2) / (norm.length - 1);
    const pts = norm
      .map((ny, i) => {
        const x = pad + i * step;
        const y = pad + (1 - ny) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { mode: "line" as const, pts, w, h };
  }, [values]);

  if (model.mode === "empty") {
    return <p className="muted small">Sem fechos com lucro suficientes para o gráfico.</p>;
  }
  return (
    <svg className={className ?? "ov-mini-spark"} viewBox={`0 0 ${model.w} ${model.h}`} width="100%" height={model.h} preserveAspectRatio="none">
      <rect x="0" y="0" width={model.w} height={model.h} rx="8" className="ov-spark-bg" />
      <polyline fill="none" className="ov-spark-line" strokeWidth="2.5" points={model.pts} />
    </svg>
  );
}

export function RealOnlyDashboard({
  cfg,
  rt,
  ticker,
  specInfo,
  bal,
  reconc,
  liveCycle,
  operational,
  btcDrop,
  openOrders,
  openCycles,
  cSum,
  cyclesRecent,
}: Props) {
  const market = String(cfg.market ?? "BTCUSDC");
  const { quote, base } = parseSpotMarketPair(market);
  const last = parsePrice(ticker?.last);

  const cx = bal?.coinex as
    | { available?: boolean; balances?: Array<{ asset: string; available: string; frozen: string; total: string }> }
    | undefined;
  const quoteBal = pickAsset(cx?.balances, quote);
  const baseBal = pickAsset(cx?.balances, base);
  const quoteAvail = parsePrice(quoteBal?.available);

  const rh = reconcHealthSummary(reconc);
  const pnl = useMemo(() => computeClosedPnlStats(Array.isArray(cyclesRecent) ? (cyclesRecent as Record<string, unknown>[]) : []), [cyclesRecent]);

  const sparkValues = useMemo(() => {
    const items = Array.isArray(cyclesRecent) ? (cyclesRecent as Record<string, unknown>[]) : [];
    const pts: number[] = [];
    for (const c of items) {
      if (String(c.status ?? "") !== "CLOSED_PROFIT") continue;
      const ep = parsePrice(c.entryPrice);
      if (ep != null && ep > 0) pts.push(ep);
      if (pts.length >= 14) break;
    }
    return pts.reverse();
  }, [cyclesRecent]);

  const tradingMarkets = useMemo(() => {
    const active = liveCycle?.activeMarkets;
    if (Array.isArray(active) && active.length > 0) {
      return active.map((m) => String(m).toUpperCase());
    }
    return [market.toUpperCase()];
  }, [liveCycle?.activeMarkets, market]);
  const marketsLabel = tradingMarkets.join(", ");

  const totalCycles = Number((cSum as { totalCycles?: number })?.totalCycles ?? 0);
  const closedProfit = Number((cSum as { byStatus?: Record<string, number> })?.byStatus?.CLOSED_PROFIT ?? 0);

  const btcEnabled = Boolean(btcDrop?.enabled);
  const blocked = !operational?.readyForAutoLive && (operational?.blockingSummary?.length ?? 0) > 0;

  return (
    <div className="ov-dashboard">
      {blocked ? (
        <div className="alert alert-warn ov-blocked-banner">
          <strong>Motor bloqueado:</strong> {operational!.blockingSummary!.slice(0, 3).join(" · ")}
          {operational!.blockingSummary!.length > 3 ? "…" : ""}
          <span className="muted small"> — detalhes na aba Operação.</span>
        </div>
      ) : null}

      <section className="ov-hero panel">
        <div className="ov-hero-grid">
          <div className="ov-hero-main">
            <p className="ov-hero-label">
              {base} / {quote} · CoinEx
            </p>
            <p className="ov-hero-price mono">
              {last != null ? last.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}
              <span className="ov-hero-ccy">{quote}</span>
            </p>
            <p className="muted small">
              {priceSourceLabel(ticker?.priceSource)}
              {ticker?.updatedAt ? ` · ${new Date(String(ticker.updatedAt)).toLocaleTimeString("pt-BR")}` : ""}
              {marketsLabel ? ` · Mercados: ${marketsLabel}` : ""}
            </p>
          </div>
          <div className="ov-hero-side">
            <div className="ov-chip-row">
              <span className={`ov-chip ${String(rt.runtimeStatus) === "RUNNING" ? "ov-chip--ok" : "ov-chip--warn"}`}>
                {trRuntimeStatus(rt.runtimeStatus)}
              </span>
              <span className={`ov-chip ${rh.kind === "good" ? "ov-chip--ok" : "ov-chip--danger"}`}>Conciliação {rh.label}</span>
              <span className="ov-chip">{openCycles} ciclo(s) aberto(s)</span>
              <span className="ov-chip">{openOrders} ordem(ns) aberta(s)</span>
            </div>
          </div>
        </div>
      </section>

      <div className="ov-kpi-grid">
        <StatCard
          label="PnL realizado (amostra)"
          value={`${pnl.totalRealizedQuote.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${quote}`}
          hint={`${pnl.closedWithProfitCount} fecho(s) c/ lucro`}
          tone={pnl.totalRealizedQuote >= 0 ? "default" : "danger"}
        />
        <StatCard label={`${quote} disponível`} value={quoteAvail != null ? fmtNum(String(quoteAvail)) : "—"} hint="CoinEx spot" />
        <StatCard label={`${base} na conta`} value={fmtBalLine(baseBal).split("·")[0]?.trim() ?? "—"} />
        <StatCard label="Ciclos na base" value={String(totalCycles)} hint={`${closedProfit} fechados c/ lucro`} />
      </div>

      <div className="ov-two-col">
        <div className="panel ov-panel-chart">
          <h2 className="panel-title">Entradas nos fechos com lucro</h2>
          <MiniSparkline values={sparkValues} />
          <p className="muted tiny ov-spark-caption">Últimos preços de entrada nos ciclos fechados com lucro (mais recente à direita).</p>
        </div>

        <div className="panel ov-panel-balances">
          <h2 className="panel-title">Carteira CoinEx</h2>
          <div className="ov-wallet-grid">
            <WalletCard asset={quote} bal={quoteBal} />
            <WalletCard asset={base} bal={baseBal} />
          </div>
          {liveCycle?.lastDecision ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              Última decisão do automático: <span className="mono">{trAutoDecision(liveCycle.lastDecision)}</span>
            </p>
          ) : null}
        </div>
      </div>

      {btcEnabled && btcDrop ? (
        <div className="panel ov-panel-btc">
          <h2 className="panel-title">BTC Drop 2K — preço vs. níveis</h2>
          <BtcDropGauge
            last={last}
            anchor={btcDrop.anchorPrice}
            nextBuy={btcDrop.nextBuyPrice}
            stepUsdt={btcDrop.stepUsdt}
          />
          <div className="ov-btc-kv kv-grid" style={{ marginTop: 16 }}>
            <KvNum label="Por compra" value={`${btcDrop.baseAmount} BTC`} mono={false} />
            <KvNum label="Valor estimado" value={btcDrop.estimatedQuoteValueAtNextBuy ?? "—"} mono />
            <KvNum label="Alvo de venda" value="+2% sobre entrada" mono={false} />
          </div>
        </div>
      ) : null}

      {Array.isArray(cyclesRecent) && cyclesRecent.length > 0 ? (
        <div className="panel ov-panel-cycles">
          <h2 className="panel-title">Ciclos recentes</h2>
          <div className="table-responsive">
            <table className="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Par</th>
                  <th>Estado</th>
                  <th>Entrada</th>
                  <th>Lucro ({quote})</th>
                  <th>Aberto</th>
                </tr>
              </thead>
              <tbody>
                {(cyclesRecent as Record<string, unknown>[]).slice(0, 10).map((c) => {
                  const st = String(c.status ?? "");
                  const profit = parsePrice(c.realizedProfitQuote);
                  return (
                    <tr key={String(c.id ?? Math.random())}>
                      <td className="mono">{String(c.market ?? "—")}</td>
                      <td>
                        <span className={cycleStatusClass(st)}>{trCycleStatus(st)}</span>
                      </td>
                      <td className="mono">{c.entryPrice != null ? fmtNum(String(c.entryPrice)) : "—"}</td>
                      <td className={`mono ${profit != null && profit < 0 ? "ov-neg" : ""}`}>
                        {profit != null ? profit.toLocaleString("pt-BR", { maximumFractionDigits: 6 }) : "—"}
                      </td>
                      <td className="mono tiny">{c.openedAt ? new Date(String(c.openedAt)).toLocaleString("pt-BR") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {specInfo?.source === "STATIC_FALLBACK" ? (
        <div className="alert alert-danger">
          Regras do par em fallback — operação LIVE bloqueada até a CoinEx responder.
        </div>
      ) : null}
    </div>
  );
}
