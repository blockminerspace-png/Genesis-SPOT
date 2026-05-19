/**
 * Camada de leitura/API para o cockpit Bot Spot.
 * Não cria ordens — o motor é `btc-drop` + live-cycle worker.
 */
import type { FastifyBaseLogger } from "fastify";
import { CycleStatus, OrderSide } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { getMarketDataService } from "../market-data/market-data.service.js";
import {
  getLiveReconciliationSummary,
  runLiveOrderReconciliationTick,
} from "../reconciliation/live-order-reconciliation.worker.js";
import { readBtcDropConfig } from "../strategy/btc-drop.types.js";
import { updateBotRuntimeState } from "../strategy/bot-control.service.js";
import { Decimal } from "../../shared/decimal.js";
import {
  fetchHyperliquidCandles,
  mapHlCandles,
} from "./hyperliquid-candles.service.js";
import {
  botSpotChartResponseSchema,
  botSpotStateSchema,
  type BotSpotChartResponse,
  type BotSpotState,
  type TradeFillDto,
} from "./bot-spot.types.js";
import { finiteOrNull, finitePositiveOrNull, validateBtcDropStrategyEnv } from "./bot-spot.validation.js";

const OPEN_CYCLE_STATUSES: CycleStatus[] = [
  CycleStatus.WAITING_BUY_SIGNAL,
  CycleStatus.BUY_PLACED,
  CycleStatus.BUY_PARTIALLY_FILLED,
  CycleStatus.BUY_FILLED,
  CycleStatus.SELL_PLACED,
  CycleStatus.SELL_PARTIALLY_FILLED,
  CycleStatus.ERROR,
  CycleStatus.MANUAL_REVIEW,
];

function mapCycleCockpitStatus(
  status: CycleStatus,
): "OPEN" | "BUY_PENDING" | "BUY_FILLED" | "SELL_PENDING" | "CLOSED" | "ERROR" {
  switch (status) {
    case CycleStatus.WAITING_BUY_SIGNAL:
      return "OPEN";
    case CycleStatus.BUY_PLACED:
    case CycleStatus.BUY_PARTIALLY_FILLED:
      return "BUY_PENDING";
    case CycleStatus.BUY_FILLED:
      return "BUY_FILLED";
    case CycleStatus.SELL_PLACED:
    case CycleStatus.SELL_PARTIALLY_FILLED:
      return "SELL_PENDING";
    case CycleStatus.CLOSED_PROFIT:
    case CycleStatus.CANCELLED:
      return "CLOSED";
    case CycleStatus.ERROR:
    case CycleStatus.MANUAL_REVIEW:
      return "ERROR";
    default:
      return "OPEN";
  }
}

function quoteCurrencyFromMarket(market: string): string {
  const m = market.toUpperCase();
  if (m.endsWith("USDC")) return "USDC";
  if (m.endsWith("USDT")) return "USDT";
  return "USD";
}

async function lastFillForSide(market: string, side: OrderSide): Promise<TradeFillDto | null> {
  const row = await prisma.orderFill.findFirst({
    where: { order: { market, side } },
    orderBy: { executedAt: "desc" },
    include: { order: { select: { id: true, cycleId: true, market: true, side: true } } },
  });
  if (!row?.order?.cycleId) return null;
  const price = finitePositiveOrNull(row.price);
  const qty = finitePositiveOrNull(row.amount);
  if (price === null || qty === null) return null;
  return {
    fillId: row.id,
    orderId: row.orderId,
    cycleId: row.order.cycleId,
    side,
    market: row.order.market,
    price,
    qty,
    fee: finiteOrNull(row.fee),
    feeCurrency: row.feeCurrency ?? null,
    source: "COINEX",
    filledAt: row.executedAt.toISOString(),
  };
}

function computeAvgEntryFromFills(
  fills: { price: { toString(): string }; amount: { toString(): string }; fee: { toString(): string } }[],
): number | null {
  let totalQty = new Decimal(0);
  let totalNotional = new Decimal(0);
  for (const f of fills) {
    const q = new Decimal(f.amount.toString());
    const p = new Decimal(f.price.toString());
    if (q.lte(0) || p.lte(0)) continue;
    totalQty = totalQty.plus(q);
    totalNotional = totalNotional.plus(p.times(q));
  }
  if (totalQty.lte(0)) return null;
  const avg = totalNotional.div(totalQty);
  const n = Number(avg.toString());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getBotSpotState(env: Env): Promise<BotSpotState> {
  const validation = validateBtcDropStrategyEnv(env);
  const cfg = validation.ok ? validation.cfg : readBtcDropConfig(env);
  const market = cfg.market.toUpperCase();
  const currency = quoteCurrencyFromMarket(market);

  const botRow = await prisma.botConfig.findFirst();
  const runtimeStatus = botRow?.runtimeStatus ?? "OFF";

  let livePrice: number | null = null;
  let priceSource: BotSpotState["priceSource"] = "UNKNOWN";
  if (validation.ok && cfg.enabled) {
    try {
      const { snap } = await getMarketDataService().getTickerWithFetchMeta(market);
      const p = finitePositiveOrNull(snap.last);
      if (p !== null) {
        livePrice = p;
        priceSource = "COINEX";
      }
    } catch {
      priceSource = "UNKNOWN";
    }
  }

  const dropRow = await prisma.btcDropStrategyState.findUnique({ where: { market } });
  const nextBuyLevel = dropRow ? finitePositiveOrNull(dropRow.nextBuyPrice) : null;

  const openCycleRow = await prisma.tradeCycle.findFirst({
    where: { market, status: { in: OPEN_CYCLE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });

  let positionQty = 0;
  let avgEntryPrice: number | null = null;
  let targetSellPrice: number | null = null;
  let realizedPnl: number | null = null;
  let unrealizedPnl: number | null = null;

  if (openCycleRow) {
    positionQty = finiteOrNull(openCycleRow.baseFilled) ?? 0;
    if (positionQty < 0) positionQty = 0;

    const buyFills = await prisma.orderFill.findMany({
      where: { order: { cycleId: openCycleRow.id, side: OrderSide.BUY } },
    });
    avgEntryPrice = computeAvgEntryFromFills(buyFills);
    if (avgEntryPrice === null) {
      avgEntryPrice = finitePositiveOrNull(openCycleRow.entryPrice);
    }

    const tp = finitePositiveOrNull(cfg.targetProfitPct);
    if (avgEntryPrice !== null && tp !== null) {
      targetSellPrice = avgEntryPrice * (1 + tp);
    } else {
      targetSellPrice = finitePositiveOrNull(openCycleRow.targetPrice);
    }

    if (livePrice !== null && avgEntryPrice !== null && positionQty > 0) {
      unrealizedPnl = (livePrice - avgEntryPrice) * positionQty;
    }
  }

  const lastClosed = await prisma.tradeCycle.findFirst({
    where: { market, status: CycleStatus.CLOSED_PROFIT },
    orderBy: { closedAt: "desc" },
  });
  if (lastClosed?.realizedProfitQuote != null) {
    realizedPnl = finiteOrNull(lastClosed.realizedProfitQuote);
  }

  const reconc = getLiveReconciliationSummary();
  const lastReconciledAt =
    reconc.lastHealthyTickCompletedAtMs != null
      ? new Date(reconc.lastHealthyTickCompletedAtMs).toISOString()
      : reconc.lastTickAtMs != null
        ? new Date(reconc.lastTickAtMs).toISOString()
        : null;

  const criticalEvents = await prisma.botEvent.findMany({
    where: {
      OR: [{ level: "ERROR" }, { level: "CRITICAL" }, { type: { contains: "DRIFT" } }],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const errors: BotSpotState["errors"] = [];
  if (!validation.ok) {
    for (const msg of validation.errors) {
      errors.push({
        code: "STRATEGY_ENV_INVALID",
        message: msg,
        severity: "CRITICAL",
        createdAt: new Date().toISOString(),
      });
    }
  }
  if (reconc.lastError) {
    errors.push({
      code: "RECONCILIATION_ERROR",
      message: reconc.lastError,
      severity: "HIGH",
      createdAt: lastReconciledAt ?? new Date().toISOString(),
    });
  }
  for (const ev of criticalEvents) {
    errors.push({
      code: ev.type,
      message: ev.message,
      severity: ev.level === "CRITICAL" ? "CRITICAL" : ev.level === "ERROR" ? "HIGH" : "MEDIUM",
      createdAt: ev.createdAt.toISOString(),
    });
  }

  let status: BotSpotState["status"] = "UNAVAILABLE";
  if (!validation.ok || !cfg.enabled) {
    status = "UNAVAILABLE";
  } else if (runtimeStatus === "KILL_SWITCH" || runtimeStatus === "OFF") {
    status = runtimeStatus === "OFF" ? "PAUSED" : "ERROR";
  } else if (runtimeStatus === "PAUSED_BUYS" || runtimeStatus === "SELL_ONLY") {
    status = "PAUSED";
  } else if (errors.some((e) => e.severity === "CRITICAL")) {
    status = "ERROR";
  } else if (livePrice === null) {
    status = "UNAVAILABLE";
  } else {
    status = "LIVE";
  }

  const orderQty = finitePositiveOrNull(cfg.baseAmount) ?? 0.0001;
  const dropStepUsd = finitePositiveOrNull(cfg.stepUsdt) ?? 2000;
  const targetProfitPct = finitePositiveOrNull(cfg.targetProfitPct) ?? 0.02;

  const state: BotSpotState = {
    status,
    market,
    livePrice,
    priceSource,
    strategy: {
      name: "BTC_DROP_2K",
      enabled: cfg.enabled,
      orderQty,
      dropStepUsd,
      targetProfitPct,
    },
    nextBuyLevel,
    openCycle: openCycleRow
      ? {
          cycleId: openCycleRow.id,
          status: mapCycleCockpitStatus(openCycleRow.status),
          openedAt: (openCycleRow.openedAt ?? openCycleRow.createdAt).toISOString(),
        }
      : null,
    position: {
      qty: positionQty,
      avgEntryPrice,
      notional: avgEntryPrice !== null && positionQty > 0 ? avgEntryPrice * positionQty : null,
    },
    targets: {
      sellPrice: targetSellPrice,
      expectedProfitPct: targetProfitPct,
    },
    pnl: {
      realized: realizedPnl,
      unrealized: unrealizedPnl,
      currency,
    },
    lastBuyFill: await lastFillForSide(market, OrderSide.BUY),
    lastSellFill: await lastFillForSide(market, OrderSide.SELL),
    lastReconciledAt,
    errors: errors.slice(0, 12),
  };

  return botSpotStateSchema.parse(state);
}

export async function getBotSpotChart(
  env: Env,
  params: { market: string; interval: string; fromMs: number; toMs: number },
): Promise<BotSpotChartResponse> {
  const market = params.market.toUpperCase();
  const interval = params.interval as BotSpotChartResponse["interval"];
  const state = await getBotSpotState(env);

  const hl = await fetchHyperliquidCandles(env, market, interval, params.fromMs, params.toMs);
  if (!hl.ok) {
    const empty: BotSpotChartResponse = {
      market,
      interval,
      candles: [],
      markers: [],
      lines: {
        nextBuyLevel: state.nextBuyLevel,
        targetSellPrice: state.targets.sellPrice,
        avgEntryPrice: state.position.avgEntryPrice,
      },
      unavailable: { status: "UNAVAILABLE", reason: hl.reason },
    };
    return botSpotChartResponseSchema.parse(empty);
  }

  const candles = mapHlCandles(hl.candles);

  const fills = await prisma.orderFill.findMany({
    where: {
      order: { market },
      executedAt: {
        gte: new Date(params.fromMs),
        lte: new Date(params.toMs),
      },
    },
    include: { order: { select: { id: true, cycleId: true, side: true } } },
    orderBy: { executedAt: "asc" },
    take: 500,
  });

  const markers: BotSpotChartResponse["markers"] = [];
  for (const f of fills) {
    if (!f.order?.cycleId) continue;
    const price = finitePositiveOrNull(f.price);
    const qty = finitePositiveOrNull(f.amount);
    if (price === null || qty === null) continue;
    const side = f.order.side;
    markers.push({
      time: f.executedAt.getTime(),
      position: side === OrderSide.BUY ? "belowBar" : "aboveBar",
      shape: side === OrderSide.BUY ? "arrowUp" : "arrowDown",
      text: `${side} ${qty} @ ${price}`,
      side,
      price,
      qty,
      cycleId: f.order.cycleId,
      orderId: f.orderId,
    });
  }

  const body: BotSpotChartResponse = {
    market,
    interval,
    candles,
    markers,
    lines: {
      nextBuyLevel: state.nextBuyLevel,
      targetSellPrice: state.targets.sellPrice,
      avgEntryPrice: state.position.avgEntryPrice,
    },
  };
  return botSpotChartResponseSchema.parse(body);
}

export async function listBotSpotCycles(market: string, limit = 50) {
  const rows = await prisma.tradeCycle.findMany({
    where: { market: market.toUpperCase() },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((c) => ({
    cycleId: c.id,
    market: c.market,
    status: c.status,
    openedAt: (c.openedAt ?? c.createdAt).toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
    positionQty: finiteOrNull(c.baseFilled) ?? 0,
    avgEntryPrice: finitePositiveOrNull(c.entryPrice),
    targetSellPrice: finitePositiveOrNull(c.targetPrice),
    realizedPnl: finiteOrNull(c.realizedProfitQuote),
  }));
}

export async function listBotSpotOrders(market: string, limit = 100) {
  const rows = await prisma.order.findMany({
    where: { market: market.toUpperCase() },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((o) => ({
    orderId: o.id,
    exchangeOrderId: o.exchangeOrderId,
    cycleId: o.cycleId,
    side: o.side,
    type: o.type,
    status: o.status,
    price: finitePositiveOrNull(o.price),
    qty: finitePositiveOrNull(o.amount),
    filledQty: finiteOrNull(o.filledAmount) ?? 0,
    avgFillPrice: (() => {
      const filled = new Decimal(o.filledAmount.toString());
      if (!filled.gt(0)) return null;
      return finitePositiveOrNull(new Decimal(o.filledValue.toString()).div(filled).toString());
    })(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}

export async function runBotSpotReconcile(env: Env, log: FastifyBaseLogger, market: string) {
  const startedAt = new Date().toISOString();
  const before = getLiveReconciliationSummary();
  await runLiveOrderReconciliationTick(env, log);
  const after = getLiveReconciliationSummary();
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    market: market.toUpperCase(),
    cyclesChecked: after.ordersScanned,
    ordersChecked: after.ordersScanned,
    newFills: Math.max(0, after.fillsImported - (before.fillsImported ?? 0)),
    updatedOrders: Math.max(0, after.ordersSynced - (before.ordersSynced ?? 0)),
    errors: after.lastError ? [{ code: "RECONCILE_TICK", message: after.lastError }] : [],
  };
}

export async function pauseBotSpot(env: Env) {
  await updateBotRuntimeState({ runtimeStatus: "PAUSED_BUYS" }, { via: "POST /bot-spot/pause" });
  return getBotSpotState(env);
}

export async function resumeBotSpot(env: Env) {
  await updateBotRuntimeState({ runtimeStatus: "RUNNING" }, { via: "POST /bot-spot/resume" });
  return getBotSpotState(env);
}
