/** Spec normalizada (CoinEx pública ou fallback estático). */
export type MarketSpecSource = "COINEX" | "STATIC_FALLBACK";

export type MarketSpec = {
  market: string;
  baseCurrency: string;
  quoteCurrency: string;

  basePrecision: number;
  quotePrecision: number;

  minAmount: string;
  minValue: string | null;

  makerFeeRate: string;
  takerFeeRate: string;

  tradingEnabled: boolean;
  apiTradingEnabled: boolean;

  raw: unknown;

  source: MarketSpecSource;
  updatedAt: string;
};

export class OrderRejectedMinAmountError extends Error {
  readonly code = "ORDER_REJECTED_MIN_AMOUNT" as const;
  constructor(message: string) {
    super(message);
    this.name = "OrderRejectedMinAmountError";
  }
}

export class OrderRejectedMinValueError extends Error {
  readonly code = "ORDER_REJECTED_MIN_VALUE" as const;
  constructor(message: string) {
    super(message);
    this.name = "OrderRejectedMinValueError";
  }
}

/** Resposta JSON pública (sem `raw`). */
export type MarketSpecPublic = Omit<MarketSpec, "raw">;
