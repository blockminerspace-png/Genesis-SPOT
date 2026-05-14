import { Decimal } from "../../shared/decimal.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { assertValidOrderAmount } from "../market-data/market-spec.rounding.js";

export function canOpenAnotherCycle(openCount: number, maxOpen: number): boolean {
  return openCount < maxOpen;
}

export function hasMinQuoteBalance(availableUsdt: string, minQuote: string): boolean {
  try {
    return new Decimal(availableUsdt).gte(new Decimal(minQuote));
  } catch {
    return false;
  }
}

/** Valida quantidade × preço contra mínimos do mercado (antes de abrir ciclo / ordem). */
export function validateOrderAgainstMarketSpec(
  baseAmount: string,
  price: string,
  spec: MarketSpec,
): void {
  assertValidOrderAmount(new Decimal(baseAmount), new Decimal(price), spec);
}
