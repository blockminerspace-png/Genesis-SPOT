/** Resposta normalizada de `GET /v2/spot/order-status` (camada data). */
export type CoinexOrderStatusSnapshot = {
  orderId: number;
  market: string;
  status: string;
  amount: string;
  unfilledAmount: string;
  filledAmount: string;
  filledValue: string;
  baseFee: string;
  quoteFee: string;
  raw: Record<string, unknown>;
};

/** Deal `GET /v2/spot/user-deals` (elemento de data[]). */
export type CoinexUserDeal = {
  dealId: number;
  orderId: number;
  createdAtMs: number;
  price: string;
  amount: string;
  fee: string;
  feeCcy: string;
  side: string;
};

export type LiveReconciliationSummary = {
  intervalMs: number;
  lastTickAtMs: number | null;
  lastTickDurationMs: number | null;
  ordersScanned: number;
  ordersSynced: number;
  fillsImported: number;
  lastError: string | null;
  /** Soma dos fills locais ≠ filled_value remoto (tolerância). */
  fillSumDriftDetected: boolean;
  fillSumDriftDetail: string | null;
  /** Último fim de tick sem erro de ordem, sem drift de fills e sem drift de saldo (chaves CoinEx presentes). */
  lastHealthyTickCompletedAtMs: number | null;
  /** Último tick em que `fillSumDriftDetected` foi true. */
  lastFillSumDriftAtMs: number | null;
  /** Último evento BALANCE_DRIFT_DETECTED registado pelo reconciliador. */
  lastBalanceDriftAtMs: number | null;
};
