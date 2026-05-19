import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { bootstrapInitialMarketBuy, type BootstrapInitialBuyResult } from "../live-cycle/live-cycle.service.js";
import { resetLiveDailyVolumeForTests } from "../orders/live-daily-quote-volume.js";
import { resetLiveCycleCircuitBreaker } from "../live-cycle/live-cycle-state.js";
import { appendBotEvent, updateBotRuntimeState } from "../strategy/bot-control.service.js";

export const RESET_TRADING_DATA_CONFIRM = "RESET_ALL_TRADING_DATA";

export type TradingDataResetCounts = {
  orderFills: number;
  orders: number;
  tradeCycles: number;
  botEvents: number;
  btcDropStates: number;
  autoLiveAnchors: number;
};

export type TradingDataResetResult = TradingDataResetCounts & {
  bootstrap?: BootstrapInitialBuyResult;
};

export type TradingDataResetOptions = {
  /** Compra a mercado + ciclo após limpar (omissão: true). */
  bootstrapBuy?: boolean;
  /** Se true, desliga o motor (OFF) após o reset (omissão: false). */
  stopMotor?: boolean;
};

export async function resetAllTradingData(
  env: Env,
  log: FastifyBaseLogger,
  options: TradingDataResetOptions = {},
): Promise<TradingDataResetResult> {
  const bootstrapBuy = options.bootstrapBuy !== false;
  const stopMotor = options.stopMotor === true;

  const counts = await prisma.$transaction(async (tx) => {
    await tx.tradeCycle.updateMany({
      data: { buyOrderId: null, sellOrderId: null },
    });

    const orderFills = await tx.orderFill.deleteMany({});
    const orders = await tx.order.deleteMany({});
    const tradeCycles = await tx.tradeCycle.deleteMany({});
    const botEvents = await tx.botEvent.deleteMany({});
    const btcDropStates = await tx.btcDropStrategyState.deleteMany({});
    const autoLiveAnchors = await tx.autoLiveMarketAnchor.deleteMany({});

    return {
      orderFills: orderFills.count,
      orders: orders.count,
      tradeCycles: tradeCycles.count,
      botEvents: botEvents.count,
      btcDropStates: btcDropStates.count,
      autoLiveAnchors: autoLiveAnchors.count,
    };
  });

  resetLiveCycleCircuitBreaker();
  resetLiveDailyVolumeForTests();

  if (stopMotor) {
    await updateBotRuntimeState({ runtimeStatus: "OFF" }, { via: "POST /bot/reset-trading-data" });
  }

  let bootstrap: BootstrapInitialBuyResult | undefined;
  if (bootstrapBuy) {
    bootstrap = await bootstrapInitialMarketBuy(env, log);
  }

  await appendBotEvent("WARN", "TRADING_DATA_RESET", "Histórico apagado; bootstrap de compra inicial", {
    counts,
    bootstrapBuy,
    stopMotor,
    bootstrap: bootstrap ?? null,
  });

  return { ...counts, bootstrap };
}
