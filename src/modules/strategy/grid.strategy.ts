import { Decimal } from "../../shared/decimal.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";

/** Preço limite de compra um passo abaixo do último preço (grid spot), com floor na precisão quote. */
export function gridBuyLimitBelowLast(lastPrice: string, gridStepPct: string, spec: MarketSpec): string {
  const L = new Decimal(lastPrice);
  const g = new Decimal(gridStepPct);
  const raw = L.mul(new Decimal(1).minus(g));
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}

export function targetSellFromEntry(
  avgBuyPrice: string,
  targetProfitPct: string,
  feeBufferPct: string,
  spec: MarketSpec,
): string {
  const b = new Decimal(avgBuyPrice);
  const bump = new Decimal(targetProfitPct).plus(new Decimal(feeBufferPct));
  const raw = b.mul(new Decimal(1).plus(bump));
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}

export function btcAmountForQuoteSpend(quoteUsdt: string, limitPrice: string, spec: MarketSpec): string {
  const raw = new Decimal(quoteUsdt).div(new Decimal(limitPrice));
  return floorBaseAmount(raw, spec).toFixed(spec.basePrecision);
}
