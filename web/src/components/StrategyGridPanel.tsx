import { cycleStatusClass } from "./parts.js";
import { cycleBuyPriceDisplayLabel } from "../lib/overview-strategy.js";
import { trCycleStatus } from "../lib/translations.js";

/** Mesmo conjunto que o `useMemo` `overviewStrategy` em `App.tsx`. */
export type StrategyGridSnapshot = {
  quoteSym: string;
  last: number | null;
  active: Record<string, unknown> | null;
  buyPx: number | null;
  sellPx: number | null;
  entry: number | null;
  target: number | null;
  levels: number[];
  apiDropLevels: string[];
  apiDropQuote: string;
  sellAfterNext: number | null;
  cycleStatus: string;
  qDec: number;
} | null;

type Props = { strategy: StrategyGridSnapshot };

function parsePx(raw: string): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function StrategyGridPanel({ strategy }: Props) {
  if (!strategy) {
    return (
      <div className="panel overview-strategy-panel" style={{ marginBottom: 16 }}>
        <h2 className="panel-title">Grelha e alvos (resumo)</h2>
        <p className="muted small">A carregar dados do mercado e ciclos…</p>
      </div>
    );
  }

  const s = strategy;
  const lastNum = s.last;
  const quoteCcy = s.apiDropQuote || s.quoteSym;

  const dropRows: { step: number; priceNum: number; priceDisp: string }[] =
    s.apiDropLevels.length > 0
      ? s.apiDropLevels.map((p, i) => {
          const priceNum = parsePx(p) ?? 0;
          return { step: i + 1, priceNum, priceDisp: String(p) };
        })
      : s.levels.map((p, i) => ({
          step: i + 1,
          priceNum: p,
          priceDisp: p.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec }),
        }));

  const pctBelowLast = (price: number): string | null => {
    if (lastNum == null || !(lastNum > 0) || !(price > 0)) return null;
    const pct = ((lastNum - price) / lastNum) * 100;
    return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} %`;
  };

  return (
    <div className="panel overview-strategy-panel" style={{ marginBottom: 16 }}>
      <h2 className="panel-title">Grelha e alvos (resumo)</h2>
      <p className="panel-lead muted small">
        O <strong>automático LIVE</strong> abre a <strong>compra ao mercado</strong> (valor em quote da configuração / mínimos da CoinEx). A tabela de{" "}
        <strong>alvos de compra na queda</strong> é só referência de grelha (preços hipotéticos por passo abaixo do último); não define ordens reais. A CoinEx e o
        motor podem arredondar de forma ligeiramente diferente.
      </p>

      <h3 className="ov-subtitle" style={{ marginTop: 12 }}>
        Ciclo ativo &amp; alvo de venda
      </h3>
      <div className="table-responsive">
        <table className="data-table data-table-strategy">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {s.active ? (
              <>
                <tr>
                  <td data-label="Campo">Estado do ciclo</td>
                  <td data-label="Valor">
                    <span className={`status-badge ${cycleStatusClass(s.cycleStatus)}`}>{trCycleStatus(s.cycleStatus)}</span>
                  </td>
                </tr>
                {s.buyPx != null && s.active ? (
                  <tr>
                    <td data-label="Campo">{cycleBuyPriceDisplayLabel(s.active)}</td>
                    <td data-label="Valor" className="mono">
                      {s.buyPx.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })} {quoteCcy}
                    </td>
                  </tr>
                ) : null}
                {s.entry != null ? (
                  <tr>
                    <td data-label="Campo">Preço de entrada (médio da compra)</td>
                    <td data-label="Valor" className="mono">
                      {s.entry.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })} {quoteCcy}
                    </td>
                  </tr>
                ) : null}
                {s.target != null ? (
                  <tr>
                    <td data-label="Campo">
                      <strong>Alvo de venda</strong> (take-profit do ciclo)
                    </td>
                    <td data-label="Valor" className="mono">
                      <strong>{s.target.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })}</strong> {quoteCcy}
                    </td>
                  </tr>
                ) : null}
                {s.sellPx != null ? (
                  <tr>
                    <td data-label="Campo">Preço da ordem de venda (limite colocada)</td>
                    <td data-label="Valor" className="mono">
                      {s.sellPx.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })} {quoteCcy}
                    </td>
                  </tr>
                ) : null}
              </>
            ) : (
              <tr>
                <td colSpan={2} className="muted">
                  Nenhum ciclo ativo (sem posição aberta neste bot).
                </td>
              </tr>
            )}
            {s.last != null ? (
              <tr>
                <td data-label="Campo">Último preço (referência mercado)</td>
                <td data-label="Valor" className="mono">
                  {s.last.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })} {quoteCcy}
                </td>
              </tr>
            ) : null}
            {s.sellAfterNext != null ? (
              <tr>
                <td data-label="Campo">Venda indicativa após 1.º degrau da grelha</td>
                <td data-label="Valor" className="mono">
                  ≈ {s.sellAfterNext.toLocaleString("pt-BR", { maximumFractionDigits: s.qDec })} {quoteCcy}
                  <span className="muted small" style={{ display: "block", marginTop: 4, fontWeight: 400 }}>
                    lucro-alvo + margem de taxas (se a entrada fosse ao preço do 1.º degrau ilustrativo)
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dropRows.length > 0 ? (
        <>
          <h3 className="ov-subtitle" style={{ marginTop: 20 }}>
            Alvos de compra na queda (referência grelha)
          </h3>
          <p className="muted tiny" style={{ marginBottom: 8 }}>
            Cada linha = um passo abaixo do <strong>último</strong> arredondado; não é ordem limite colocada pelo Auto LIVE.
          </p>
          <div className="table-responsive">
            <table className="data-table data-table-strategy data-table-strategy--drops">
              <thead>
                <tr>
                  <th>Degrau</th>
                  <th>Preço alvo (quote)</th>
                  <th>Queda vs. último</th>
                </tr>
              </thead>
              <tbody>
                {dropRows.map((r) => (
                  <tr key={r.step}>
                    <td data-label="Degrau">{r.step}º</td>
                    <td data-label="Preço" className="mono">
                      {r.priceDisp} {quoteCcy}
                    </td>
                    <td data-label="Queda" className="mono">
                      {pctBelowLast(r.priceNum) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
