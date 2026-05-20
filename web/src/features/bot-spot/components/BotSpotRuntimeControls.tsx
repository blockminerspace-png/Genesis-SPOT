import { useState } from "react";
import type { BotSpotState } from "../validation/botSpot.schema.js";
import { postBotSpotPause, postBotSpotReconcile, postBotSpotResume } from "../api/botSpotApi.js";
import { fmtDate } from "../lib/format.js";

export function BotSpotRuntimeControls({
  state,
  onRefresh,
}: {
  state: BotSpotState | null;
  onRefresh: () => void | Promise<void>;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "reconcile" | "pause" | "resume") {
    setBusy(true);
    setMsg(null);
    try {
      if (action === "reconcile") await postBotSpotReconcile();
      if (action === "pause") await postBotSpotPause();
      if (action === "resume") await postBotSpotResume();
      setMsg(action === "reconcile" ? "Conciliação manual concluída." : "Estado do motor atualizado.");
      await onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-nested">
      <h3 className="ov-subtitle">Runtime BTC Drop (API consolidada)</h3>
      <p className="muted small">
        Pausar/retomar altera o estado no Postgres. A conciliação manual usa o mesmo worker de reconciliação real.
      </p>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run("reconcile")}>
          Reconciliar agora
        </button>
        {state?.status === "PAUSED" ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void run("resume")}>
            Retomar compras
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => void run("pause")}>
            Pausar compras (runtime)
          </button>
        )}
      </div>
      {state ? (
        <div className="kv-grid" style={{ marginTop: 16 }}>
          <div>
            <span className="muted">Estado consolidado</span>
            <p className="mono">{state.status}</p>
          </div>
          <div>
            <span className="muted">Última reconciliação</span>
            <p className="mono">{state.lastReconciledAt ? fmtDate(state.lastReconciledAt) : "—"}</p>
          </div>
          <div>
            <span className="muted">Estratégia</span>
            <p className="mono">{state.strategy.enabled ? "BTC Drop 2K ativa" : "desativada"}</p>
          </div>
          <div>
            <span className="muted">Ciclo aberto (estado)</span>
            <p className="mono">{state.openCycle ? `${state.openCycle.cycleId.slice(0, 12)}…` : "nenhum"}</p>
          </div>
        </div>
      ) : (
        <p className="muted">Carregando estado consolidado…</p>
      )}
      {msg ? <p className="muted small" style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
