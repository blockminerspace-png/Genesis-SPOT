import type { BotExecutionMode, BotRuntimeStatus } from "@prisma/client";

/** Camada efetiva de envio de ordens (após Postgres + capacidades .env). */
export type RuntimeExecutionLayer = "LIVE" | "DISABLED";

export type RuntimePermission = {
  runtimeStatus: BotRuntimeStatus;
  executionModeDb: BotExecutionMode;
  executionLayer: RuntimeExecutionLayer;
  liveBlockedMissingKeys: boolean;
  canOpenNewCycles: boolean;
  canPlaceBuyOrders: boolean;
  canPlaceSellOrders: boolean;
};

export type PlaceLimitOrderInput = {
  cycleId?: string | null;
  market: string;
  side: "BUY" | "SELL";
  amount: string;
  price: string;
  clientId: string;
  /** Só para rota de teste: teto de notional em quote. */
  liveMaxQuoteOverride?: string;
};

/** Compra SPOT a mercado (CoinEx v2: `type=market`, `ccy` = moeda base, `amount` = quantidade base). */
export type PlaceMarketBuyInput = {
  cycleId?: string | null;
  market: string;
  /** Quantidade base (já com floor do precheck). */
  baseAmount: string;
  /** Último preço / referência para notional no precheck e preço gravado se a resposta não trouxer fill. */
  referencePrice: string;
  clientId: string;
  liveMaxQuoteOverride?: string;
};

export type PlacedOrder = {
  exchangeOrderId: string | null;
  orderId: string;
  mode: "live";
  raw: unknown;
};

export type CancelOrderInput = {
  exchangeOrderId: string;
  market: string;
};
