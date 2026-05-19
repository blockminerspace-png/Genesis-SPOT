import { trExecutionLayer, trRuntimeStatus } from "../lib/translations.js";

type Props = {
  runtimeStatus: unknown;
  executionLayer: unknown;
  liveTradingEnabled: boolean;
  autoWorkerOn: boolean;
  killSwitch: boolean;
};

export function RealOnlyHeader({ runtimeStatus, executionLayer, liveTradingEnabled, autoWorkerOn, killSwitch }: Props) {
  return (
    <div className="real-only-badges" aria-label="Modo operacional">
      <span className="badge badge-real-data">REAL DATA</span>
      <span className="badge badge-real-mode">Real CoinEx Mode</span>
      {liveTradingEnabled ? (
        <span className="badge badge-live-on">LIVE TRADING ENABLED</span>
      ) : (
        <span className="badge badge-live-blocked">LIVE BLOCKED</span>
      )}
      <span className={`badge ${autoWorkerOn ? "badge-auto-on" : "badge-auto-off"}`}>AUTO {autoWorkerOn ? "ON" : "OFF"}</span>
      {killSwitch ? <span className="badge badge-kill-active">KILL SWITCH</span> : null}
      <span className="status-chip">
        <span className="muted">Motor</span> <strong>{trRuntimeStatus(runtimeStatus)}</strong>
      </span>
      <span className="status-chip">
        <span className="muted">Camada</span> <strong>{trExecutionLayer(executionLayer)}</strong>
      </span>
    </div>
  );
}
