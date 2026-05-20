import type { BotSpotState } from "../validation/botSpot.schema.js";
import { fmtMoney, fmtPct } from "../lib/format.js";

export function BtcDropEnvReadonly({ state }: { state: BotSpotState | null }) {
  if (!state) return <p className="muted">Carregando parâmetros da estratégia…</p>;

  const s = state.strategy;
  const cur = state.pnl.currency;

  return (
    <div className="panel panel-nested">
      <h3 className="ov-subtitle">Estratégia BTC Drop 2K (somente leitura)</h3>
      <div className="kv-grid">
        <div>
          <span className="muted">BTC_STRATEGY_ENABLED</span>
          <p className="mono">{s.enabled ? "true" : "false"}</p>
        </div>
        <div>
          <span className="muted">BTC_STRATEGY_MARKET</span>
          <p className="mono">{state.market}</p>
        </div>
        <div>
          <span className="muted">BTC_ORDER_BASE_AMOUNT</span>
          <p className="mono">{s.orderQty}</p>
        </div>
        <div>
          <span className="muted">BTC_DROP_BUY_STEP_USDT</span>
          <p className="mono">{s.dropStepUsd}</p>
        </div>
        <div>
          <span className="muted">BTC_TARGET_PROFIT_PCT</span>
          <p className="mono">{fmtPct(s.targetProfitPct)}</p>
        </div>
        <div>
          <span className="muted">Próximo nível compra</span>
          <p className="mono">{fmtMoney(state.nextBuyLevel, cur)}</p>
        </div>
        <div>
          <span className="muted">Alvo venda</span>
          <p className="mono">{fmtMoney(state.targets.sellPrice, cur)}</p>
        </div>
      </div>
    </div>
  );
}
