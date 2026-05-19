import { useEffect, useState } from "react";
import { fetchBotSpotState } from "../api/botSpotApi.js";
import { fmtMoney, fmtPct } from "../lib/format.js";
import type { BotSpotState } from "../validation/botSpot.schema.js";

export function BotSpotSettingsPage() {
  const [state, setState] = useState<BotSpotState | null>(null);

  useEffect(() => {
    void (async () => {
      setState(await fetchBotSpotState());
    })();
  }, []);

  if (!state) return <p className="bs-muted">Carregando configuração (somente leitura)…</p>;

  const s = state.strategy;
  const cur = state.pnl.currency;

  return (
    <div className="bs-settings">
      <p className="bs-muted">Parâmetros da estratégia (fonte: GET /bot-spot/state)</p>
      <dl className="bs-kv">
        <dt>Estratégia</dt>
        <dd>{s.name}</dd>
        <dt>Ativa</dt>
        <dd>{s.enabled ? "sim" : "não"}</dd>
        <dt>Mercado</dt>
        <dd>{state.market}</dd>
        <dt>Quantidade por ordem</dt>
        <dd>{s.orderQty} BTC</dd>
        <dt>Passo queda (USD)</dt>
        <dd>{fmtMoney(s.dropStepUsd, cur, 0)}</dd>
        <dt>Lucro-alvo</dt>
        <dd>{fmtPct(s.targetProfitPct)}</dd>
      </dl>
    </div>
  );
}
