import { useState } from "react";
import { useBotSpotState } from "../hooks/useBotSpotState.js";
import { fmtBtcQty, fmtDate, fmtMoney, fmtPct } from "../lib/format.js";
import { BotSpotErrorsPanel } from "./BotSpotErrorsPanel.js";
import { postBotSpotPause, postBotSpotReconcile, postBotSpotResume } from "../api/botSpotApi.js";

function statusClass(status: string): string {
  if (status === "LIVE") return "bs-status-live";
  if (status === "PAUSED") return "bs-status-paused";
  if (status === "ERROR") return "bs-status-error";
  return "bs-status-off";
}

export function BotSpotDashboard() {
  const { state, loading, error, refresh } = useBotSpotState();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  if (loading && !state) {
    return <p className="bs-muted">Carregando estado real…</p>;
  }
  if (!state) {
    return (
      <div className="bs-empty">
        <p>{error ?? "Estado indisponível"}</p>
        <button type="button" onClick={() => void refresh()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const cur = state.pnl.currency;

  async function onReconcile() {
    setActionMsg(null);
    try {
      await postBotSpotReconcile();
      setActionMsg("Reconciliação concluída");
      await refresh();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function onPause() {
    await postBotSpotPause();
    await refresh();
  }

  async function onResume() {
    await postBotSpotResume();
    await refresh();
  }

  return (
    <div className="bs-dashboard">
      <BotSpotErrorsPanel errors={state.errors} />

      <header className="bs-hero">
        <div>
          <span className={`bs-pill ${statusClass(state.status)}`}>{state.status}</span>
          <h1>{state.market}</h1>
          <p className="bs-price">{fmtMoney(state.livePrice, cur)}</p>
          <p className="bs-muted">Fonte: {state.priceSource}</p>
        </div>
        <div className="bs-actions">
          <button type="button" onClick={() => void onReconcile()}>
            Reconciliar
          </button>
          {state.status === "PAUSED" ? (
            <button type="button" onClick={() => void onResume()}>
              Retomar
            </button>
          ) : (
            <button type="button" onClick={() => void onPause()}>
              Pausar compras
            </button>
          )}
        </div>
      </header>

      {actionMsg ? <p className="bs-muted">{actionMsg}</p> : null}

      <div className="bs-grid">
        <article className="bs-card">
          <h3>Próxima compra</h3>
          <p>{fmtMoney(state.nextBuyLevel, cur)}</p>
        </article>
        <article className="bs-card">
          <h3>Posição</h3>
          <p>{fmtBtcQty(state.position.qty)}</p>
          <p className="bs-muted">{fmtMoney(state.position.notional, cur)}</p>
        </article>
        <article className="bs-card">
          <h3>Preço médio</h3>
          <p>{fmtMoney(state.position.avgEntryPrice, cur)}</p>
        </article>
        <article className="bs-card">
          <h3>Alvo de venda</h3>
          <p>{fmtMoney(state.targets.sellPrice, cur)}</p>
          <p className="bs-muted">Meta {fmtPct(state.targets.expectedProfitPct)}</p>
        </article>
        <article className="bs-card">
          <h3>PnL realizado</h3>
          <p>{fmtMoney(state.pnl.realized, cur)}</p>
        </article>
        <article className="bs-card">
          <h3>PnL não realizado</h3>
          <p>{fmtMoney(state.pnl.unrealized, cur)}</p>
        </article>
        <article className="bs-card">
          <h3>Última compra</h3>
          {state.lastBuyFill && typeof state.lastBuyFill === "object" && "price" in state.lastBuyFill ? (
            <p>
              {fmtMoney(Number((state.lastBuyFill as { price: number }).price), cur)} ·{" "}
              {fmtDate(String((state.lastBuyFill as { filledAt: string }).filledAt))}
            </p>
          ) : (
            <p className="bs-muted">Sem dado real disponível</p>
          )}
        </article>
        <article className="bs-card">
          <h3>Última venda</h3>
          {state.lastSellFill && typeof state.lastSellFill === "object" && "price" in state.lastSellFill ? (
            <p>
              {fmtMoney(Number((state.lastSellFill as { price: number }).price), cur)} ·{" "}
              {fmtDate(String((state.lastSellFill as { filledAt: string }).filledAt))}
            </p>
          ) : (
            <p className="bs-muted">Sem dado real disponível</p>
          )}
        </article>
        <article className="bs-card">
          <h3>Última reconciliação</h3>
          <p>{fmtDate(state.lastReconciledAt)}</p>
        </article>
        <article className="bs-card">
          <h3>Ciclo aberto</h3>
          {state.openCycle ? (
            <>
              <p>{state.openCycle.status}</p>
              <p className="bs-muted">{state.openCycle.cycleId.slice(0, 8)}…</p>
            </>
          ) : (
            <p className="bs-muted">Nenhum ciclo aberto</p>
          )}
        </article>
      </div>
    </div>
  );
}
