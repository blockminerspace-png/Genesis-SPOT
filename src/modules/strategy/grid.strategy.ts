import { Decimal } from "../../shared/decimal.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { assertValidOrderAmount, ceilBaseAmount, floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";

/** Preço limite de compra um passo abaixo do último preço (grid spot), com floor na precisão quote. */
export function gridBuyLimitBelowLast(lastPrice: string, gridStepPct: string, spec: MarketSpec): string {
  const L = new Decimal(lastPrice);
  const g = new Decimal(gridStepPct.trim().replace(",", "."));
  const raw = L.mul(new Decimal(1).minus(g));
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}

/**
 * N primeiros preços de referência «na queda» (compra limite hipotética a cada passo da grelha abaixo do último).
 * O Auto LIVE usa o pico persistido (`auto_live_market_anchors`) + esta mesma fração para decidir compra.
 */
export function gridBuyDropReferenceLevels(
  flooredLastPrice: string,
  gridStepPct: string,
  spec: MarketSpec,
  steps: number,
): string[] {
  const gRaw = gridStepPct.trim().replace(",", ".");
  if (!gRaw) return [];
  const g = Number(gRaw);
  if (!Number.isFinite(g) || g <= 0) return [];
  const nSteps = Math.min(Math.max(Math.floor(steps), 1), 12);
  let current = flooredLastPrice.trim();
  if (!current) return [];
  try {
    if (!new Decimal(current).gt(0)) return [];
  } catch {
    return [];
  }
  const out: string[] = [];
  const stepArg = gridStepPct.trim().replace(",", ".");
  for (let i = 0; i < nSteps; i++) {
    current = gridBuyLimitBelowLast(current, stepArg, spec);
    out.push(current);
  }
  return out;
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

/**
 * Quantidade base para compra Auto LIVE: **exatamente** o mínimo que a CoinEx aceita para o par,
 * combinando `min_amount` e `min_value` (documentação v2: GET spot/market — campos homónimos).
 * Se a API não enviar mínimos úteis, cai no cálculo pelo orçamento em quote.
 */
export function liveAutoBuyBaseAmountExchangeMinimums(
  limitPrice: string,
  quoteBudget: string,
  spec: MarketSpec,
): string {
  const px = new Decimal(limitPrice);
  if (!px.gt(0)) {
    return btcAmountForQuoteSpend(quoteBudget, limitPrice, spec);
  }

  let minA = new Decimal(0);
  if (spec.minAmount != null && String(spec.minAmount).trim() !== "") {
    try {
      const m = new Decimal(spec.minAmount);
      if (m.gt(0)) minA = m;
    } catch {
      minA = new Decimal(0);
    }
  }

  let minV = new Decimal(0);
  if (spec.minValue != null && spec.minValue !== "") {
    try {
      const v = new Decimal(spec.minValue);
      if (v.gt(0)) minV = v;
    } catch {
      minV = new Decimal(0);
    }
  }

  if (!minA.gt(0) && !minV.gt(0)) {
    return btcAmountForQuoteSpend(quoteBudget, limitPrice, spec);
  }

  let start = new Decimal(0);
  if (minA.gt(0)) start = Decimal.max(start, minA);
  if (minV.gt(0)) {
    const fromValue = ceilBaseAmount(minV.div(px), spec);
    start = Decimal.max(start, fromValue);
  }

  const prec = Math.min(18, Math.max(0, spec.basePrecision));
  const tick = new Decimal(10).pow(-prec);
  let b = floorBaseAmount(start, spec);
  if (minA.gt(0) && b.lt(minA)) {
    b = floorBaseAmount(minA, spec);
  }

  for (let i = 0; i < 50_000; i++) {
    try {
      assertValidOrderAmount(b, px, spec);
      return b.toFixed(spec.basePrecision);
    } catch {
      b = b.plus(tick);
    }
  }

  throw new Error("não foi possível compor quantidade mínima válida (min_amount / min_value)");
}

/**
 * Teto em quote para pré-check / override no Auto LIVE (compra):
 * `max(LIVE_MAX_ORDER_QUOTE_VALUE, orçamento, notional)` — assim um `.env` antigo com LIVE_MAX=1
 * não impede o lote mínimo da corretora (~8 USDC). O volume **diário** continua a ser validado em `runLivePlacePrecheck`.
 */
/** Teto por ordem: nunca abaixo do notional real (corrige LIVE_MAX baixo com lote mínimo ~5–15 USDC). */
export function liveAutoOrderQuoteCap(notional: string, liveMaxOrderQuote: string, spec: MarketSpec): string {
  const n = new Decimal(notional);
  return Decimal.max(new Decimal(liveMaxOrderQuote), n).toFixed(spec.quotePrecision);
}

export function liveAutoBuyQuoteCap(
  quoteBudget: string,
  baseAmount: string,
  limitPrice: string,
  liveMaxOrderQuote: string,
  spec: MarketSpec,
): string {
  const notional = new Decimal(baseAmount).mul(new Decimal(limitPrice));
  const need = Decimal.max(new Decimal(quoteBudget), notional);
  return liveAutoOrderQuoteCap(need.toFixed(spec.quotePrecision), liveMaxOrderQuote, spec);
}
