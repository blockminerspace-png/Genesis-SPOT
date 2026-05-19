import type { FastifyBaseLogger } from "fastify";
import { CycleStatus, OrderSide, OrderStatus, type Prisma } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { Decimal } from "../../shared/decimal.js";
import { floorBaseAmount, floorPrice } from "../market-data/market-spec.rounding.js";
import { getMarketDataService } from "../market-data/market-data.service.js";
import { getMarketSpecService } from "../market-data/market-spec.service.js";
import { getOrderManager } from "../orders/order-manager.js";
import { runLivePlacePrecheck } from "../orders/live-safety/live-safety.guard.js";
import { fetchCoinexOrderStatus } from "../reconciliation/coinex-order-sync.service.js";
import { getRuntimeStateService } from "../runtime/runtime-state.service.js";
import { validateOrderAgainstMarketSpec } from "../risk/risk-manager.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { liveAutoOrderQuoteCap, targetSellFromEntry } from "../strategy/grid.strategy.js";

let startupLiveReviewDone = false;

function isLiveNumericExchangeId(exchangeOrderId: string | null): boolean {
  if (!exchangeOrderId) return false;
  if (exchangeOrderId.startsWith("sim-")) return false;
  return /^\d+$/.test(exchangeOrderId);
}

/**
 * Uma vez por arranque do processo: se LIVE+RUNNING e houver venda LIMIT aberta ligada a um ciclo
 * com alvo já atingido pelo último preço CoinEx, cancela e recoloca a venda ao preço atual (take-profit agressivo).
 * Caso contrário regista eventos de monitorização; compras abertas apenas ficam sob reconciliação.
 */
export async function runStartupLiveOpenSellReview(env: Env, log: FastifyBaseLogger): Promise<void> {
  if (startupLiveReviewDone) return;
  startupLiveReviewDone = true;

  if (!env.ENABLE_LIVE_TRADING || !env.COINEX_ACCESS_ID || !env.COINEX_SECRET_KEY) {
    log.debug("revisão LIVE ao arranque ignorada: trading ou chaves");
    return;
  }

  const rt = getRuntimeStateService();
  const perms = await rt.getPermissions();
  if (perms.executionLayer !== "LIVE" || perms.runtimeStatus !== "RUNNING") {
    await appendBotEvent("INFO", "STARTUP_LIVE_REVIEW_SKIPPED", "runtime não está LIVE+RUNNING", {
      layer: perms.executionLayer,
      runtimeStatus: perms.runtimeStatus,
    });
    return;
  }

  const cfg = await rt.getBotConfigRow();
  const market = cfg.market.toUpperCase();

  const ticker = await getMarketDataService().getTickerWithFetchMeta(market);
  if (ticker.snap.priceSource !== "COINEX" || !ticker.snap.last) {
    await appendBotEvent("WARN", "STARTUP_LIVE_REVIEW_SKIPPED", "ticker CoinEx indisponível", { market });
    return;
  }

  const last = new Decimal(ticker.snap.last);
  const { spec } = await getMarketSpecService().getSpecWithFetchedAt(market);

  const sellOrders = await prisma.order.findMany({
    where: {
      side: OrderSide.SELL,
      status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
      market,
      cycleId: { not: null },
      exchangeOrderId: { not: null },
    },
    include: { cycle: true },
  });

  for (const order of sellOrders) {
    const exId = order.exchangeOrderId;
    if (!exId || !isLiveNumericExchangeId(exId)) continue;
    const cycle = order.cycle;
    if (!cycle) continue;

    const targetStr =
      cycle.targetPrice?.toString() ??
      (cycle.entryPrice
        ? targetSellFromEntry(
            floorPrice(new Decimal(cycle.entryPrice.toString()), spec).toFixed(spec.quotePrecision),
            cfg.targetProfitPct.toString(),
            cfg.feeBufferPct.toString(),
            spec,
          )
        : null);

    if (!targetStr) {
      await appendBotEvent("INFO", "STARTUP_SELL_MONITORING", "venda aberta sem alvo calculável; reconciliação segue", {
        cycleId: cycle.id,
        orderId: order.id,
      });
      continue;
    }

    const targetPx = new Decimal(targetStr);
    if (last.lt(targetPx)) {
      await appendBotEvent("INFO", "STARTUP_SELL_MONITORING", "preço abaixo do alvo; manter ordem e monitorizar", {
        cycleId: cycle.id,
        orderId: order.id,
        last: last.toFixed(),
        alvo: targetPx.toFixed(),
      });
      continue;
    }

    const remote = await fetchCoinexOrderStatus(env, market, exId);
    if (!remote.ok) {
      await appendBotEvent("WARN", "STARTUP_SELL_REPRICE_SKIPPED", remote.message, {
        cycleId: cycle.id,
        orderId: order.id,
      });
      continue;
    }

    const snap = remote.snapshot;
    const unfilled = new Decimal(snap.unfilledAmount);
    if (unfilled.lte(0)) continue;

    const newPx = floorPrice(last, spec).toFixed(spec.quotePrecision);
    const sellAmt = floorBaseAmount(unfilled, spec).toFixed(spec.basePrecision);

    try {
      validateOrderAgainstMarketSpec(sellAmt, newPx, spec);
    } catch (e) {
      await appendBotEvent("WARN", "STARTUP_SELL_REPRICE_INVALID", String((e as Error).message), { cycleId: cycle.id });
      continue;
    }

    const perms2 = await rt.getPermissions();
    const sellQuoteEst = new Decimal(sellAmt).mul(new Decimal(newPx)).toFixed(spec.quotePrecision);
    const sellQuoteCapForPrecheck = liveAutoOrderQuoteCap(sellQuoteEst, env.LIVE_MAX_ORDER_QUOTE_VALUE, spec);
    const pre = await runLivePlacePrecheck(
      env,
      log,
      perms2,
      { market, side: "SELL", amount: sellAmt, price: newPx },
      { maxQuotePerOrder: sellQuoteCapForPrecheck },
    );
    if (!pre.valid) {
      await appendBotEvent("WARN", "STARTUP_SELL_REPRICE_PRECHECK", pre.error ?? "precheck", {
        cycleId: cycle.id,
        checks: pre.checks as unknown as Prisma.InputJsonValue,
      });
      continue;
    }

    const flooredAmt = pre.flooredAmount;
    const flooredPx = pre.flooredPrice;
    const sellQuoteCap = liveAutoOrderQuoteCap(
      new Decimal(flooredAmt).mul(new Decimal(flooredPx)).toFixed(spec.quotePrecision),
      env.LIVE_MAX_ORDER_QUOTE_VALUE,
      spec,
    );

    try {
      await appendBotEvent("INFO", "STARTUP_SELL_REPRICE", "preço ≥ alvo: cancelar venda e recolocar ao último", {
        cycleId: cycle.id,
        oldOrderId: order.id,
        exchangeOrderId: exId,
        last: last.toFixed(),
        alvo: targetPx.toFixed(),
        novoPreco: flooredPx,
      });
      await getOrderManager().cancelOrder({ market, exchangeOrderId: exId });
      const clientId = `STP_${order.id.replace(/-/g, "").slice(0, 10)}_${Date.now()}`;
      const placed = await getOrderManager().placeLimitOrder({
        cycleId: cycle.id,
        market,
        side: "SELL",
        amount: flooredAmt,
        price: flooredPx,
        clientId,
        liveMaxQuoteOverride: sellQuoteCap,
      });
      await prisma.tradeCycle.update({
        where: { id: cycle.id },
        data: {
          sellOrderId: placed.orderId,
          status: CycleStatus.SELL_PLACED,
          targetPrice: flooredPx,
        },
      });
      await appendBotEvent("INFO", "STARTUP_SELL_REPLACED", `nova ordem de venda ${placed.exchangeOrderId}`, {
        cycleId: cycle.id,
        orderId: placed.orderId,
      });
      log.info({ cycleId: cycle.id, exchangeOrderId: placed.exchangeOrderId }, "startup live sell repriced");
    } catch (e) {
      const msg = String((e as Error).message);
      await appendBotEvent("ERROR", "STARTUP_SELL_REPRICE_FAILED", msg, { cycleId: cycle.id, orderId: order.id });
      try {
        await prisma.tradeCycle.update({
          where: { id: cycle.id },
          data: { status: CycleStatus.MANUAL_REVIEW },
        });
      } catch {
        /* ignore */
      }
    }
  }

  const buyOpen = await prisma.order.count({
    where: {
      side: OrderSide.BUY,
      status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
      market,
      exchangeOrderId: { not: null },
    },
  });
  if (buyOpen > 0) {
    await appendBotEvent("INFO", "STARTUP_BUY_MONITORING", `${buyOpen} compra(s) aberta(s); reconciliação segue`, {
      market,
    });
  }
}
