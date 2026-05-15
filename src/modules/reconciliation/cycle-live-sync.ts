import { CycleStatus, OrderSide, OrderStatus, type Prisma } from "@prisma/client";
import { Decimal } from "../../shared/decimal.js";

type Tx = Prisma.TransactionClient;

function quoteAssetFromMarket(market: string): string {
  const m = market.toUpperCase();
  if (m.endsWith("USDT")) return "USDT";
  if (m.endsWith("USDC")) return "USDC";
  return "USDT";
}

function baseAssetFromMarket(market: string): string {
  const m = market.toUpperCase();
  const q = quoteAssetFromMarket(m);
  if (m.endsWith(q)) return m.slice(0, -q.length) || "BASE";
  return "BASE";
}

/** Prioriza taxa em quote; senão base (como devolvido pela CoinEx). */
export function pickPrimaryFeeFromSnapshot(
  market: string,
  baseFee: string,
  quoteFee: string,
): { fee: string; feeCurrency: string } {
  const q = quoteAssetFromMarket(market);
  if (new Decimal(quoteFee).gt(0)) {
    return { fee: quoteFee, feeCurrency: q };
  }
  if (new Decimal(baseFee).gt(0)) {
    return { fee: baseFee, feeCurrency: baseAssetFromMarket(market) };
  }
  return { fee: "0", feeCurrency: q };
}

/**
 * Atualiza `TradeCycle` ligado a uma ordem LIVE após reconciliação com totais remotos.
 */
export async function syncLinkedCycleForLiveOrder(
  tx: Tx,
  params: {
    cycleId: string;
    orderSide: OrderSide;
    market: string;
    nextOrderStatus: OrderStatus;
    filledAmount: string;
    filledValue: string;
    /** Alvo de venda (quote) ao marcar compra preenchida; opcional. */
    sellTargetPrice?: string;
  },
): Promise<{ cycleNeedsReview: boolean }> {
  const cycle = await tx.tradeCycle.findUnique({ where: { id: params.cycleId } });
  if (!cycle) return { cycleNeedsReview: false };

  const filledAmt = new Decimal(params.filledAmount);
  const filledVal = new Decimal(params.filledValue);
  const hasFill = filledAmt.gt(0);

  if (params.orderSide === OrderSide.BUY) {
    if (params.nextOrderStatus === OrderStatus.FILLED && hasFill) {
      const avgPx = filledVal.div(filledAmt).toFixed(12);
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: {
          status: CycleStatus.BUY_FILLED,
          entryPrice: avgPx,
          quoteSpent: params.filledValue,
          baseFilled: params.filledAmount,
          ...(params.sellTargetPrice ? { targetPrice: params.sellTargetPrice } : {}),
        },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.PARTIALLY_FILLED && hasFill) {
      const avgPx = filledVal.div(filledAmt).toFixed(12);
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: {
          status: CycleStatus.BUY_PARTIALLY_FILLED,
          entryPrice: avgPx,
          quoteSpent: params.filledValue,
          baseFilled: params.filledAmount,
          ...(params.sellTargetPrice ? { targetPrice: params.sellTargetPrice } : {}),
        },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.OPEN && !hasFill) {
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.BUY_PLACED },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.CANCELLED) {
      if (hasFill) {
        const avgPx = filledVal.div(filledAmt).toFixed(12);
        await tx.tradeCycle.update({
          where: { id: cycle.id },
          data: {
            status: CycleStatus.MANUAL_REVIEW,
            entryPrice: avgPx,
            quoteSpent: params.filledValue,
            baseFilled: params.filledAmount,
          },
        });
        return { cycleNeedsReview: true };
      }
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.CANCELLED },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.UNKNOWN) {
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.MANUAL_REVIEW },
      });
      return { cycleNeedsReview: true };
    }
  }

  if (params.orderSide === OrderSide.SELL) {
    if (params.nextOrderStatus === OrderStatus.FILLED && hasFill) {
      const quoteRecv = params.filledValue;
      const quoteSpent = cycle.quoteSpent?.toString() ?? "0";
      const profit = new Decimal(quoteRecv).minus(new Decimal(quoteSpent));
      const profitPct = new Decimal(quoteSpent).gt(0) ? profit.div(new Decimal(quoteSpent)).toFixed(8) : "0";
      if (profit.lt(0)) {
        await tx.tradeCycle.update({
          where: { id: cycle.id },
          data: {
            status: CycleStatus.MANUAL_REVIEW,
            closedAt: new Date(),
            realizedProfitQuote: profit.toFixed(12),
            realizedProfitPct: profitPct,
          },
        });
        return { cycleNeedsReview: true };
      }
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: {
          status: CycleStatus.CLOSED_PROFIT,
          closedAt: new Date(),
          realizedProfitQuote: profit.toFixed(12),
          realizedProfitPct: profitPct,
        },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.PARTIALLY_FILLED && hasFill) {
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.SELL_PARTIALLY_FILLED },
      });
      return { cycleNeedsReview: false };
    }

    if (params.nextOrderStatus === OrderStatus.CANCELLED) {
      if (hasFill) {
        await tx.tradeCycle.update({
          where: { id: cycle.id },
          data: { status: CycleStatus.MANUAL_REVIEW },
        });
        return { cycleNeedsReview: true };
      }
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.MANUAL_REVIEW },
      });
      return { cycleNeedsReview: true };
    }

    if (params.nextOrderStatus === OrderStatus.UNKNOWN) {
      await tx.tradeCycle.update({
        where: { id: cycle.id },
        data: { status: CycleStatus.MANUAL_REVIEW },
      });
      return { cycleNeedsReview: true };
    }
  }

  return { cycleNeedsReview: false };
}
