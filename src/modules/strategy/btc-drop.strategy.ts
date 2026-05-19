import { Decimal } from "../../shared/decimal.js";
import type { Env } from "../../config/env.js";
import { floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { assertValidOrderAmount } from "../market-data/market-spec.rounding.js";
import { targetSellFromEntry } from "./grid.strategy.js";
import { readBtcDropConfig, type BtcDropBuySignal } from "./btc-drop.types.js";

export { readBtcDropConfig, BTC_DROP_STRATEGY_NAME } from "./btc-drop.types.js";

export function btcDropNextBuyFromAnchor(anchorPrice: string, stepUsdt: string, spec: MarketSpec): string {
  const raw = new Decimal(anchorPrice).minus(new Decimal(stepUsdt));
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}

export function btcDropBuyLimitPrice(nextBuyPrice: string, lastPrice: string, spec: MarketSpec): string {
  const next = new Decimal(nextBuyPrice);
  const last = new Decimal(lastPrice);
  const raw = Decimal.min(next, last);
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}

export function btcDropFlooredBaseAmount(baseAmount: string, spec: MarketSpec): string {
  return floorBaseAmount(new Decimal(baseAmount), spec).toFixed(spec.basePrecision);
}

export function btcDropQuoteValue(baseAmount: string, price: string, spec: MarketSpec): string {
  return new Decimal(baseAmount).mul(new Decimal(price)).toFixed(spec.quotePrecision);
}

export function btcDropBuyTriggered(lastPrice: string, nextBuyPrice: string): boolean {
  return new Decimal(lastPrice).lte(new Decimal(nextBuyPrice));
}

export function btcDropSellTarget(
  avgEntryPrice: string,
  targetProfitPct: string,
  feeBufferPct: string,
  spec: MarketSpec,
): string {
  return targetSellFromEntry(avgEntryPrice, targetProfitPct, feeBufferPct, spec);
}

export function buildBtcDropBuySignal(
  env: Env,
  lastPrice: string,
  nextBuyPrice: string,
  spec: MarketSpec,
): BtcDropBuySignal {
  const cfg = readBtcDropConfig(env);
  const baseAmount = btcDropFlooredBaseAmount(cfg.baseAmount, spec);
  const limitPrice = btcDropBuyLimitPrice(nextBuyPrice, lastPrice, spec);
  const quoteValue = btcDropQuoteValue(baseAmount, limitPrice, spec);
  return {
    market: cfg.market,
    baseAmount,
    limitPrice,
    quoteValue,
    levelPrice: nextBuyPrice,
  };
}

export function validateBtcDropBuyAgainstSpec(
  signal: BtcDropBuySignal,
  spec: MarketSpec,
): { ok: true } | { ok: false; reason: "min_amount" | "min_value"; message: string } {
  try {
    assertValidOrderAmount(new Decimal(signal.baseAmount), new Decimal(signal.limitPrice), spec);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("min_value") || msg.toLowerCase().includes("valor")) {
      return { ok: false, reason: "min_value", message: msg };
    }
    return { ok: false, reason: "min_amount", message: msg };
  }
}

export function validateBtcDropLiveQuoteCap(
  quoteValue: string,
  liveMaxOrderQuote: string,
): { ok: true } | { ok: false; quoteValue: string; cap: string } {
  if (new Decimal(quoteValue).gt(new Decimal(liveMaxOrderQuote))) {
    return { ok: false, quoteValue, cap: liveMaxOrderQuote };
  }
  return { ok: true };
}
