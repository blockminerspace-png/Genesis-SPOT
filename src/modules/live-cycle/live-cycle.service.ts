import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { CycleStatus, OrderStatus } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { Decimal } from "../../shared/decimal.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { getRuntimeStateService } from "../runtime/runtime-state.service.js";
import { getOrderManager } from "../orders/order-manager.js";
import { getMarketDataService } from "../market-data/market-data.service.js";
import { getMarketSpecService } from "../market-data/market-spec.service.js";
import { getLiveReconciliationSummary } from "../reconciliation/live-order-reconciliation.worker.js";
import { runLivePlacePrecheck } from "../orders/live-safety/live-safety.guard.js";
import {
  btcAmountForQuoteSpend,
  liveAutoBuyBaseAmountExchangeMinimums,
  liveAutoBuyQuoteCap,
  liveAutoOrderQuoteCap,
  targetSellFromEntry,
} from "../strategy/grid.strategy.js";
import {
  bumpAutoLiveAnchorToPeak,
  gridDropBuyTriggered,
  gridDropTriggerPrice,
  resetAutoLiveAnchorAfterClose,
} from "./live-grid-anchor.service.js";
import { validateOrderAgainstMarketSpec, canOpenAnotherCycle, hasMinQuoteBalance } from "../risk/risk-manager.js";
import { floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { OrderRejectedMinAmountError, OrderRejectedMinValueError } from "../market-data/market-spec.types.js";
import { getSpotBalancesForLiveGuard, invalidateLiveBalanceCache } from "../orders/live-coinex-balance-snapshot.js";
import {
  getLiveCycleSummary,
  isLiveCycleCircuitOpen,
  openLiveCycleCircuit,
  recordLiveCycleError,
  recordLiveCycleSuccess,
  recordLiveCycleTickStart,
  setLiveCycleSummaryPatch,
  shouldEmitBlockedEvent,
  maybeEmitDisabledThrottle,
} from "./live-cycle-state.js";
import type { LiveCycleSummary } from "./live-cycle.types.js";
import { AUTO_LIVE_CONFIRM_REQUIRED_PHRASE } from "./live-cycle.constants.js";
import { computeLiveAutoSellTargetPrice } from "./live-sell-target.util.js";
import {
  advanceBtcDropLevelAfterBuy,
  armBtcDropStateAfterInit,
  ensureBtcDropState,
  maybeBumpBtcDropAnchor,
  resetBtcDropState,
} from "../strategy/btc-drop-state.service.js";
import {
  BTC_DROP_STRATEGY_NAME,
  btcDropBuyTriggered,
  btcDropFlooredBaseAmount,
  btcDropQuoteValue,
  buildBtcDropBuySignal,
  readBtcDropConfig,
  validateBtcDropBuyAgainstSpec,
  validateBtcDropLiveQuoteCap,
} from "../strategy/btc-drop.strategy.js";

export type BootstrapInitialBuyResult = {
  attempted: boolean;
  ok: boolean;
  message: string;
  cycleId?: string;
};

function summarizeBlockedChecks(checks: LiveCycleSummary["checks"], fallback: string): string {
  const bad = checks.filter((c) => !c.ok);
  if (bad.length === 0) return fallback;
  const parts = bad.map((c) => (c.message ? `${c.name}: ${c.message}` : c.name));
  const s = parts.join(" · ");
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

/** Evita LIVE_CYCLE_BUY_FILLED_DETECTED repetido em cada tick antes da SELL. */
const buyFilledEventSent = new Set<string>();

const TERMINAL: CycleStatus[] = [
  CycleStatus.CLOSED_PROFIT,
  CycleStatus.CANCELLED,
  CycleStatus.ERROR,
  CycleStatus.MANUAL_REVIEW,
];

function isLiveNumericExchangeId(id: string | null): boolean {
  if (!id) return false;
  if (id.startsWith("sim-")) return false;
  return /^\d+$/.test(id);
}

export function autoLiveMarkets(env: Env, configMarket: string): string[] {
  if (env.BTC_STRATEGY_ENABLED) {
    return [env.BTC_STRATEGY_MARKET.trim().toUpperCase()];
  }
  const single = (env.AUTO_LIVE_MARKET ?? "").trim().toUpperCase();
  if (single) return [single];
  const allow = parseLiveMarketAllowlist(env);
  if (allow.length > 0) return allow;
  return [configMarket.toUpperCase()];
}

/** Primeiro par ativo (API / painel legado). */
export function autoLiveMarket(env: Env, configMarket: string): string {
  return autoLiveMarkets(env, configMarket)[0] ?? configMarket.toUpperCase();
}

/** Orçamento desejado em quote; o teto efetivo sobe ao lote mínimo da CoinEx em `liveAutoBuyQuoteCap`. */
export function effectiveAutoLiveQuoteBudget(env: Env): string {
  return new Decimal(env.AUTO_LIVE_ORDER_QUOTE_VALUE).toFixed();
}

const lastGridWaitEventMs = new Map<string, number>();

function parseLiveMarketAllowlist(env: Env): string[] {
  return env.LIVE_MARKET_ALLOWLIST.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function buyBlockingStatuses(env: Env): CycleStatus[] {
  const base: CycleStatus[] = [
    CycleStatus.WAITING_BUY_SIGNAL,
    CycleStatus.BUY_PLACED,
    CycleStatus.BUY_PARTIALLY_FILLED,
  ];
  if (env.AUTO_LIVE_REQUIRE_SELL_AFTER_BUY) {
    base.push(CycleStatus.BUY_FILLED);
  }
  if (!env.AUTO_LIVE_ALLOW_NEW_BUY_WITH_OPEN_SELL) {
    base.push(CycleStatus.SELL_PLACED, CycleStatus.SELL_PARTIALLY_FILLED);
  }
  return base;
}

async function countLiveAutoCycles(market: string, statuses: CycleStatus[]): Promise<number> {
  return prisma.tradeCycle.count({
    where: { isLiveAutoWorker: true, market, status: { in: statuses } },
  });
}

async function countLiveAutoActive(market: string): Promise<number> {
  return prisma.tradeCycle.count({
    where: {
      isLiveAutoWorker: true,
      market,
      status: { notIn: TERMINAL },
    },
  });
}

async function listLiveAutoMarketsNeedingSell(): Promise<string[]> {
  const rows = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      status: CycleStatus.BUY_FILLED,
      sellOrderId: null,
      buyOrderId: { not: null },
    },
    distinct: ["market"],
    select: { market: true },
  });
  return rows.map((r) => r.market.toUpperCase());
}

/** Ciclos já comprados antes de gravarmos `targetPrice` no painel — preenche alvo indicativo (mesma fórmula que a venda). */
async function backfillMissingSellTargetsForUi(market: string): Promise<void> {
  const rows = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      market: market.toUpperCase(),
      status: { in: [CycleStatus.BUY_FILLED, CycleStatus.BUY_PARTIALLY_FILLED] },
      sellOrderId: null,
      entryPrice: { not: null },
      targetPrice: null,
    },
    select: { id: true, entryPrice: true, market: true },
    take: 10,
  });
  for (const r of rows) {
    const ep = r.entryPrice?.toString();
    if (!ep) continue;
    const target = await computeLiveAutoSellTargetPrice(r.market, ep);
    if (!target) continue;
    await prisma.tradeCycle.update({
      where: { id: r.id },
      data: { targetPrice: target },
    });
  }
}

async function hasStaleLiveOpenOrdersForMarket(env: Env, market: string): Promise<boolean> {
  const m = market.toUpperCase();
  const rows = await prisma.order.findMany({
    where: {
      market: m,
      status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
      exchangeOrderId: { not: null },
      updatedAt: { lt: new Date(Date.now() - env.AUTO_LIVE_MAX_ORDER_STALE_MS) },
    },
    select: { exchangeOrderId: true },
    take: 80,
  });
  return rows.some((r) => isLiveNumericExchangeId(r.exchangeOrderId));
}

async function hasRecentBalanceDriftEvent(env: Env): Promise<boolean> {
  const since = new Date(Date.now() - env.AUTO_LIVE_BALANCE_DRIFT_LOOKBACK_MS);
  const ev = await prisma.botEvent.findFirst({
    where: { type: "BALANCE_DRIFT_DETECTED", createdAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(ev);
}

function reconciliationChecks(env: Env, recon: ReturnType<typeof getLiveReconciliationSummary>, checks: LiveCycleSummary["checks"]): boolean {
  let ok = true;
  if (recon.lastHealthyTickCompletedAtMs === null) {
    checks.push({ name: "reconciliation_healthy_ever", ok: false, message: "nunca houve tick saudável" });
    ok = false;
  } else {
    const age = Date.now() - recon.lastHealthyTickCompletedAtMs;
    if (age > env.AUTO_LIVE_MIN_RECONCILIATION_SUCCESS_AGE_MS) {
      checks.push({
        name: "reconciliation_healthy_fresh",
        ok: false,
        message: `último tick saudável há ${age}ms (máx ${env.AUTO_LIVE_MIN_RECONCILIATION_SUCCESS_AGE_MS})`,
      });
      ok = false;
    } else {
      checks.push({ name: "reconciliation_healthy_fresh", ok: true });
    }
  }

  if (recon.lastError) {
    checks.push({ name: "reconciliation_last_error", ok: false, message: recon.lastError });
    ok = false;
  } else {
    checks.push({ name: "reconciliation_last_error", ok: true });
  }

  if (recon.fillSumDriftDetected) {
    checks.push({
      name: "reconciliation_fill_sum",
      ok: false,
      message: recon.fillSumDriftDetail ?? "fill drift",
    });
    ok = false;
  } else {
    checks.push({ name: "reconciliation_fill_sum", ok: true });
  }

  checks.push({
    name: "reconciliation_healthy",
    ok,
    message: ok ? undefined : "reconciliador LIVE não saudável",
  });
  return ok;
}

const announcedClosed = new Set<string>();
const announcedManual = new Set<string>();

async function emitOutcomeEventsOnce(env: Env): Promise<void> {
  const recent = new Date(Date.now() - 120_000);
  const closed = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      status: CycleStatus.CLOSED_PROFIT,
      closedAt: { gte: recent },
    },
    select: { id: true, market: true, realizedProfitQuote: true },
  });
  for (const c of closed) {
    if (announcedClosed.has(c.id)) continue;
    announcedClosed.add(c.id);
    if (announcedClosed.size > 500) {
      announcedClosed.clear();
      announcedClosed.add(c.id);
    }
    await appendBotEvent("INFO", "LIVE_CYCLE_CLOSED_PROFIT", `ciclo ${c.id} fechado`, {
      cycleId: c.id,
      realizedProfitQuote: c.realizedProfitQuote?.toString(),
    });
    await appendBotEvent("INFO", "LIVE_CYCLE_SELL_FILLED_DETECTED", `venda filled / ciclo fechado ${c.id}`, {
      cycleId: c.id,
    });
    if (!env.BTC_STRATEGY_ENABLED) {
      try {
        const ticker = await getMarketDataService().getTickerWithFetchMeta(c.market);
        const { spec } = await getMarketSpecService().getSpecWithFetchedAt(c.market);
        await resetAutoLiveAnchorAfterClose(c.market, ticker.snap.last, spec);
      } catch {
        /* reancoragem opcional */
      }
    }
  }

  const manual = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      status: CycleStatus.MANUAL_REVIEW,
      updatedAt: { gte: recent },
    },
    select: { id: true },
  });
  for (const c of manual) {
    if (announcedManual.has(c.id)) continue;
    announcedManual.add(c.id);
    if (announcedManual.size > 500) {
      announcedManual.clear();
      announcedManual.add(c.id);
    }
    await appendBotEvent("WARN", "LIVE_CYCLE_MANUAL_REVIEW", `ciclo ${c.id} requer revisão manual`, { cycleId: c.id });
  }
}

async function handleStuckWaiting(log: FastifyBaseLogger): Promise<void> {
  const old = new Date(Date.now() - 120_000);
  const stuck = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      status: CycleStatus.WAITING_BUY_SIGNAL,
      buyOrderId: null,
      createdAt: { lt: old },
    },
  });
  for (const c of stuck) {
    await prisma.tradeCycle.update({
      where: { id: c.id },
      data: { status: CycleStatus.ERROR },
    });
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", "ciclo LIVE auto preso em WAITING_BUY_SIGNAL", { cycleId: c.id });
    log.warn({ cycleId: c.id }, "live auto cycle stuck in WAITING");
  }
}

function computeSellableBase(
  buy: { filledAmount: { toString(): string }; fee: { toString(): string }; feeCurrency: string | null },
  spec: MarketSpec,
): string {
  const baseCcy = spec.baseCurrency.toUpperCase();
  let b = new Decimal(buy.filledAmount.toString());
  const fc = (buy.feeCurrency ?? "").toUpperCase();
  if (fc === baseCcy && new Decimal(buy.fee.toString()).gt(0)) {
    b = b.minus(new Decimal(buy.fee.toString()));
  }
  return floorBaseAmount(b, spec).toFixed(spec.basePrecision);
}

async function tryPlaceSellForCycle(
  env: Env,
  log: FastifyBaseLogger,
  market: string,
  targetProfitPct: string,
  feeBufferPct: string,
  spec: MarketSpec,
): Promise<void> {
  const rt = getRuntimeStateService();
  const cycle = await prisma.tradeCycle.findFirst({
    where: {
      isLiveAutoWorker: true,
      market,
      status: CycleStatus.BUY_FILLED,
      sellOrderId: null,
    },
  });
  if (!cycle?.buyOrderId) return;

  const buy = await prisma.order.findUnique({ where: { id: cycle.buyOrderId } });
  if (!buy || buy.status !== OrderStatus.FILLED) return;

  const sellClient = `LIVE_AUTO_SELL_${cycle.id}`;
  const existing = await prisma.order.findUnique({ where: { clientId: sellClient } });
  if (existing) {
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { sellOrderId: existing.id, status: CycleStatus.SELL_PLACED, targetPrice: existing.price },
    });
    return;
  }

  const fills = await prisma.orderFill.findMany({ where: { orderId: buy.id } });
  let avgPx = new Decimal(0);
  if (fills.length > 0) {
    let sumV = new Decimal(0);
    let sumA = new Decimal(0);
    for (const f of fills) {
      sumV = sumV.plus(new Decimal(f.value.toString()));
      sumA = sumA.plus(new Decimal(f.amount.toString()));
    }
    avgPx = sumA.gt(0) ? sumV.div(sumA) : new Decimal(buy.filledValue.toString()).div(new Decimal(buy.filledAmount.toString()));
  } else {
    avgPx = new Decimal(buy.filledValue.toString()).div(new Decimal(buy.filledAmount.toString()));
  }

  const avgStr = floorPrice(avgPx, spec).toFixed(spec.quotePrecision);
  const sellPx = targetSellFromEntry(avgStr, targetProfitPct, feeBufferPct, spec);
  const sellAmt = computeSellableBase(
    { filledAmount: buy.filledAmount, fee: buy.fee, feeCurrency: buy.feeCurrency },
    spec,
  );

  validateOrderAgainstMarketSpec(sellAmt, sellPx, spec);

  const perms = await rt.getPermissions();
  const sellNotional = new Decimal(sellAmt).mul(new Decimal(sellPx)).toFixed(spec.quotePrecision);
  const sellQuoteCapForPrecheck = liveAutoOrderQuoteCap(sellNotional, env.LIVE_MAX_ORDER_QUOTE_VALUE, spec);
  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    {
      market,
      side: "SELL",
      amount: sellAmt,
      price: sellPx,
    },
    { maxQuotePerOrder: sellQuoteCapForPrecheck, skipMarketAllowlist: true },
  );
  if (!pre.valid) {
    await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", pre.error ?? "precheck sell", {
      cycleId: cycle.id,
      checks: pre.checks as unknown as Prisma.InputJsonValue,
    });
    return;
  }

  const sellQuoteEst = new Decimal(pre.flooredAmount).mul(new Decimal(pre.flooredPrice)).toFixed(spec.quotePrecision);
  const sellQuoteCap = liveAutoOrderQuoteCap(sellQuoteEst, env.LIVE_MAX_ORDER_QUOTE_VALUE, spec);

  if (!buyFilledEventSent.has(cycle.id)) {
    buyFilledEventSent.add(cycle.id);
    if (buyFilledEventSent.size > 200) buyFilledEventSent.clear();
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_FILLED_DETECTED", `compra filled; preparar venda ${cycle.id}`, {
      cycleId: cycle.id,
      orderId: buy.id,
    });
    if (env.BTC_STRATEGY_ENABLED) {
      await appendBotEvent("INFO", "BTC_DROP_SELL_TARGET_CREATED", `alvo venda +${targetProfitPct} sobre entrada`, {
        cycleId: cycle.id,
        sellPrice: sellPx,
        avgEntry: avgStr,
      });
    }
  }

  if (!perms.canPlaceSellOrders) {
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "runtime não permite venda", { cycleId: cycle.id });
    return;
  }

  await appendBotEvent("INFO", "LIVE_CYCLE_SELL_PLACING", `SELL limit ciclo ${cycle.id}`, { cycleId: cycle.id });
  try {
    const placed = await getOrderManager().placeLimitOrder({
      cycleId: cycle.id,
      market,
      side: "SELL",
      amount: pre.flooredAmount,
      price: pre.flooredPrice,
      clientId: sellClient,
      liveMaxQuoteOverride: sellQuoteCap,
    });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: {
        sellOrderId: placed.orderId,
        status: CycleStatus.SELL_PLACED,
        targetPrice: pre.flooredPrice,
      },
    });
    await appendBotEvent("INFO", "LIVE_CYCLE_SELL_PLACED", `venda LIVE colocada ${placed.exchangeOrderId}`, {
      cycleId: cycle.id,
      orderId: placed.orderId,
    });
    log.info({ cycleId: cycle.id, orderId: placed.orderId }, "live auto sell placed");
  } catch (e) {
    const msg = String((e as Error).message);
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, { cycleId: cycle.id, phase: "sell" });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.MANUAL_REVIEW },
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_MANUAL_REVIEW", `falha ao colocar SELL ${cycle.id}`, { cycleId: cycle.id });
  }
}

async function tryOpenBtcDropBuyCycle(
  env: Env,
  log: FastifyBaseLogger,
  _cfg: Awaited<ReturnType<ReturnType<typeof getRuntimeStateService>["getBotConfigRow"]>>,
  market: string,
): Promise<boolean> {
  const dropCfg = readBtcDropConfig(env);
  const m = market.toUpperCase();
  if (m !== dropCfg.market) {
    return false;
  }

  const rt = getRuntimeStateService();
  const ticker = await getMarketDataService().getTickerWithFetchMeta(m);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(m);
  const last = ticker.snap.last;
  const refPx = floorPrice(new Decimal(last), spec).toFixed(spec.quotePrecision);

  const ensured = await ensureBtcDropState(env, last, spec);
  const openActive = await countLiveAutoActive(m);
  if ((ensured.justInitialized || !ensured.state.initialized) && openActive === 0) {
    await armBtcDropStateAfterInit(m);
    const boot = await bootstrapBtcDropInitialMarketBuy(env, log, _cfg, m);
    return boot.ok;
  }

  const totalCycles = await prisma.tradeCycle.count({
    where: { isLiveAutoWorker: true, market: m },
  });
  if (totalCycles === 0 && openActive === 0) {
    const boot = await bootstrapBtcDropInitialMarketBuy(env, log, _cfg, m);
    if (boot.ok) return true;
  }

  await maybeBumpBtcDropAnchor(env, last, spec);
  const stateRow = await ensureBtcDropState(env, last, spec);
  const nextBuy = stateRow.state.nextBuyPrice;

  if (!btcDropBuyTriggered(refPx, nextBuy)) {
    const nowMs = Date.now();
    const prev = lastGridWaitEventMs.get(m) ?? 0;
    if (nowMs - prev >= 120_000) {
      lastGridWaitEventMs.set(m, nowMs);
      await appendBotEvent(
        "INFO",
        "LIVE_CYCLE_GRID_WAIT",
        `${m}: BTC Drop — à espera ≤${nextBuy} (último=${refPx} anchor=${stateRow.state.anchorPrice})`,
        { market: m, nextBuyPrice: nextBuy, last: refPx, anchor: stateRow.state.anchorPrice },
      );
    }
    return false;
  }

  await appendBotEvent("INFO", "BTC_DROP_BUY_LEVEL_REACHED", `${m}: preço ${refPx} ≤ nível ${nextBuy}`, {
    market: m,
    last: refPx,
    nextBuyPrice: nextBuy,
  });

  const signal = buildBtcDropBuySignal(env, refPx, nextBuy, spec);
  const specCheck = validateBtcDropBuyAgainstSpec(signal, spec);
  if (!specCheck.ok) {
    await appendBotEvent("WARN", "BTC_DROP_ORDER_AMOUNT_BELOW_MIN", specCheck.message, {
      market: m,
      baseAmount: signal.baseAmount,
      limitPrice: signal.limitPrice,
    });
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", specCheck.message, { market: m });
    return false;
  }

  const capCheck = validateBtcDropLiveQuoteCap(signal.quoteValue, env.LIVE_MAX_ORDER_QUOTE_VALUE);
  if (!capCheck.ok) {
    await appendBotEvent("WARN", "BTC_DROP_ORDER_VALUE_ABOVE_LIVE_LIMIT", `notional ${capCheck.quoteValue} > ${capCheck.cap}`, {
      market: m,
      quoteValue: capCheck.quoteValue,
      liveMax: capCheck.cap,
    });
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", "valor em quote acima de LIVE_MAX_ORDER_QUOTE_VALUE", {
      market: m,
    });
    return false;
  }

  try {
    validateOrderAgainstMarketSpec(signal.baseAmount, signal.limitPrice, spec);
  } catch (err) {
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", String((err as Error).message), { market: m });
    return false;
  }

  const perms = await rt.getPermissions();
  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    {
      market: m,
      side: "BUY",
      amount: signal.baseAmount,
      price: signal.limitPrice,
    },
    { maxQuotePerOrder: signal.quoteValue, skipMakerOnlyHint: false },
  );
  if (!pre.valid) {
    if (pre.checks.some((c) => c.name === "balance_buy_quote" && !c.ok)) {
      invalidateLiveBalanceCache();
    }
    await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", pre.error ?? "precheck buy", {
      checks: pre.checks as unknown as Prisma.InputJsonValue,
    });
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", pre.error ?? "precheck BUY falhou", { market: m });
    return false;
  }

  if (!perms.canPlaceBuyOrders) {
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", "runtime não permite compra", { market: m });
    return false;
  }

  const blockingStatuses = buyBlockingStatuses(env);
  const cycle = await prisma.$transaction(async (tx) => {
    const blocking = await tx.tradeCycle.count({
      where: { isLiveAutoWorker: true, market: m, status: { in: blockingStatuses } },
    });
    if (blocking > 0) return null;
    return tx.tradeCycle.create({
      data: {
        market: m,
        status: CycleStatus.WAITING_BUY_SIGNAL,
        quoteBudget: signal.quoteValue,
        quoteSpent: "0",
        baseFilled: "0",
        isLiveAutoWorker: true,
        strategyName: BTC_DROP_STRATEGY_NAME,
        strategyLevelPrice: signal.levelPrice,
        baseOrderAmount: signal.baseAmount,
      },
    });
  });

  if (!cycle) {
    await appendBotEvent("WARN", "BTC_DROP_BUY_SIGNAL_REJECTED", "ciclo bloqueado ou BUY/SELL aberta", { market: m });
    return false;
  }

  const buyClient = `LIVE_AUTO_BUY_${cycle.id}`;
  const dup = await prisma.order.findUnique({ where: { clientId: buyClient } });
  if (dup) {
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { buyOrderId: dup.id, status: CycleStatus.BUY_PLACED },
    });
    return true;
  }

  await appendBotEvent("INFO", "LIVE_CYCLE_CREATED", `ciclo BTC Drop ${cycle.id}`, { cycleId: cycle.id });
  await appendBotEvent("INFO", "BTC_DROP_BUY_SIGNAL_CREATED", "sinal BUY limit aceito", {
    cycleId: cycle.id,
    market: m,
    baseAmount: signal.baseAmount,
    limitPrice: signal.limitPrice,
    levelPrice: signal.levelPrice,
  });
  await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACING", `BUY limit ciclo ${cycle.id}`, { cycleId: cycle.id });

  try {
    const placed = await getOrderManager().placeLimitOrder({
      cycleId: cycle.id,
      market: m,
      side: "BUY",
      amount: pre.flooredAmount,
      price: pre.flooredPrice,
      clientId: buyClient,
      liveMaxQuoteOverride: signal.quoteValue,
    });

    await advanceBtcDropLevelAfterBuy(m, dropCfg.stepUsdt, spec);

    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: {
        buyOrder: { connect: { id: placed.orderId } },
        status: CycleStatus.BUY_PLACED,
      },
    });
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACED", `compra LIMIT ${placed.exchangeOrderId}`, {
      cycleId: cycle.id,
      orderId: placed.orderId,
    });
    log.info({ cycleId: cycle.id, orderId: placed.orderId }, "btc drop buy limit placed");
    return true;
  } catch (e) {
    const msg = String((e as Error).message);
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, { cycleId: cycle.id, phase: "buy" });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.MANUAL_REVIEW },
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_MANUAL_REVIEW", `falha BUY BTC Drop ${cycle.id}`, { cycleId: cycle.id });
    return false;
  }
}

async function tryOpenBuyCycle(
  env: Env,
  log: FastifyBaseLogger,
  cfg: Awaited<ReturnType<ReturnType<typeof getRuntimeStateService>["getBotConfigRow"]>>,
  market: string,
): Promise<boolean> {
  if (env.BTC_STRATEGY_ENABLED) {
    return tryOpenBtcDropBuyCycle(env, log, cfg, market);
  }

  const rt = getRuntimeStateService();
  const ticker = await getMarketDataService().getTickerWithFetchMeta(market);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(market);

  const last = ticker.snap.last;
  const refPx = floorPrice(new Decimal(last), spec).toFixed(spec.quotePrecision);
  const gridStep = cfg.gridStepPct.toString();

  const anchor = await bumpAutoLiveAnchorToPeak(market, last, spec);
  if (!gridDropBuyTriggered(anchor, refPx, gridStep)) {
    const triggerPx = gridDropTriggerPrice(anchor, gridStep, spec);
    const nowMs = Date.now();
    const prev = lastGridWaitEventMs.get(market) ?? 0;
    if (nowMs - prev >= 120_000) {
      lastGridWaitEventMs.set(market, nowMs);
      await appendBotEvent(
        "INFO",
        "LIVE_CYCLE_GRID_WAIT",
        `${market}: à espera queda de ${gridStep} (último=${refPx} pico=${anchor} compra≤${triggerPx})`,
        { market, anchor, triggerPx, last: refPx, gridStepPct: gridStep },
      );
    }
    return false;
  }

  await appendBotEvent("INFO", "LIVE_CYCLE_GRID_TRIGGER", `${market}: queda ${gridStep} atingida — compra mínima`, {
    market,
    anchor,
    last: refPx,
    gridStepPct: gridStep,
  });
  const quoteBudget = effectiveAutoLiveQuoteBudget(env);
  let btcAmt: string;
  try {
    btcAmt = liveAutoBuyBaseAmountExchangeMinimums(refPx, quoteBudget, spec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", msg, { market, phase: "min_base_compose" });
    return false;
  }
  const maxQuoteOverride = liveAutoBuyQuoteCap(quoteBudget, btcAmt, refPx, env.LIVE_MAX_ORDER_QUOTE_VALUE, spec);
  if (new Decimal(maxQuoteOverride).gt(new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE))) {
    log.info(
      { market, quoteCap: maxQuoteOverride, liveMaxOrderQuote: env.LIVE_MAX_ORDER_QUOTE_VALUE },
      "live auto BUY: teto por ordem elevado acima de LIVE_MAX_ORDER_QUOTE_VALUE para cobrir notional do lote mínimo",
    );
  }
  try {
    validateOrderAgainstMarketSpec(btcAmt, refPx, spec);
  } catch (err) {
    const type =
      err instanceof OrderRejectedMinValueError
        ? "ORDER_REJECTED_MIN_VALUE"
        : err instanceof OrderRejectedMinAmountError
          ? "ORDER_REJECTED_MIN_AMOUNT"
          : "ORDER_REJECTED_MARKET_SPEC";
    await appendBotEvent("WARN", type, String((err as Error).message), {
      market,
      baseAmount: btcAmt,
      price: refPx,
      quoteBudget,
    });
    await appendBotEvent(
      "WARN",
      "LIVE_CYCLE_SIGNAL_REJECTED",
      "abaixo do mínimo da CoinEx ou notional inválido: ajuste LIVE_MAX_ORDER_QUOTE_VALUE / AUTO_LIVE_ORDER_QUOTE_VALUE.",
      { market },
    );
    return false;
  }

  if (new Decimal(btcAmt).gt(new Decimal(btcAmountForQuoteSpend(quoteBudget, refPx, spec)))) {
    await appendBotEvent(
      "INFO",
      "LIVE_CYCLE_BUY_BUMPED_TO_MIN_LOT",
      `quantidade = mínimo CoinEx para o par (min_amount / min_value da API), não o valor só pelo orçamento em quote.`,
      {
        market,
        baseAmount: btcAmt,
        quoteCap: maxQuoteOverride,
      },
    );
  }

  const perms = await rt.getPermissions();
  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    {
      market,
      side: "BUY",
      amount: btcAmt,
      price: refPx,
    },
    { maxQuotePerOrder: maxQuoteOverride, skipMakerOnlyHint: true },
  );
  if (!pre.valid) {
    if (pre.checks.some((c) => c.name === "balance_buy_quote" && !c.ok)) {
      invalidateLiveBalanceCache();
    }
    await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", pre.error ?? "precheck buy", {
      checks: pre.checks as unknown as Prisma.InputJsonValue,
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", pre.error ?? "precheck BUY falhou", {});
    return false;
  }

  if (!perms.canPlaceBuyOrders) {
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "runtime não permite compra", {});
    return false;
  }

  const blockingStatuses = buyBlockingStatuses(env);
  const cycle = await prisma.$transaction(async (tx) => {
    const blocking = await tx.tradeCycle.count({
      where: { isLiveAutoWorker: true, market, status: { in: blockingStatuses } },
    });
    if (blocking > 0) return null;
    return tx.tradeCycle.create({
      data: {
        market,
        status: CycleStatus.WAITING_BUY_SIGNAL,
        quoteBudget: maxQuoteOverride,
        quoteSpent: "0",
        baseFilled: "0",
        isLiveAutoWorker: true,
      },
    });
  });

  if (!cycle) {
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "race ou ciclo bloqueado ao criar BUY", { market });
    return false;
  }

  const buyClient = `LIVE_AUTO_BUY_${cycle.id}`;
  const dup = await prisma.order.findUnique({ where: { clientId: buyClient } });
  if (dup) {
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { buyOrderId: dup.id, status: CycleStatus.BUY_PLACED },
    });
    return true;
  }

  await appendBotEvent("INFO", "LIVE_CYCLE_CREATED", `ciclo LIVE auto ${cycle.id}`, { cycleId: cycle.id });
  await appendBotEvent("INFO", "LIVE_CYCLE_SIGNAL_CREATED", "sinal BUY Auto LIVE aceito", { cycleId: cycle.id, market });
  await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACING", `BUY mercado ciclo ${cycle.id}`, { cycleId: cycle.id });

  try {
    const placed = await getOrderManager().placeMarketBuy({
      cycleId: cycle.id,
      market,
      baseAmount: pre.flooredAmount,
      referencePrice: pre.flooredPrice,
      clientId: buyClient,
      liveMaxQuoteOverride: maxQuoteOverride,
    });

    const orderRow = await prisma.order.findUnique({ where: { id: placed.orderId } });
    let cycleData: Prisma.TradeCycleUpdateInput = {
      buyOrder: { connect: { id: placed.orderId } },
      status: CycleStatus.BUY_PLACED,
    };
    if (orderRow?.status === OrderStatus.FILLED && new Decimal(orderRow.filledAmount.toString()).gt(0)) {
      const fa = orderRow.filledAmount.toString();
      const fv = orderRow.filledValue.toString();
      const avgPx = new Decimal(fv).div(new Decimal(fa)).toFixed(12);
      const avgStr = floorPrice(new Decimal(avgPx), spec).toFixed(spec.quotePrecision);
      const targetPrice = targetSellFromEntry(avgStr, cfg.targetProfitPct.toString(), cfg.feeBufferPct.toString(), spec);
      cycleData = {
        buyOrder: { connect: { id: placed.orderId } },
        status: CycleStatus.BUY_FILLED,
        entryPrice: avgPx,
        quoteSpent: fv,
        baseFilled: fa,
        targetPrice,
      };
      await appendBotEvent("INFO", "LIVE_CYCLE_BUY_FILLED_DETECTED", `compra mercado filled; preparar venda ${cycle.id}`, {
        cycleId: cycle.id,
      });
    } else if (orderRow?.status === OrderStatus.PARTIALLY_FILLED && new Decimal(orderRow.filledAmount.toString()).gt(0)) {
      const fa = orderRow.filledAmount.toString();
      const fv = orderRow.filledValue.toString();
      const avgPx = new Decimal(fv).div(new Decimal(fa)).toFixed(12);
      const avgStr = floorPrice(new Decimal(avgPx), spec).toFixed(spec.quotePrecision);
      const targetPrice = targetSellFromEntry(avgStr, cfg.targetProfitPct.toString(), cfg.feeBufferPct.toString(), spec);
      cycleData = {
        buyOrder: { connect: { id: placed.orderId } },
        status: CycleStatus.BUY_PARTIALLY_FILLED,
        entryPrice: avgPx,
        quoteSpent: fv,
        baseFilled: fa,
        targetPrice,
      };
    }

    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: cycleData,
    });
    const placedMsg =
      orderRow?.status === OrderStatus.FILLED
        ? `compra LIVE mercado executada ${placed.exchangeOrderId}`
        : `compra LIVE mercado ${placed.exchangeOrderId}`;
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACED", placedMsg, { cycleId: cycle.id, orderId: placed.orderId });
    log.info({ cycleId: cycle.id, orderId: placed.orderId }, "live auto buy placed");
    return true;
  } catch (e) {
    const msg = String((e as Error).message);
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, { cycleId: cycle.id, phase: "buy" });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.MANUAL_REVIEW },
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_MANUAL_REVIEW", `falha BUY LIVE ${cycle.id}`, { cycleId: cycle.id });
    return false;
  }
}

export async function runLiveAutoCycleServiceTick(env: Env, log: FastifyBaseLogger): Promise<void> {
  const nowMs = Date.now();
  recordLiveCycleTickStart(env.ENABLE_AUTO_LIVE_WORKER);
  await appendBotEvent("INFO", "LIVE_CYCLE_TICK_STARTED", "tick auto LIVE", {
    enabled: env.ENABLE_AUTO_LIVE_WORKER,
  });

  const checks: LiveCycleSummary["checks"] = [];
  const push = (name: string, ok: boolean, message?: string) => {
    checks.push({ name, ok, message });
    return ok;
  };

  const finish = async (status: string) => {
    await appendBotEvent("INFO", "LIVE_CYCLE_TICK_FINISHED", "fim do tick", { status });
  };

  if (!env.ENABLE_AUTO_LIVE_WORKER) {
    setLiveCycleSummaryPatch({
      status: "DISABLED",
      enabledByEnv: false,
      checks,
      lastDecision: "ENABLE_AUTO_LIVE_WORKER=false",
    });
    if (maybeEmitDisabledThrottle(nowMs)) {
      await appendBotEvent("INFO", "LIVE_CYCLE_WORKER_DISABLED", "Auto LIVE Worker desligado no .env", {});
    }
    await finish("DISABLED");
    return;
  }

  if (isLiveCycleCircuitOpen()) {
    setLiveCycleSummaryPatch({
      status: "CIRCUIT_OPEN",
      enabledByEnv: true,
      checks,
      lastDecision: "circuit_breaker",
    });
    await finish("CIRCUIT_OPEN");
    return;
  }

  try {
    const rt = getRuntimeStateService();
    const perms = await rt.getPermissions();
    const cfg = await rt.getBotConfigRow();
    const markets = autoLiveMarkets(env, cfg.market);
    const recon = getLiveReconciliationSummary();

    let gate = true;
    gate = push("enable_auto_live_worker", true) && gate;
    gate = push("enable_live_trading", env.ENABLE_LIVE_TRADING, env.ENABLE_LIVE_TRADING ? undefined : "false") && gate;
    gate = push(
      "auto_live_confirm_env",
      env.AUTO_LIVE_CONFIRM_ENV === AUTO_LIVE_CONFIRM_REQUIRED_PHRASE,
      env.AUTO_LIVE_CONFIRM_ENV ? "set" : "empty",
    ) && gate;
    gate = push("runtime_running", perms.runtimeStatus === "RUNNING", perms.runtimeStatus) && gate;
    gate = push("kill_switch_off", perms.runtimeStatus !== "KILL_SWITCH") && gate;
    gate =
      push(
        "market_data_source_coinex",
        env.MARKET_DATA_SOURCE === "COINEX",
        env.MARKET_DATA_SOURCE !== "COINEX" ? "Genesis SPOT exige MARKET_DATA_SOURCE=COINEX" : undefined,
      ) && gate;
    gate =
      push(
        "portfolio_balance_source_coinex",
        env.PORTFOLIO_BALANCE_SOURCE === "COINEX",
        env.PORTFOLIO_BALANCE_SOURCE !== "COINEX"
          ? "Genesis SPOT exige PORTFOLIO_BALANCE_SOURCE=COINEX"
          : undefined,
      ) && gate;
    gate =
      push(
        "execution_mode_live",
        perms.executionModeDb === "LIVE",
        perms.executionModeDb !== "LIVE" ? "Genesis SPOT exige execution_mode=LIVE" : perms.executionModeDb,
      ) && gate;
    gate = push("execution_layer_live", perms.executionLayer === "LIVE", perms.executionLayer) && gate;
    gate = push("coinex_keys", Boolean(env.COINEX_ACCESS_ID && env.COINEX_SECRET_KEY)) && gate;
    const allow = parseLiveMarketAllowlist(env);
    const marketsOk = markets.length > 0 && markets.every((m) => allow.includes(m));
    gate = push("live_market_allowlist", marketsOk, markets.join(",")) && gate;

    if (!gate) {
      const fp = checks.filter((c) => !c.ok).map((c) => c.name).join(",");
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "precheck_runtime"),
      });
      if (shouldEmitBlockedEvent(nowMs, fp)) {
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "travas runtime/env", {
          checks: checks as unknown as Prisma.InputJsonValue,
        });
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    if (!reconciliationChecks(env, recon, checks)) {
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "reconciliation_unhealthy"),
      });
      if (shouldEmitBlockedEvent(nowMs, `recon:${checks.filter((c) => !c.ok).map((c) => c.name).join(",")}`)) {
        await appendBotEvent("WARN", "LIVE_CYCLE_RECONCILIATION_STALE", "reconciliador LIVE não saudável", {
          checks: checks as unknown as Prisma.InputJsonValue,
        });
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "reconciliador", {});
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    if (await hasRecentBalanceDriftEvent(env)) {
      checks.push({
        name: "balance_drift_recent",
        ok: true,
        message: "BALANCE_DRIFT_DETECTED recente — outros mercados/ciclos continuam; rever conta.",
      });
    }

    const targetProfitPct = env.BTC_STRATEGY_ENABLED ? env.BTC_TARGET_PROFIT_PCT : cfg.targetProfitPct.toString();
    const feeBufferPct = cfg.feeBufferPct.toString();

    await handleStuckWaiting(log);
    await emitOutcomeEventsOnce(env);

    const sellMarkets = Array.from(new Set([...(await listLiveAutoMarketsNeedingSell()), ...markets]));
    for (const sellMarket of sellMarkets) {
      try {
        if (await hasStaleLiveOpenOrdersForMarket(env, sellMarket)) continue;
        const { spec } = await getMarketSpecService().getSpecWithFetchedAt(sellMarket);
        await backfillMissingSellTargetsForUi(sellMarket);
        await tryPlaceSellForCycle(env, log, sellMarket, targetProfitPct, feeBufferPct, spec);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", `falha ao preparar venda ${sellMarket}: ${msg}`, { market: sellMarket });
      }
    }

    if (!getRuntimeStateService().canOpenBuyCycle(perms)) {
      checks.push({ name: "can_open_buy_cycle", ok: false });
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "runtime_buys"),
      });
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    const bal = await getSpotBalancesForLiveGuard(env, log, env.LIVE_BALANCE_MAX_AGE_MS);
    const marketDecisions: string[] = [];
    let anyBuy = false;

    for (const autoMarket of markets) {
      let marketGate = true;
      const mChecks: LiveCycleSummary["checks"] = [];

      const { spec, fetchedAtMs } = await getMarketSpecService().getSpecWithFetchedAt(autoMarket);
      const specAge = Date.now() - fetchedAtMs;
      const specOk = spec.source === "COINEX" && specAge <= env.LIVE_MARKET_SPEC_MAX_AGE_MS;
      marketGate = (mChecks.push({ name: `${autoMarket}_spec`, ok: specOk, message: specOk ? undefined : `${specAge}ms` }), specOk) && marketGate;
      marketGate = (mChecks.push({ name: `${autoMarket}_api_trading`, ok: spec.apiTradingEnabled }), spec.apiTradingEnabled) && marketGate;
      marketGate = (mChecks.push({ name: `${autoMarket}_trading`, ok: spec.tradingEnabled }), spec.tradingEnabled) && marketGate;

      let ticker;
      try {
        ticker = await getMarketDataService().getTickerWithFetchMeta(autoMarket);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        mChecks.push({ name: `${autoMarket}_ticker`, ok: false, message: msg });
        marketDecisions.push(`${autoMarket}:ticker_err`);
        checks.push(...mChecks);
        continue;
      }
      const tickAge = Date.now() - ticker.fetchedAtMs;
      const tickOk = ticker.snap.priceSource === "COINEX" && tickAge <= env.LIVE_MARKET_DATA_MAX_AGE_MS;
      marketGate = (mChecks.push({ name: `${autoMarket}_ticker`, ok: tickOk, message: `${tickAge}ms` }), tickOk) && marketGate;

      const quoteCcy = spec.quoteCurrency.toUpperCase();
      const quoteBal = bal.balances.find((b) => b.asset.toUpperCase() === quoteCcy);
      const quoteAvail = quoteBal?.available ?? "0";
      const balOk = hasMinQuoteBalance(quoteAvail, cfg.minQuoteBalance.toString());
      marketGate =
        (mChecks.push({
          name: `${autoMarket}_min_quote`,
          ok: balOk,
          message: `${quoteAvail} ${quoteCcy}`,
        }),
        balOk) && marketGate;

      checks.push(...mChecks);

      if (!marketGate) {
        marketDecisions.push(`${autoMarket}:blocked`);
        continue;
      }

      const manualReview = await prisma.tradeCycle.count({
        where: { isLiveAutoWorker: true, market: autoMarket, status: CycleStatus.MANUAL_REVIEW },
      });
      if (manualReview > 0) {
        checks.push({
          name: `${autoMarket}_manual_review`,
          ok: false,
          message: `${manualReview} ciclo(s) em revisão — só este par pausado`,
        });
        marketDecisions.push(`${autoMarket}:manual_review`);
        continue;
      }

      if (await hasStaleLiveOpenOrdersForMarket(env, autoMarket)) {
        checks.push({
          name: `${autoMarket}_live_orders_fresh`,
          ok: false,
          message: "ordem LIVE deste par desatualizada no recon",
        });
        marketDecisions.push(`${autoMarket}:stale_orders`);
        continue;
      }

      const blocking = buyBlockingStatuses(env);
      const blockingCount = await countLiveAutoCycles(autoMarket, blocking);
      if (blockingCount > 0) {
        marketDecisions.push(`${autoMarket}:wait_cycle`);
        continue;
      }

      const activeAuto = await countLiveAutoActive(autoMarket);
      if (!canOpenAnotherCycle(activeAuto, env.AUTO_LIVE_MAX_OPEN_CYCLES)) {
        marketDecisions.push(`${autoMarket}:max_cycles`);
        continue;
      }

      const lastClosed = await prisma.tradeCycle.findFirst({
        where: {
          isLiveAutoWorker: true,
          market: autoMarket,
          status: { in: TERMINAL },
        },
        orderBy: { updatedAt: "desc" },
        select: { closedAt: true, updatedAt: true },
      });
      const refTime = lastClosed?.closedAt ?? lastClosed?.updatedAt;
      if (refTime && env.AUTO_LIVE_COOLDOWN_MS > 0) {
        const elapsed = Date.now() - refTime.getTime();
        if (elapsed < env.AUTO_LIVE_COOLDOWN_MS) {
          marketDecisions.push(`${autoMarket}:cooldown`);
          continue;
        }
      }

      const buyProgressed = await tryOpenBuyCycle(env, log, cfg, autoMarket);
      if (buyProgressed) anyBuy = true;
      marketDecisions.push(buyProgressed ? `${autoMarket}:buy` : `${autoMarket}:no_signal`);
    }

    setLiveCycleSummaryPatch({
      status: "RUNNING",
      enabledByEnv: true,
      checks,
      lastDecision: anyBuy ? "opened_or_attempted_buy" : marketDecisions.join("|") || "idle",
    });
    recordLiveCycleSuccess();
    await finish("RUNNING");
  } catch (e) {
    const msg = String((e as Error).message);
    recordLiveCycleError(msg, "ERROR");
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, {});
    const s = getLiveCycleSummary();
    if (s.consecutiveErrors >= env.AUTO_LIVE_MAX_CONSECUTIVE_ERRORS) {
      openLiveCycleCircuit(env);
      await appendBotEvent("ERROR", "LIVE_CYCLE_CIRCUIT_OPENED", `circuito aberto após ${s.consecutiveErrors} erros`, {
        circuitOpenUntil: s.circuitOpenUntil,
      });
    }
    await finish("ERROR");
  }
}

async function applyMarketBuyFillToCycle(
  cycleId: string,
  placedOrderId: string,
  spec: MarketSpec,
  targetProfitPct: string,
  feeBufferPct: string,
): Promise<void> {
  const orderRow = await prisma.order.findUnique({ where: { id: placedOrderId } });
  let cycleData: Prisma.TradeCycleUpdateInput = {
    buyOrder: { connect: { id: placedOrderId } },
    status: CycleStatus.BUY_PLACED,
  };
  if (orderRow?.status === OrderStatus.FILLED && new Decimal(orderRow.filledAmount.toString()).gt(0)) {
    const fa = orderRow.filledAmount.toString();
    const fv = orderRow.filledValue.toString();
    const avgPx = new Decimal(fv).div(new Decimal(fa)).toFixed(12);
    const avgStr = floorPrice(new Decimal(avgPx), spec).toFixed(spec.quotePrecision);
    const targetPrice = targetSellFromEntry(avgStr, targetProfitPct, feeBufferPct, spec);
    cycleData = {
      buyOrder: { connect: { id: placedOrderId } },
      status: CycleStatus.BUY_FILLED,
      entryPrice: avgPx,
      quoteSpent: fv,
      baseFilled: fa,
      targetPrice,
    };
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_FILLED_DETECTED", `compra mercado filled; preparar venda ${cycleId}`, {
      cycleId,
    });
  } else if (orderRow?.status === OrderStatus.PARTIALLY_FILLED && new Decimal(orderRow.filledAmount.toString()).gt(0)) {
    const fa = orderRow.filledAmount.toString();
    const fv = orderRow.filledValue.toString();
    const avgPx = new Decimal(fv).div(new Decimal(fa)).toFixed(12);
    const avgStr = floorPrice(new Decimal(avgPx), spec).toFixed(spec.quotePrecision);
    const targetPrice = targetSellFromEntry(avgStr, targetProfitPct, feeBufferPct, spec);
    cycleData = {
      buyOrder: { connect: { id: placedOrderId } },
      status: CycleStatus.BUY_PARTIALLY_FILLED,
      entryPrice: avgPx,
      quoteSpent: fv,
      baseFilled: fa,
      targetPrice,
    };
  }
  await prisma.tradeCycle.update({ where: { id: cycleId }, data: cycleData });
}

async function bootstrapBtcDropInitialMarketBuy(
  env: Env,
  log: FastifyBaseLogger,
  cfg: Awaited<ReturnType<ReturnType<typeof getRuntimeStateService>["getBotConfigRow"]>>,
  market: string,
): Promise<BootstrapInitialBuyResult> {
  const dropCfg = readBtcDropConfig(env);
  const m = market.toUpperCase();
  if (m !== dropCfg.market) {
    return { attempted: false, ok: false, message: `mercado ${m} ≠ BTC_STRATEGY_MARKET` };
  }

  if ((await countLiveAutoActive(m)) > 0) {
    return { attempted: false, ok: false, message: "já há ciclos abertos — bootstrap ignorado" };
  }

  const rt = getRuntimeStateService();
  const perms = await rt.getPermissions();
  if (!perms.canPlaceBuyOrders) {
    return {
      attempted: true,
      ok: false,
      message: `motor em ${perms.runtimeStatus} — ligue RUNNING para compra inicial`,
    };
  }

  const ticker = await getMarketDataService().getTickerWithFetchMeta(m);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(m);
  const last = ticker.snap.last;
  const refPx = floorPrice(new Decimal(last), spec).toFixed(spec.quotePrecision);

  await resetBtcDropState(env, last, spec, true);

  const baseAmount = btcDropFlooredBaseAmount(dropCfg.baseAmount, spec);
  const quoteValue = btcDropQuoteValue(baseAmount, refPx, spec);

  try {
    validateOrderAgainstMarketSpec(baseAmount, refPx, spec);
  } catch (err) {
    return { attempted: true, ok: false, message: String((err as Error).message) };
  }

  const capCheck = validateBtcDropLiveQuoteCap(quoteValue, env.LIVE_MAX_ORDER_QUOTE_VALUE);
  if (!capCheck.ok) {
    return {
      attempted: true,
      ok: false,
      message: `notional ${capCheck.quoteValue} > LIVE_MAX_ORDER_QUOTE_VALUE ${capCheck.cap}`,
    };
  }

  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    { market: m, side: "BUY", amount: baseAmount, price: refPx },
    { maxQuotePerOrder: quoteValue, skipMakerOnlyHint: true },
  );
  if (!pre.valid) {
    return { attempted: true, ok: false, message: pre.error ?? "precheck compra inicial falhou" };
  }

  const cycle = await prisma.tradeCycle.create({
    data: {
      market: m,
      status: CycleStatus.WAITING_BUY_SIGNAL,
      quoteBudget: quoteValue,
      quoteSpent: "0",
      baseFilled: "0",
      isLiveAutoWorker: true,
      strategyName: BTC_DROP_STRATEGY_NAME,
      strategyLevelPrice: refPx,
      baseOrderAmount: baseAmount,
    },
  });

  const buyClient = `LIVE_AUTO_BUY_${cycle.id}`;
  await appendBotEvent("INFO", "BTC_DROP_INITIAL_MARKET_BUY", `${m}: compra a mercado após reset/bootstrap`, {
    cycleId: cycle.id,
    baseAmount,
    referencePrice: refPx,
  });
  await appendBotEvent("INFO", "LIVE_CYCLE_CREATED", `ciclo bootstrap ${cycle.id}`, { cycleId: cycle.id });
  await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACING", `BUY mercado bootstrap ${cycle.id}`, { cycleId: cycle.id });

  try {
    const placed = await getOrderManager().placeMarketBuy({
      cycleId: cycle.id,
      market: m,
      baseAmount: pre.flooredAmount,
      referencePrice: pre.flooredPrice,
      clientId: buyClient,
      liveMaxQuoteOverride: quoteValue,
    });

    await advanceBtcDropLevelAfterBuy(m, dropCfg.stepUsdt, spec);

    const targetProfitPct = env.BTC_TARGET_PROFIT_PCT;
    await applyMarketBuyFillToCycle(cycle.id, placed.orderId, spec, targetProfitPct, cfg.feeBufferPct.toString());

    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACED", `bootstrap mercado ${placed.exchangeOrderId}`, {
      cycleId: cycle.id,
      orderId: placed.orderId,
    });
    return { attempted: true, ok: true, message: "compra inicial a mercado enviada", cycleId: cycle.id };
  } catch (e) {
    const msg = String((e as Error).message);
    await prisma.tradeCycle.update({ where: { id: cycle.id }, data: { status: CycleStatus.MANUAL_REVIEW } });
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, { cycleId: cycle.id, phase: "bootstrap_buy" });
    return { attempted: true, ok: false, message: msg, cycleId: cycle.id };
  }
}

async function bootstrapLegacyInitialMarketBuy(
  env: Env,
  log: FastifyBaseLogger,
  cfg: Awaited<ReturnType<ReturnType<typeof getRuntimeStateService>["getBotConfigRow"]>>,
  market: string,
): Promise<BootstrapInitialBuyResult> {
  if ((await countLiveAutoActive(market)) > 0) {
    return { attempted: false, ok: false, message: "já há ciclos abertos — bootstrap ignorado" };
  }

  const rt = getRuntimeStateService();
  const perms = await rt.getPermissions();
  if (!perms.canPlaceBuyOrders) {
    return {
      attempted: true,
      ok: false,
      message: `motor em ${perms.runtimeStatus} — ligue RUNNING para compra inicial`,
    };
  }

  const ticker = await getMarketDataService().getTickerWithFetchMeta(market);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(market);
  const refPx = floorPrice(new Decimal(ticker.snap.last), spec).toFixed(spec.quotePrecision);
  const quoteBudget = effectiveAutoLiveQuoteBudget(env);
  let btcAmt: string;
  try {
    btcAmt = liveAutoBuyBaseAmountExchangeMinimums(refPx, quoteBudget, spec);
  } catch (e) {
    return { attempted: true, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const maxQuoteOverride = liveAutoBuyQuoteCap(quoteBudget, btcAmt, refPx, env.LIVE_MAX_ORDER_QUOTE_VALUE, spec);

  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    { market, side: "BUY", amount: btcAmt, price: refPx },
    { maxQuotePerOrder: maxQuoteOverride, skipMakerOnlyHint: true },
  );
  if (!pre.valid) {
    return { attempted: true, ok: false, message: pre.error ?? "precheck compra inicial falhou" };
  }

  const cycle = await prisma.tradeCycle.create({
    data: {
      market,
      status: CycleStatus.WAITING_BUY_SIGNAL,
      quoteBudget: maxQuoteOverride,
      quoteSpent: "0",
      baseFilled: "0",
      isLiveAutoWorker: true,
    },
  });

  const buyClient = `LIVE_AUTO_BUY_${cycle.id}`;
  await appendBotEvent("INFO", "LIVE_CYCLE_BOOTSTRAP_MARKET_BUY", `${market}: compra a mercado após reset`, {
    cycleId: cycle.id,
  });

  try {
    const placed = await getOrderManager().placeMarketBuy({
      cycleId: cycle.id,
      market,
      baseAmount: pre.flooredAmount,
      referencePrice: pre.flooredPrice,
      clientId: buyClient,
      liveMaxQuoteOverride: maxQuoteOverride,
    });
    await applyMarketBuyFillToCycle(
      cycle.id,
      placed.orderId,
      spec,
      cfg.targetProfitPct.toString(),
      cfg.feeBufferPct.toString(),
    );
    await bumpAutoLiveAnchorToPeak(market, ticker.snap.last, spec);
    return { attempted: true, ok: true, message: "compra inicial a mercado enviada", cycleId: cycle.id };
  } catch (e) {
    const msg = String((e as Error).message);
    await prisma.tradeCycle.update({ where: { id: cycle.id }, data: { status: CycleStatus.MANUAL_REVIEW } });
    return { attempted: true, ok: false, message: msg, cycleId: cycle.id };
  }
}

/** Compra a mercado + ciclo na CoinEx após reset ou primeiro tick (BTC Drop / legado). */
export async function bootstrapInitialMarketBuy(
  env: Env,
  log: FastifyBaseLogger,
): Promise<BootstrapInitialBuyResult> {
  if (!env.ENABLE_LIVE_TRADING) {
    return { attempted: false, ok: false, message: "ENABLE_LIVE_TRADING=false" };
  }
  if (!env.COINEX_ACCESS_ID || !env.COINEX_SECRET_KEY) {
    return { attempted: false, ok: false, message: "chaves CoinEx ausentes" };
  }

  const cfg = await getRuntimeStateService().getBotConfigRow();
  const market = autoLiveMarket(env, cfg.market);

  if (env.BTC_STRATEGY_ENABLED) {
    return bootstrapBtcDropInitialMarketBuy(env, log, cfg, market);
  }
  return bootstrapLegacyInitialMarketBuy(env, log, cfg, market);
}
