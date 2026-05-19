export type LiveCycleWorkerStatus = "DISABLED" | "BLOCKED" | "RUNNING" | "CIRCUIT_OPEN" | "ERROR";

export type LiveCycleCheck = {
  name: string;
  ok: boolean;
  message?: string;
};

/** Estado em memória atualizado a cada tick do worker. */
export type LiveCycleSummary = {
  status: LiveCycleWorkerStatus;
  enabledByEnv: boolean;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  circuitOpenUntil: string | null;
  lastDecision: string | null;
  checks: LiveCycleCheck[];
};

/**
 * Resposta de `GET /live-cycle/summary`: inclui campos do `.env` + Postgres
 * atualizados em cada pedido (não só no último tick).
 */
export type LiveCycleApiSummary = LiveCycleSummary & {
  liveTradingEnabled: boolean;
  runtimeStatus: string;
  executionMode: string;
  market: string;
  /** Pares operados pelo Auto LIVE neste tick (CSV do allowlist ou AUTO_LIVE_MARKET). */
  activeMarkets: string[];
  quoteValue: string;
  /** Lucro-alvo na venda: lido de `bot_configs` (Parâmetros), não do `.env`. */
  targetProfitPct: string;
  /** Passo da grelha na compra limite: lido de `bot_configs` (Parâmetros). */
  gridStepPct: string;
  /** Moeda quote do par (ex.: USDC) para rótulos no painel. */
  quoteCurrency: string;
  /** Último preço (floor ao tick do spec) usado como base da grelha na queda. */
  referenceLastPrice: string | null;
  /** Preços de referência abaixo do pico (degraus da grelha); compra quando último ≤ gatilho do 1.º degrau. */
  dropBuyReferencePrices: string[];
  /** Estratégia BTC Drop 2K ativa no `.env`. */
  btcStrategyEnabled: boolean;
  btcDropState: {
    anchorPrice: string | null;
    nextBuyPrice: string | null;
    stepUsdt: string;
    baseAmount: string;
    targetProfitPct: string;
    estimatedQuoteValueAtNextBuy: string | null;
    updatedAt: string | null;
  } | null;
};
