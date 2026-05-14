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
import { btcAmountForQuoteSpend, gridBuyLimitBelowLast, targetSellFromEntry } from "../strategy/grid.strategy.js";
import { validateOrderAgainstMarketSpec, canOpenAnotherCycle, hasMinQuoteBalance } from "../risk/risk-manager.js";
import { floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { getSpotBalancesForLiveGuard } from "../orders/live-coinex-balance-snapshot.js";
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

export function autoLiveMarket(env: Env, configMarket: string): string {
  const m = (env.AUTO_LIVE_MARKET ?? "").trim();
  return (m || configMarket).toUpperCase();
}

export function effectiveAutoLiveQuoteBudget(env: Env): string {
  return Decimal.min(new Decimal(env.AUTO_LIVE_ORDER_QUOTE_VALUE), new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE)).toFixed();
}

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

async function hasStaleLiveOpenOrders(env: Env): Promise<boolean> {
  const rows = await prisma.order.findMany({
    where: {
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

async function hasManualReviewLiveAutoCycle(): Promise<boolean> {
  const c = await prisma.tradeCycle.findFirst({
    where: { isLiveAutoWorker: true, status: CycleStatus.MANUAL_REVIEW },
    select: { id: true },
  });
  return Boolean(c);
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

async function emitOutcomeEventsOnce(): Promise<void> {
  const recent = new Date(Date.now() - 120_000);
  const closed = await prisma.tradeCycle.findMany({
    where: {
      isLiveAutoWorker: true,
      status: CycleStatus.CLOSED_PROFIT,
      closedAt: { gte: recent },
    },
    select: { id: true, realizedProfitQuote: true },
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
  const sellQuoteCapForPrecheck = Decimal.min(new Decimal(sellAmt).mul(new Decimal(sellPx)), new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE)).toFixed(
    spec.quotePrecision,
  );
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
    { maxQuotePerOrder: sellQuoteCapForPrecheck },
  );
  if (!pre.valid) {
    await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", pre.error ?? "precheck sell", {
      cycleId: cycle.id,
      checks: pre.checks as unknown as Prisma.InputJsonValue,
    });
    return;
  }

  const sellQuoteEst = new Decimal(pre.flooredAmount).mul(new Decimal(pre.flooredPrice));
  const sellQuoteCap = Decimal.min(sellQuoteEst, new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE)).toFixed(spec.quotePrecision);

  if (!buyFilledEventSent.has(cycle.id)) {
    buyFilledEventSent.add(cycle.id);
    if (buyFilledEventSent.size > 200) buyFilledEventSent.clear();
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_FILLED_DETECTED", `compra filled; preparar venda ${cycle.id}`, {
      cycleId: cycle.id,
      orderId: buy.id,
    });
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

async function tryOpenBuyCycle(
  env: Env,
  log: FastifyBaseLogger,
  cfg: Awaited<ReturnType<ReturnType<typeof getRuntimeStateService>["getBotConfigRow"]>>,
  market: string,
): Promise<void> {
  const rt = getRuntimeStateService();
  const ticker = await getMarketDataService().getTickerWithFetchMeta(market);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(market);

  const last = ticker.snap.last;
  /** Mesma regra que o simulador: limite de compra a `grid_step_pct` abaixo do último (ex.: 0.05 = 5%). */
  const limitPx = gridBuyLimitBelowLast(last, cfg.gridStepPct.toString(), spec);
  const quoteBudget = effectiveAutoLiveQuoteBudget(env);
  const btcAmt = btcAmountForQuoteSpend(quoteBudget, limitPx, spec);
  validateOrderAgainstMarketSpec(btcAmt, limitPx, spec);

  const perms = await rt.getPermissions();
  const pre = await runLivePlacePrecheck(
    env,
    log,
    perms,
    {
      market,
      side: "BUY",
      amount: btcAmt,
      price: limitPx,
    },
    { maxQuotePerOrder: quoteBudget },
  );
  if (!pre.valid) {
    await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", pre.error ?? "precheck buy", {
      checks: pre.checks as unknown as Prisma.InputJsonValue,
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "precheck BUY falhou", {});
    return;
  }

  if (!perms.canPlaceBuyOrders) {
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "runtime não permite compra", {});
    return;
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
        quoteBudget,
        quoteSpent: "0",
        baseFilled: "0",
        isLiveAutoWorker: true,
      },
    });
  });

  if (!cycle) {
    await appendBotEvent("WARN", "LIVE_CYCLE_SIGNAL_REJECTED", "race ou ciclo bloqueado ao criar BUY", { market });
    return;
  }

  const buyClient = `LIVE_AUTO_BUY_${cycle.id}`;
  const dup = await prisma.order.findUnique({ where: { clientId: buyClient } });
  if (dup) {
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { buyOrderId: dup.id, status: CycleStatus.BUY_PLACED },
    });
    return;
  }

  await appendBotEvent("INFO", "LIVE_CYCLE_CREATED", `ciclo LIVE auto ${cycle.id}`, { cycleId: cycle.id });
  await appendBotEvent("INFO", "LIVE_CYCLE_SIGNAL_CREATED", "sinal BUY Auto LIVE aceito", { cycleId: cycle.id, market });
  await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACING", `BUY limit ciclo ${cycle.id}`, { cycleId: cycle.id });

  try {
    const placed = await getOrderManager().placeLimitOrder({
      cycleId: cycle.id,
      market,
      side: "BUY",
      amount: pre.flooredAmount,
      price: pre.flooredPrice,
      clientId: buyClient,
      liveMaxQuoteOverride: quoteBudget,
    });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: {
        buyOrderId: placed.orderId,
        status: CycleStatus.BUY_PLACED,
      },
    });
    await appendBotEvent("INFO", "LIVE_CYCLE_BUY_PLACED", `compra LIVE ${placed.exchangeOrderId}`, {
      cycleId: cycle.id,
      orderId: placed.orderId,
    });
    log.info({ cycleId: cycle.id, orderId: placed.orderId }, "live auto buy placed");
  } catch (e) {
    const msg = String((e as Error).message);
    await appendBotEvent("ERROR", "LIVE_CYCLE_ERROR", msg, { cycleId: cycle.id, phase: "buy" });
    await prisma.tradeCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.MANUAL_REVIEW },
    });
    await appendBotEvent("WARN", "LIVE_CYCLE_MANUAL_REVIEW", `falha BUY LIVE ${cycle.id}`, { cycleId: cycle.id });
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
    const autoMarket = autoLiveMarket(env, cfg.market);
    const recon = getLiveReconciliationSummary();

    let gate = true;
    gate = push("enable_auto_live_worker", true) && gate;
    gate = push("enable_live_trading", env.ENABLE_LIVE_TRADING, env.ENABLE_LIVE_TRADING ? undefined : "false") && gate;
    gate = push(
      "auto_live_confirm_env",
      env.AUTO_LIVE_CONFIRM_ENV === AUTO_LIVE_CONFIRM_REQUIRED_PHRASE,
      env.AUTO_LIVE_CONFIRM_ENV ? "set" : "empty",
    ) && gate;
    gate = push(
      "portfolio_balance_coinex",
      env.PORTFOLIO_BALANCE_SOURCE === "COINEX" || env.PORTFOLIO_BALANCE_SOURCE === "BOTH",
      env.PORTFOLIO_BALANCE_SOURCE,
    ) && gate;
    gate = push("runtime_running", perms.runtimeStatus === "RUNNING", perms.runtimeStatus) && gate;
    gate = push("kill_switch_off", perms.runtimeStatus !== "KILL_SWITCH") && gate;
    gate = push("execution_mode_live", perms.executionModeDb === "LIVE", perms.executionModeDb) && gate;
    gate = push("execution_layer_live", perms.executionLayer === "LIVE", perms.executionLayer) && gate;
    gate = push("market_data_coinex", env.MARKET_DATA_SOURCE === "COINEX") && gate;
    gate = push("coinex_keys", Boolean(env.COINEX_ACCESS_ID && env.COINEX_SECRET_KEY)) && gate;
    const allow = parseLiveMarketAllowlist(env);
    gate = push("live_market_allowlist", allow.includes(autoMarket), autoMarket) && gate;

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

    if (await hasStaleLiveOpenOrders(env)) {
      checks.push({ name: "live_orders_fresh", ok: false, message: "ordem LIVE aberta desatualizada (recon)" });
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "stale_live_orders"),
      });
      if (shouldEmitBlockedEvent(nowMs, "stale_orders")) {
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "ordens LIVE abertas sem sync recente", {});
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    if (await hasRecentBalanceDriftEvent(env)) {
      checks.push({ name: "balance_drift_recent", ok: false, message: "BALANCE_DRIFT_DETECTED recente" });
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "balance_drift"),
      });
      if (shouldEmitBlockedEvent(nowMs, "balance_drift")) {
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "drift de saldo recente", {});
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    if (await hasManualReviewLiveAutoCycle()) {
      checks.push({ name: "manual_review_open", ok: false, message: "ciclo Auto LIVE em MANUAL_REVIEW" });
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "manual_review_required"),
      });
      if (shouldEmitBlockedEvent(nowMs, "manual_review")) {
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "manual_review_required", {});
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    const { spec, fetchedAtMs } = await getMarketSpecService().getSpecWithFetchedAt(autoMarket);
    const specAge = Date.now() - fetchedAtMs;
    const specOk = spec.source === "COINEX" && specAge <= env.LIVE_MARKET_SPEC_MAX_AGE_MS;
    gate = push("market_spec_coinex_fresh", specOk, `${spec.source} age=${specAge}ms`) && gate;
    gate = push("api_trading_enabled", spec.apiTradingEnabled) && gate;
    gate = push("trading_enabled", spec.tradingEnabled) && gate;

    const ticker = await getMarketDataService().getTickerWithFetchMeta(autoMarket);
    const tickAge = Date.now() - ticker.fetchedAtMs;
    const tickOk = ticker.snap.priceSource === "COINEX" && tickAge <= env.LIVE_MARKET_DATA_MAX_AGE_MS;
    gate = push("ticker_coinex_fresh", tickOk, `source=${ticker.snap.priceSource} age=${tickAge}`) && gate;

    const bal = await getSpotBalancesForLiveGuard(env, log, env.LIVE_BALANCE_MAX_AGE_MS);
    const quoteCcy = spec.quoteCurrency.toUpperCase();
    const quoteBal = bal.balances.find((b) => b.asset.toUpperCase() === quoteCcy);
    const quoteAvail = quoteBal?.available ?? "0";
    gate =
      push(
        "min_quote_balance",
        hasMinQuoteBalance(quoteAvail, cfg.minQuoteBalance.toString()),
        `avail=${quoteAvail} ${quoteCcy} min=${cfg.minQuoteBalance}`,
      ) && gate;

    if (!gate) {
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "market_or_balance"),
      });
      if (shouldEmitBlockedEvent(nowMs, checks.filter((c) => !c.ok).map((c) => c.name).join(","))) {
        await appendBotEvent("WARN", "LIVE_CYCLE_PRECHECK_FAILED", "spec/ticker/saldo", {
          checks: checks as unknown as Prisma.InputJsonValue,
        });
        await appendBotEvent("WARN", "LIVE_CYCLE_WORKER_BLOCKED", "mercado/saldo/spec", {
          checks: checks as unknown as Prisma.InputJsonValue,
        });
      }
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
    }

    await handleStuckWaiting(log);
    await emitOutcomeEventsOnce();

    await tryPlaceSellForCycle(env, log, autoMarket, cfg.targetProfitPct.toString(), cfg.feeBufferPct.toString(), spec);

    const blocking = buyBlockingStatuses(env);
    const blockingCount = await countLiveAutoCycles(autoMarket, blocking);
    if (blockingCount > 0) {
      checks.push({
        name: "no_blocking_live_cycle",
        ok: false,
        message: `${blockingCount} ciclo(s) bloqueiam nova compra`,
      });
      setLiveCycleSummaryPatch({
        status: "RUNNING",
        enabledByEnv: true,
        checks,
        lastDecision: "wait_open_cycle",
      });
      recordLiveCycleSuccess();
      await finish("RUNNING");
      return;
    }

    const activeAuto = await countLiveAutoActive(autoMarket);
    if (!canOpenAnotherCycle(activeAuto, env.AUTO_LIVE_MAX_OPEN_CYCLES)) {
      checks.push({
        name: "max_open_live_auto_cycles",
        ok: false,
        message: `${activeAuto}/${env.AUTO_LIVE_MAX_OPEN_CYCLES}`,
      });
      setLiveCycleSummaryPatch({
        status: "BLOCKED",
        enabledByEnv: true,
        checks,
        lastDecision: summarizeBlockedChecks(checks, "max_cycles"),
      });
      recordLiveCycleSuccess();
      await finish("BLOCKED");
      return;
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
        checks.push({
          name: "cooldown",
          ok: false,
          message: `${elapsed}ms < ${env.AUTO_LIVE_COOLDOWN_MS}ms`,
        });
        setLiveCycleSummaryPatch({
          status: "RUNNING",
          enabledByEnv: true,
          checks,
          lastDecision: "cooldown",
        });
        recordLiveCycleSuccess();
        await finish("RUNNING");
        return;
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

    await tryOpenBuyCycle(env, log, cfg, autoMarket);

    setLiveCycleSummaryPatch({
      status: "RUNNING",
      enabledByEnv: true,
      checks,
      lastDecision: "opened_or_attempted_buy",
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
