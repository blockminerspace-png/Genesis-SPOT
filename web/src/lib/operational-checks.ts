/** Rótulos PT para checks operacionais (REAL ONLY). */
const CHECK_LABELS: Record<string, string> = {
  market_data_source_coinex: "Fonte de preço: CoinEx",
  portfolio_balance_source_coinex: "Saldo: CoinEx real",
  execution_mode_live: "Modo execução: LIVE (Postgres)",
  enable_live_trading: "Trading real ativo (.env)",
  coinex_keys: "Chaves CoinEx",
  auto_live_confirm_env: "Confirmação de risco Auto LIVE",
  enable_auto_live_worker: "Auto LIVE Worker (.env)",
  runtime_running: "Motor RUNNING",
  kill_switch_off: "Kill switch desligado",
  live_market_allowlist: "Par na allowlist LIVE",
  btc_strategy_enabled: "Estratégia BTC Drop 2K",
  circuit_breaker_closed: "Circuit breaker fechado",
  reconciliation_healthy: "Reconciliador LIVE saudável",
  enable_auto_live_worker_env: "ENABLE_AUTO_LIVE_WORKER",
  execution_layer_live: "Camada de execução LIVE",
  fresh_ticker: "Ticker CoinEx fresco",
  fresh_market_spec: "Market spec CoinEx fresco",
  reconciliation_healthy_fresh: "Reconciliador recente",
  reconciliation_last_error: "Sem erro no reconciliador",
  reconciliation_fill_sum: "Somas de fills consistentes",
};

export function trOperationalCheckName(id: string): string {
  return CHECK_LABELS[id] ?? id.replace(/_/g, " ");
}

export function trLiveCycleCheckName(name: string): string {
  const base = name.replace(/^[A-Z]+_/, "");
  if (CHECK_LABELS[base]) return CHECK_LABELS[base];
  if (name.endsWith("_spec")) return `Spec ${name.replace(/_spec$/, "").toUpperCase()}`;
  if (name.endsWith("_ticker")) return `Ticker ${name.replace(/_ticker$/, "").toUpperCase()}`;
  if (name.endsWith("_min_quote")) return `Saldo mínimo ${name.replace(/_min_quote$/, "").toUpperCase()}`;
  return trOperationalCheckName(name);
}
