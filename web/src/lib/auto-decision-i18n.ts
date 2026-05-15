/** Traduz `lastDecision` do resumo do automático para o painel. */
export function trAutoDecision(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const exact: Record<string, string> = {
    circuit_breaker: "Proteção por erros (circuito)",
    "ENABLE_AUTO_LIVE_WORKER=false": "Automático desligado no servidor",
    wait_open_cycle: "À espera de ciclo ou compra em curso",
    cooldown: "Pausa curta entre tentativas",
    opened_or_attempted_buy: "Ciclo aberto ou compra tentada",
    buy_signal_rejected: "Compra recusada (mínimo da corretora ou pré-check)",
    reconciliation_unhealthy: "Conciliação instável",
    stale_live_orders: "Ordens na corretora desatualizadas",
    balance_drift: "Saldo alterou de forma inesperada",
    manual_review_required: "Revisão manual necessária",
    market_or_balance: "Mercado, saldo ou regras do par",
    max_cycles: "Limite de ciclos abertos",
    runtime_buys: "Motor não permite novas compras",
    precheck_runtime: "Verificação do motor falhou",
  };
  if (exact[s]) return exact[s];
  if (s.includes(":")) {
    return s
      .replace(/reconciliation_unhealthy/gi, "conciliação")
      .replace(/market_data_coinex/gi, "cotação CoinEx")
      .replace(/execution_layer_live/gi, "camada conta real")
      .replace(/_/g, " ");
  }
  return s.replace(/_/g, " ");
}
