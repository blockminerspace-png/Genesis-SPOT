import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { CycleStatus, OrderSide, OrderStatus } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { getRuntimeStateService } from "../runtime/runtime-state.service.js";
import { getOrderManager } from "../orders/order-manager.js";
import { getMarketDataService } from "../market-data/market-data.service.js";
import { getMarketSpecService } from "../market-data/market-spec.service.js";
import { getSimulationState, applySimulatedBuyFill, applySimulatedSellFill } from "../simulation/simulation-state.store.js";
import { gridBuyLimitBelowLast, targetSellFromEntry, btcAmountForQuoteSpend } from "../strategy/grid.strategy.js";
import { canOpenAnotherCycle, hasMinQuoteBalance, validateOrderAgainstMarketSpec } from "../risk/risk-manager.js";
import { Decimal } from "../../shared/decimal.js";
import { floorBaseAmount, floorQuoteValue } from "../market-data/market-spec.rounding.js";
import {
  type MarketSpec,
  OrderRejectedMinAmountError,
  OrderRejectedMinValueError,
} from "../market-data/market-spec.types.js";

const ACTIVE_CYCLE: CycleStatus[] = [
  "WAITING_BUY_SIGNAL",
  "BUY_PLACED",
  "BUY_PARTIALLY_FILLED",
  "BUY_FILLED",
  "SELL_PLACED",
  "SELL_PARTIALLY_FILLED",
];

let timer: NodeJS.Timeout | undefined;
let lastCycleCreateMs = 0;
const OPEN_COOLDOWN_MS = 25_000;

export function startSimulatedCycleWorker(log: FastifyBaseLogger, intervalMs = 8000) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void tick(log).catch((err) => log.error({ err }, "simulated-cycle tick failed"));
  }, intervalMs);
  void tick(log).catch((err) => log.error({ err }, "simulated-cycle initial tick failed"));
}

export function stopSimulatedCycleWorker() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

async function tick(log: FastifyBaseLogger) {
  const runtime = getRuntimeStateService();
  const perms = await runtime.getPermissions();

  if (perms.executionLayer !== "SIMULATED") {
    return;
  }

  if (perms.runtimeStatus === "OFF" || perms.runtimeStatus === "KILL_SWITCH") {
    return;
  }

  const cfg = await runtime.getBotConfigRow();
  const spec = await getMarketSpecService().getSpec(cfg.market);
  const sim = getSimulationState();
  let lastRaw: string;
  try {
    const snap = await getMarketDataService().getTicker(cfg.market);
    lastRaw = snap.last;
  } catch {
    return;
  }
  if (!lastRaw) {
    return;
  }
  const last = new Decimal(lastRaw);

  await fillOpenBuyOrders(last, cfg.market, log, spec);
  await fillOpenSellOrders(last, cfg.market, log, spec);

  if (!runtime.canOpenBuyCycle(perms)) {
    return;
  }

  const pendingBuys = await prisma.order.count({
    where: { side: OrderSide.BUY, status: OrderStatus.OPEN, market: cfg.market },
  });
  if (pendingBuys > 0) {
    return;
  }

  if (Date.now() - lastCycleCreateMs < OPEN_COOLDOWN_MS) {
    return;
  }

  const openCycles = await prisma.tradeCycle.count({
    where: { status: { in: ACTIVE_CYCLE } },
  });

  if (!canOpenAnotherCycle(openCycles, cfg.maxOpenCycles)) {
    log.debug({ openCycles, max: cfg.maxOpenCycles }, "max open cycles — skip");
    return;
  }

  if (!hasMinQuoteBalance(sim.usdt, cfg.minQuoteBalance.toString())) {
    log.debug({ usdt: sim.usdt }, "min quote balance — skip");
    return;
  }

  const limitPx = gridBuyLimitBelowLast(lastRaw, cfg.gridStepPct.toString(), spec);
  const quote = cfg.orderQuoteSize.toString();
  const btcAmt = btcAmountForQuoteSpend(quote, limitPx, spec);

  if (new Decimal(quote).gt(new Decimal(sim.usdt))) {
    return;
  }

  try {
    validateOrderAgainstMarketSpec(btcAmt, limitPx, spec);
  } catch (err) {
    const type =
      err instanceof OrderRejectedMinValueError
        ? "ORDER_REJECTED_MIN_VALUE"
        : err instanceof OrderRejectedMinAmountError
          ? "ORDER_REJECTED_MIN_AMOUNT"
          : "ORDER_REJECTED_MIN_AMOUNT";
    await appendBotEvent("WARN", type, String((err as Error).message), {
      market: cfg.market,
      baseAmount: btcAmt,
      price: limitPx,
    });
    return;
  }

  const cycle = await prisma.tradeCycle.create({
    data: {
      market: cfg.market,
      status: CycleStatus.BUY_PLACED,
      quoteBudget: quote,
      quoteSpent: "0",
      baseFilled: "0",
    },
  });

  lastCycleCreateMs = Date.now();

  await appendBotEvent("INFO", "CYCLE_CREATED", `Ciclo simulado ${cycle.id}`, { cycleId: cycle.id });

  const om = getOrderManager();
  const clientId = `BUY_${cycle.id}_${randomUUID().slice(0, 8)}`;

  try {
    const placed = await om.placeLimitOrder({
      cycleId: cycle.id,
      market: cfg.market,
      side: "BUY",
      amount: btcAmt,
      price: limitPx,
      clientId,
    });

    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { buyOrderId: placed.orderId },
    });

    await appendBotEvent("INFO", "SIMULATED_BUY_PLACED", "Ordem de compra simulada criada", {
      cycleId: cycle.id,
      orderId: placed.orderId,
    });
  } catch (err) {
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.CANCELLED },
    });
    await appendBotEvent("WARN", "BUY_SIGNAL_REJECTED", String((err as Error).message), {
      cycleId: cycle.id,
    });
    log.warn({ err }, "open simulated buy failed");
  }
}

async function fillOpenBuyOrders(
  last: InstanceType<typeof Decimal>,
  market: string,
  log: FastifyBaseLogger,
  spec: MarketSpec,
) {
  const buys = await prisma.order.findMany({
    where: { side: OrderSide.BUY, status: OrderStatus.OPEN, market },
    include: { cycle: true },
  });

  for (const o of buys) {
    if (!o.cycle || !o.price) continue;
    const lim = new Decimal(o.price.toString());
    if (last.gt(lim)) continue;

    const amt = new Decimal(o.amount.toString());
    const quoteSpent = floorQuoteValue(lim.mul(amt), spec).toFixed(spec.quotePrecision);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: o.id },
        data: {
          status: OrderStatus.FILLED,
          filledAmount: o.amount,
          filledValue: quoteSpent,
        },
      });
      await tx.tradeCycle.update({
        where: { id: o.cycleId! },
        data: {
          status: CycleStatus.BUY_FILLED,
          entryPrice: o.price,
          quoteSpent,
          baseFilled: o.amount,
        },
      });
    });

    applySimulatedBuyFill(quoteSpent, o.amount.toString());

    await appendBotEvent("INFO", "SIMULATED_BUY_FILLED", `Compra simulada filled @ ${o.price}`, {
      orderId: o.id,
      cycleId: o.cycleId,
    });

    const cyc = await prisma.tradeCycle.findUnique({ where: { id: o.cycleId! } });
    if (!cyc || !cyc.entryPrice) continue;

    const cfg = await getRuntimeStateService().getBotConfigRow();
    const sellPx = targetSellFromEntry(
      cyc.entryPrice.toString(),
      cfg.targetProfitPct.toString(),
      cfg.feeBufferPct.toString(),
      spec,
    );
    const sellAmt = floorBaseAmount(new Decimal(cyc.baseFilled.toString()), spec).toFixed(spec.basePrecision);
    try {
      validateOrderAgainstMarketSpec(sellAmt, sellPx, spec);
    } catch (err) {
      await appendBotEvent(
        "WARN",
        err instanceof OrderRejectedMinValueError ? "ORDER_REJECTED_MIN_VALUE" : "ORDER_REJECTED_MIN_AMOUNT",
        String((err as Error).message),
        { cycleId: cyc.id, baseAmount: sellAmt, price: sellPx },
      );
      log.warn({ err, cycleId: cyc.id }, "simulated sell intent rejected by market spec");
      continue;
    }
    const sellClient = `SELL_${cyc.id}_${randomUUID().slice(0, 8)}`;

    try {
      const placed = await getOrderManager().placeLimitOrder({
        cycleId: cyc.id,
        market,
        side: "SELL",
        amount: sellAmt,
        price: sellPx,
        clientId: sellClient,
      });
      await prisma.tradeCycle.update({
        where: { id: cyc.id },
        data: {
          status: CycleStatus.SELL_PLACED,
          targetPrice: sellPx,
          sellOrderId: placed.orderId,
        },
      });
      await appendBotEvent("INFO", "SIMULATED_SELL_PLACED", `Venda simulada @ ${sellPx}`, {
        cycleId: cyc.id,
      });
    } catch (err) {
      log.warn({ err }, "place simulated sell failed");
    }
  }
}

async function fillOpenSellOrders(
  last: InstanceType<typeof Decimal>,
  market: string,
  log: FastifyBaseLogger,
  spec: MarketSpec,
) {
  const sells = await prisma.order.findMany({
    where: { side: OrderSide.SELL, status: OrderStatus.OPEN, market },
    include: { cycle: true },
  });

  for (const o of sells) {
    if (!o.cycle || !o.price) continue;
    const lim = new Decimal(o.price.toString());
    if (last.lt(lim)) continue;

    const amt = new Decimal(o.amount.toString());
    const quoteRecv = floorQuoteValue(lim.mul(amt), spec).toFixed(spec.quotePrecision);
    const quoteSpent = o.cycle.quoteSpent?.toString() ?? "0";
    const profit = new Decimal(quoteRecv).minus(new Decimal(quoteSpent));
    const profitPct = new Decimal(quoteSpent).gt(0)
      ? profit.div(new Decimal(quoteSpent)).toFixed(8)
      : "0";

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: o.id },
        data: {
          status: OrderStatus.FILLED,
          filledAmount: o.amount,
          filledValue: quoteRecv,
        },
      });
      await tx.tradeCycle.update({
        where: { id: o.cycleId! },
        data: {
          status: CycleStatus.CLOSED_PROFIT,
          closedAt: new Date(),
          realizedProfitQuote: profit.toFixed(12),
          realizedProfitPct: profitPct,
        },
      });
    });

    applySimulatedSellFill(o.amount.toString(), quoteRecv);

    await appendBotEvent("INFO", "SIMULATED_SELL_FILLED", `Venda simulada filled @ ${o.price}`, {
      orderId: o.id,
      cycleId: o.cycleId,
    });
    await appendBotEvent("INFO", "CYCLE_CLOSED_PROFIT", "Ciclo fechado (simulado)", { cycleId: o.cycleId });

    log.info({ cycleId: o.cycleId }, "simulated cycle closed");
  }
}
