import { trLiveCycleCheckName, trOperationalCheckName } from "../lib/operational-checks.js";
import { trAutoDecision } from "../lib/auto-decision-i18n.js";
import { ChecksList, KvNum } from "./parts.js";

type Props = {
  operational: {
    checks?: Array<{ id: string; ok: boolean; label: string; detail?: string }>;
    readyForAutoLive?: boolean;
    blockingSummary?: string[];
  } | null;
  liveCycle: Record<string, unknown> | null;
  enableAutoLiveWorker: boolean;
};

export function OperationalChecksPanel({ operational, liveCycle, enableAutoLiveWorker }: Props) {
  const opChecks =
    operational?.checks?.map((c) => ({
      name: trOperationalCheckName(c.id),
      ok: c.ok,
      message: c.detail,
    })) ?? [];
  const lcChecks = ((liveCycle?.checks as Array<{ name: string; ok: boolean; message?: string }>) ?? []).map((c) => ({
    name: trLiveCycleCheckName(c.name),
    ok: c.ok,
    message: c.message,
  }));

  return (
    <details className="panel panel-operational-checks">
      <summary className="panel-title panel-title--summary">Checklist operacional (detalhe técnico)</summary>
      <p className="panel-lead muted small">
        Lista completa de verificações do motor automático. Na visão geral vê preços, saldos e desempenho.
      </p>
      {!operational?.readyForAutoLive && (operational?.blockingSummary?.length ?? 0) > 0 ? (
        <div className="alert alert-warn">
          <strong>Bloqueios:</strong>
          <ul className="blocking-list-compact">
            {operational!.blockingSummary!.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <h3 className="ov-subtitle">Sistema (REAL ONLY)</h3>
      {opChecks.length > 0 ? <ChecksList checks={opChecks} /> : <p className="muted small">Sem dados.</p>}
      {liveCycle ? (
        <>
          <h3 className="ov-subtitle" style={{ marginTop: 20 }}>
            Full Auto LIVE
          </h3>
          <div className="kv-grid">
            <KvNum label="Status worker" value={String(liveCycle.status ?? "—")} mono={false} />
            <KvNum label="Último tick" value={liveCycle.lastTickAt ? new Date(String(liveCycle.lastTickAt)).toLocaleString("pt-BR") : "—"} mono={false} />
            <KvNum label="Última decisão" value={trAutoDecision(liveCycle.lastDecision) || String(liveCycle.lastDecision ?? "—")} mono={false} />
            {liveCycle.lastError ? <KvNum label="Último erro" value={String(liveCycle.lastError)} mono={false} /> : null}
          </div>
          {lcChecks.length > 0 ? (
            <>
              <h3 className="ov-subtitle" style={{ marginTop: 16 }}>
                Checks do último tick
              </h3>
              <ChecksList checks={lcChecks} />
            </>
          ) : null}
        </>
      ) : null}
      <p className="muted small" style={{ marginTop: 12 }}>
        <code>ENABLE_AUTO_LIVE_WORKER</code> no servidor: <strong>{enableAutoLiveWorker ? "true" : "false"}</strong>.
      </p>
    </details>
  );
}
