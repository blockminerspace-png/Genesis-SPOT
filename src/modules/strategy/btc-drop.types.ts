import type { Env } from "../../config/env.js";

export const BTC_DROP_STRATEGY_NAME = "BTC_DROP_2000";

export type BtcDropAnchorMode = "LAST_HIGH";

export type BtcDropConfig = {
  enabled: boolean;
  market: string;
  stepUsdt: string;
  baseAmount: string;
  targetProfitPct: string;
  anchorMode: BtcDropAnchorMode;
};

export type BtcDropStateRow = {
  market: string;
  anchorPrice: string;
  nextBuyPrice: string;
  stepUsdt: string;
  baseAmount: string;
  initialized: boolean;
  updatedAt: string;
};

export type BtcDropStateView = BtcDropStateRow & {
  enabled: boolean;
  targetProfitPct: string;
  estimatedQuoteValueAtNextBuy: string | null;
};

export type BtcDropBuySignal = {
  market: string;
  baseAmount: string;
  limitPrice: string;
  quoteValue: string;
  levelPrice: string;
};

export function readBtcDropConfig(env: Env): BtcDropConfig {
  const anchorRaw = (env.BTC_STRATEGY_ANCHOR_MODE ?? "LAST_HIGH").toUpperCase();
  const anchorMode: BtcDropAnchorMode = anchorRaw === "LAST_HIGH" ? "LAST_HIGH" : "LAST_HIGH";
  return {
    enabled: env.BTC_STRATEGY_ENABLED,
    market: env.BTC_STRATEGY_MARKET.toUpperCase(),
    stepUsdt: env.BTC_DROP_BUY_STEP_USDT,
    baseAmount: env.BTC_ORDER_BASE_AMOUNT,
    targetProfitPct: env.BTC_TARGET_PROFIT_PCT,
    anchorMode,
  };
}
