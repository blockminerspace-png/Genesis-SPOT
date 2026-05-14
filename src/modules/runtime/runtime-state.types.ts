import type { BotExecutionMode, BotRuntimeStatus } from "@prisma/client";

/** Camada efetiva de envio de ordens (após Postgres + capacidades .env). */
export type RuntimeExecutionLayer = "SIMULATED" | "LIVE" | "DISABLED";

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

export type PlacedOrder = {
  exchangeOrderId: string | null;
  orderId: string;
  mode: "simulated" | "live";
  raw: unknown;
};

export type CancelOrderInput = {
  exchangeOrderId: string;
  market: string;
};
