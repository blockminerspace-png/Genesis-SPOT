type Props = {
  executionLayer: unknown;
  liveTradingEnabled: boolean;
  autoWorkerOn: boolean;
};

/** Máximo 4 badges operacionais no topo. */
export function RealOnlyHeader({ executionLayer, liveTradingEnabled, autoWorkerOn }: Props) {
  const liveAccount = String(executionLayer ?? "").toUpperCase() === "LIVE";

  return (
    <div className="real-only-badges" aria-label="Modo operacional">
      <span className="badge badge-real-data">REAL DATA</span>
      <span className={`badge ${liveTradingEnabled ? "badge-live-on" : "badge-live-blocked"}`}>LIVE</span>
      <span className={`badge ${autoWorkerOn ? "badge-auto-on" : "badge-auto-off"}`}>AUTO {autoWorkerOn ? "ON" : "OFF"}</span>
      <span className={`badge ${liveAccount ? "badge-good" : "badge-neutral"}`}>Conta real</span>
    </div>
  );
}
