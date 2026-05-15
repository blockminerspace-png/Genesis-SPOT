import { useMemo } from "react";
import {
  buildClosedEntrySparkline,
  computeClosedPnlStats,
  computeWeightedAvgEntry,
  normalizeSparklineY,
  type CycleRow,
} from "../lib/overview-analytics.js";
import type { StrategyGridSnapshot } from "./StrategyGridPanel.js";

type Props = {
  cycles: unknown[] | undefined;
  quoteSym: string;
  strategy: StrategyGridSnapshot;
  baseBalanceLine: string;
  baseSymbol: string;
};

type SparkModel =
  | { mode: "empty" }
  | { mode: "single"; singleVal: number }
  | { mode: "line"; points: string; w: number; h: number; series: { i: number; price: number }[] };

function SparklineBlock({ values, quoteSym }: { values: number[]; quoteSym: string }) {
  const model: SparkModel = useMemo(() => {
    const w = 280;
    const h = 56;
    if (values.length < 2) {
      if (values.length === 1) return { mode: "single", singleVal: values[0] };
      return { mode: "empty" };
    }
    const pad = 4;
    const { norm } = normalizeSparklineY(values);
    const step = norm.length > 1 ? (w - pad * 2) / (norm.length - 1) : 0;
    const series = values.map((price, i) => ({ i: i + 1, price }));
    const pts = norm
      .map((ny, i) => {
        const x = pad + i * step;
        const y = pad + (1 - ny) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { mode: "line", points: pts, w, h, series };
  }, [values]);

  if (model.mode === "empty") {
    return <p className="muted small">Sem histórico de fechos com lucro suficiente para o gráfico.</p>;
  }
  if (model.mode === "single") {
    return (
      <p className="muted small">
        Só um fecho com lucro na amostra — entrada:{" "}
        <span className="mono">{model.singleVal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {quoteSym}</span>
      </p>
    );
  }

  const { points, w, h, series } = model;
  return (
    <div className="ov-spark-block">
      <div className="table-responsive">
        <table className="data-table data-table-ov-spark">
          <thead>
            <tr>
              <th>#</th>
              <th>Preço de entrada (fecho c/ lucro)</th>
              <th>Δ vs. anterior</th>
            </tr>
          </thead>
          <tbody>
            {series.map((row, idx) => {
              const prev = idx > 0 ? series[idx - 1].price : null;
              const delta =
                prev != null && prev > 0 ? ((row.price - prev) / prev) * 100 : null;
              return (
                <tr key={row.i}>
                  <td className="mono">{row.i}</td>
                  <td className="mono">
                    {row.price.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {quoteSym}
                  </td>
                  <td className="mono">{delta != null ? `${delta.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} %` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ov-spark-wrap" style={{ marginTop: 10 }}>
        <svg className="ov-spark-svg" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="0" width={w} height={h} rx="6" className="ov-spark-bg" />
          {points ? <polyline fill="none" className="ov-spark-line" strokeWidth="2" points={points} /> : null}
        </svg>
        <p className="muted tiny ov-spark-caption">
          Linha: mesma sequência da tabela (esquerda = mais antigo na amostra, direita = mais recente).
        </p>
      </div>
    </div>
  );
}

function PositionBlock({
  entry,
  last,
  target,
  quoteSym,
  qDec,
}: {
  entry: number | null;
  last: number | null;
  target: number | null;
  quoteSym: string;
  qDec: number;
}) {
  if (entry == null || last == null || target == null) {
    return <p className="muted small">Tabela de posição: aguarda entrada, último e alvo no ciclo ativo.</p>;
  }
  const lo = Math.min(entry, last, target);
  const hi = Math.max(entry, last, target);
  const span = hi - lo || 1;
  const bandPct = (v: number) => ((v - lo) / span) * 100;
  const distToTargetFromLast = last > 0 ? ((target - last) / last) * 100 : null;

  const rows: { key: string; label: string; v: number; tone: "entry" | "last" | "target" }[] = [
    { key: "e", label: "Entrada (compra)", v: entry, tone: "entry" },
    { key: "l", label: "Último (mercado)", v: last, tone: "last" },
    { key: "t", label: "Alvo de venda", v: target, tone: "target" },
  ];

  return (
    <div className="ov-pos-block">
      <div className="table-responsive">
        <table className="data-table data-table-ov-pos">
          <thead>
            <tr>
              <th>Referência</th>
              <th>Preço ({quoteSym})</th>
              <th>No intervalo</th>
              <th>Visual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="mono">{r.v.toLocaleString("pt-BR", { maximumFractionDigits: qDec })}</td>
                <td className="mono">{bandPct(r.v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %</td>
                <td className="ov-pos-bar-cell">
                  <div className="ov-bar-track ov-bar-track--inline">
                    <div
                      className={`ov-bar-fill ov-bar-fill--${r.tone}`}
                      style={{ width: `${Math.max(8, bandPct(r.v))}%` }}
                      title={`${r.v}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {distToTargetFromLast != null && Number.isFinite(distToTargetFromLast) ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          Do <strong>último</strong> ao <strong>alvo de venda</strong>:{" "}
          <strong className="mono">{distToTargetFromLast.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} %</strong> (aprox.; alvo é ordem limite)
        </p>
      ) : null}
    </div>
  );
}

export function OverviewAnalyticsBlock({ cycles, quoteSym, strategy, baseBalanceLine, baseSymbol }: Props) {
  const rows = useMemo(() => (Array.isArray(cycles) ? (cycles as CycleRow[]) : []), [cycles]);
  const pnl = useMemo(() => computeClosedPnlStats(rows), [rows]);
  const wAvg = useMemo(() => computeWeightedAvgEntry(rows), [rows]);
  const spark = useMemo(() => buildClosedEntrySparkline(rows, 12), [rows]);

  return (
    <div className="ov-analytics">
      <div className="panel ov-analytics-panel">
        <h2 className="panel-title">Análise &amp; desempenho</h2>
        <p className="panel-lead muted small">
          Tabelas derivadas da base de dados deste bot e da cotação atual. Não substituem relatórios da CoinEx nem auditoria fiscal.
        </p>

        <h3 className="ov-subtitle">Indicadores (amostra recente)</h3>
        <div className="table-responsive">
          <table className="data-table data-table-ov-metrics">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Valor</th>
                <th>Como ler</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>PnL realizado (soma)</td>
                <td className={`mono ov-td-num ${pnl.totalRealizedQuote < 0 ? "ov-neg" : ""}`}>
                  {pnl.totalRealizedQuote.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {quoteSym}
                </td>
                <td className="ov-td-hint">Soma do lucro em quote nos ciclos «Fechado com lucro» nesta lista ({pnl.closedWithProfitCount}).</td>
              </tr>
              <tr>
                <td>Retorno médio (fechos c/ lucro)</td>
                <td className="mono ov-td-num">
                  {pnl.avgReturnPct != null
                    ? `${(pnl.avgReturnPct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} %`
                    : "—"}
                </td>
                <td className="ov-td-hint">Média do retorno % apenas nesses fechos (sem dados → traço).</td>
              </tr>
              <tr>
                <td>Preço médio ponderado (entradas)</td>
                <td className="mono ov-td-num">
                  {wAvg != null ? `${wAvg.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} ${quoteSym}` : "—"}
                </td>
                <td className="ov-td-hint">Média das entradas ponderada pela quantidade de base comprada nos ciclos com entrada.</td>
              </tr>
              <tr>
                <td>
                  Saldo <span className="mono">{baseSymbol}</span> (CoinEx)
                </td>
                <td className="mono ov-td-num ov-td-balance">{baseBalanceLine}</td>
                <td className="ov-td-hint">Última leitura spot na API (disponível / bloqueado / total).</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ov-analytics-stack">
          <section className="ov-analytics-section">
            <h3 className="ov-subtitle">Posição vs. mercado (ciclo ativo)</h3>
            <PositionBlock
              entry={strategy?.entry ?? null}
              last={strategy?.last ?? null}
              target={strategy?.target ?? null}
              quoteSym={quoteSym}
              qDec={strategy?.qDec ?? 2}
            />
          </section>
          <section className="ov-analytics-section">
            <h3 className="ov-subtitle">Histórico de entradas (fechos com lucro)</h3>
            <SparklineBlock values={spark} quoteSym={quoteSym} />
          </section>
        </div>

        <div className="table-responsive ov-footer-wrap">
          <table className="data-table data-table-ov-footer">
            <tbody>
              <tr>
                <th scope="row">Ciclos na amostra</th>
                <td className="mono ov-td-num">{rows.length}</td>
              </tr>
              <tr>
                <th scope="row">Fechados com lucro</th>
                <td className="mono ov-td-num">{pnl.closedWithProfitCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
