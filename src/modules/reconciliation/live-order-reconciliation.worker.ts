import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { CycleStatus, OrderSide, OrderStatus } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { CoinexBalanceProvider } from "../portfolio/coinex-balance.provider.js";
import { Decimal } from "../../shared/decimal.js";
import type { LiveReconciliationSummary } from "./reconciliation.types.js";
import {
  deriveEffectiveLocalStatus,
  fetchCoinexOrderStatus,
} from "./coinex-order-sync.service.js";
import { fetchCoinexUserDealsForOrder, importCoinexDealsAsFills, sumLocalFillValues } from "./order-fill-sync.service.js";
import { pickPrimaryFeeFromSnapshot, syncLinkedCycleForLiveOrder } from "./cycle-live-sync.js";
import { computeLiveAutoSellTargetPrice } from "../live-cycle/live-sell-target.util.js";

const EPS_DRIFT = new Decimal("0.01");

function isLiveCoinexOrderId(exchangeOrderId: string | null): boolean {
  if (!exchangeOrderId) return false;
  if (exchangeOrderId.startsWith("sim-")) return false;
  return /^\d+$/.test(exchangeOrderId);
}

let timer: NodeJS.Timeout | undefined;

/** Snapshot estável USDC+USDT (disponível|bloqueado) — drift com ordens LIVE abertas. */
let lastStableQuoteSpotSnap: string | undefined;

function stableQuoteSpotFingerprint(balances: { asset: string; available: string; frozen: string }[]): string {
  const seg = (sym: string) => {
    const b = balances.find((x) => x.asset === sym);
    return `${sym}:${b?.available ?? "0"}|${b?.frozen ?? "0"}`;
  };
  return `${seg("USDC")};${seg("USDT")}`;
}

const defaultSummary = (): LiveReconciliationSummary => ({
  intervalMs: 10_000,
  lastTickAtMs: null,
  lastTickDurationMs: null,
  ordersScanned: 0,
  ordersSynced: 0,
  fillsImported: 0,
  lastError: null,
  fillSumDriftDetected: false,
  fillSumDriftDetail: null,
  lastHealthyTickCompletedAtMs: null,
  lastFillSumDriftAtMs: null,
  lastBalanceDriftAtMs: null,
});

let summary: LiveReconciliationSummary = defaultSummary();

export function getLiveReconciliationSummary(): LiveReconciliationSummary {
  return { ...summary };
}

export function stopLiveOrderReconciliationWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function startLiveOrderReconciliationWorker(env: Env, log: FastifyBaseLogger): void {
  if (timer) clearInterval(timer);
  summary = defaultSummary();
  summary.intervalMs = env.BOT_RECONCILIATION_INTERVAL_MS;

  const tick = () => {
    void runLiveOrderReconciliationTick(env, log).catch((err) => {
      const msg = String((err as Error).message);
      summary.lastError = msg;
      log.error({ err }, "live-order-reconciliation tick failed");
    });
  };

  timer = setInterval(tick, env.BOT_RECONCILIATION_INTERVAL_MS);
  tick();
  log.info({ intervalMs: env.BOT_RECONCILIATION_INTERVAL_MS }, "live order reconciliation worker started");
}

export async function runLiveOrderReconciliationTick(env: Env, log: FastifyBaseLogger): Promise<void> {
  const t0 = Date.now();
  const prov = new CoinexBalanceProvider(env);
  if (!prov.hasKeys()) {
    summary = {
      ...summary,
      lastTickAtMs: t0,
      lastTickDurationMs: 0,
      ordersScanned: 0,
      ordersSynced: 0,
      fillsImported: 0,
    };
    return;
  }

  const pending = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
      exchangeOrderId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
  });

  const livePending = pending.filter((o) => isLiveCoinexOrderId(o.exchangeOrderId));
  if (livePending.length === 0) {
    summary = {
      ...summary,
      lastTickAtMs: t0,
      lastTickDurationMs: Date.now() - t0,
      ordersScanned: 0,
      ordersSynced: 0,
      fillsImported: 0,
      fillSumDriftDetected: false,
      fillSumDriftDetail: null,
      lastError: null,
      lastHealthyTickCompletedAtMs: Date.now(),
    };
    return;
  }

  let synced = 0;
  let fillsTotal = 0;
  let drift = false;
  let driftDetail: string | null = null;
  summary.lastError = null;

  for (const order of livePending) {
    const exId = order.exchangeOrderId!;
    try {
      await appendBotEvent("INFO", "LIVE_ORDER_SYNC_STARTED", `sync ordem ${exId}`, {
        orderId: order.id,
        exchangeOrderId: exId,
        market: order.market,
      });

      const remote = await fetchCoinexOrderStatus(env, order.market, exId);

      if (!remote.ok && remote.reason === "not_found") {
        const hadFill = new Decimal(order.filledAmount.toString()).gt(0);
        if (!hadFill) {
          await prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: order.id },
              data: { status: OrderStatus.CANCELLED },
            });
            if (order.cycleId) {
              await syncLinkedCycleForLiveOrder(tx, {
                cycleId: order.cycleId,
                orderSide: order.side,
                market: order.market,
                nextOrderStatus: OrderStatus.CANCELLED,
                filledAmount: "0",
                filledValue: "0",
              });
            }
          });
          await appendBotEvent("WARN", "LIVE_ORDER_CANCELLED_EXTERNALLY", `ordem ${exId} ausente na CoinEx (0 fill)`, {
            orderId: order.id,
            exchangeOrderId: exId,
          });
          await appendBotEvent("INFO", "LIVE_ORDER_SYNCED", `ordem ${exId} reconciliada (externamente cancelada)`, {
            orderId: order.id,
            exchangeOrderId: exId,
            outcome: "cancelled_externally",
          });
          synced += 1;
        } else {
          const m = `order-status not_found mas DB tem fills (${exId})`;
          summary.lastError = m;
          await appendBotEvent("ERROR", "LIVE_ORDER_SYNC_ERROR", m, {
            orderId: order.id,
            exchangeOrderId: exId,
          });
          if (order.cycleId) {
            await prisma.tradeCycle.update({
              where: { id: order.cycleId },
              data: { status: CycleStatus.MANUAL_REVIEW },
            });
            await appendBotEvent("WARN", "CYCLE_RECONCILIATION_REQUIRED", `ciclo ${order.cycleId} — ordem remota inconsistente`, {
              cycleId: order.cycleId,
              orderId: order.id,
            });
          }
        }
        continue;
      }

      if (!remote.ok) {
        await appendBotEvent("ERROR", "LIVE_ORDER_SYNC_ERROR", remote.message, {
          orderId: order.id,
          exchangeOrderId: exId,
          coinexCode: remote.coinexCode,
        });
        summary.lastError = remote.message;
        continue;
      }

      const snap = remote.snapshot;
      const nextStatus = deriveEffectiveLocalStatus(snap);
      const prevStatus = order.status;

      const sinceMs = order.createdAt.getTime() - 60_000;
      let deals: Awaited<ReturnType<typeof fetchCoinexUserDealsForOrder>> = [];
      if (new Decimal(snap.filledAmount).gt(0)) {
        try {
          deals = await fetchCoinexUserDealsForOrder(env, order.market, snap.orderId, sinceMs);
        } catch (e) {
          const m = `user-deals: ${String((e as Error).message)}`;
          await appendBotEvent("ERROR", "LIVE_ORDER_SYNC_ERROR", m, {
            orderId: order.id,
            exchangeOrderId: exId,
          });
          summary.lastError = m;
          continue;
        }
      }

      const imported = await importCoinexDealsAsFills(order.id, deals);
      fillsTotal += imported;
      if (imported > 0) {
        await appendBotEvent("INFO", "LIVE_ORDER_FILL_IMPORTED", `${imported} fill(s) importados (${exId})`, {
          orderId: order.id,
          exchangeOrderId: exId,
          count: imported,
        });
      }

      const sumFills = await sumLocalFillValues(order.id);
      const remoteVal = new Decimal(snap.filledValue);
      if (remoteVal.gt(0) && sumFills.minus(remoteVal).abs().gt(EPS_DRIFT)) {
        drift = true;
        driftDetail = `order ${order.id}: Σ fills=${sumFills.toFixed()} vs CoinEx filled_value=${remoteVal.toFixed()}`;
        await appendBotEvent("WARN", "LIVE_ORDER_SYNC_ERROR", "Σ fills locais ≠ filled_value CoinEx", {
          orderId: order.id,
          exchangeOrderId: exId,
          sumFills: sumFills.toFixed(),
          remoteFilledValue: remoteVal.toFixed(),
        });
      }

      const feePick = pickPrimaryFeeFromSnapshot(order.market, snap.baseFee, snap.quoteFee);
      const prevRaw = (order.rawResponse as Record<string, unknown> | null) ?? {};
      const mergedRaw: Prisma.InputJsonValue = {
        ...prevRaw,
        lastCoinexReconciliation: {
          at: new Date().toISOString(),
          status: snap.status,
          snapshot: snap.raw,
        },
      } as unknown as Prisma.InputJsonValue;

      let sellTargetPrice: string | undefined;
      if (
        order.cycleId &&
        order.side === OrderSide.BUY &&
        (nextStatus === OrderStatus.FILLED || nextStatus === OrderStatus.PARTIALLY_FILLED) &&
        new Decimal(snap.filledAmount).gt(0)
      ) {
        const fa = new Decimal(snap.filledAmount);
        const fv = new Decimal(snap.filledValue);
        const avgEntry = fv.div(fa).toFixed(12);
        sellTargetPrice = await computeLiveAutoSellTargetPrice(order.market, avgEntry);
      }

      const { cycleNeedsReview } = await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: nextStatus,
            filledAmount: snap.filledAmount,
            filledValue: snap.filledValue,
            fee: feePick.fee,
            feeCurrency: feePick.feeCurrency,
            rawResponse: mergedRaw,
          },
        });

        if (!order.cycleId) {
          return { cycleNeedsReview: false };
        }
        return syncLinkedCycleForLiveOrder(tx, {
          cycleId: order.cycleId,
          orderSide: order.side,
          market: order.market,
          nextOrderStatus: nextStatus,
          filledAmount: snap.filledAmount,
          filledValue: snap.filledValue,
          sellTargetPrice,
        });
      });

      if (prevStatus !== nextStatus) {
        await appendBotEvent("INFO", "LIVE_ORDER_STATUS_CHANGED", `${prevStatus} → ${nextStatus}`, {
          orderId: order.id,
          exchangeOrderId: exId,
          from: prevStatus,
          to: nextStatus,
        });
      }

      if (nextStatus === OrderStatus.PARTIALLY_FILLED && prevStatus !== OrderStatus.PARTIALLY_FILLED) {
        await appendBotEvent("INFO", "LIVE_ORDER_PARTIALLY_FILLED", `ordem ${exId} parcial`, {
          orderId: order.id,
          filledAmount: snap.filledAmount,
        });
      }

      if (nextStatus === OrderStatus.FILLED && prevStatus !== OrderStatus.FILLED) {
        await appendBotEvent("INFO", "LIVE_ORDER_FILLED", `ordem ${exId} filled`, {
          orderId: order.id,
          exchangeOrderId: exId,
        });
      }

      if (cycleNeedsReview) {
        await appendBotEvent("WARN", "CYCLE_RECONCILIATION_REQUIRED", `ciclo ${order.cycleId} requer revisão`, {
          cycleId: order.cycleId,
          orderId: order.id,
        });
      }

      await appendBotEvent("INFO", "LIVE_ORDER_SYNCED", `ordem ${exId} ok`, {
        orderId: order.id,
        exchangeOrderId: exId,
        status: nextStatus,
        fillsImportedDelta: imported,
      });

      synced += 1;
    } catch (err) {
      const msg = String((err as Error).message);
      summary.lastError = msg;
      await appendBotEvent("ERROR", "LIVE_ORDER_SYNC_ERROR", msg, { orderId: order.id, exchangeOrderId: exId });
      log.warn({ err, orderId: order.id }, "live reconciliation order failed");
    }
  }

  /** Drift de saldo spot: snapshot atual vs tick anterior (heurística informativa). */
  let balanceDrift = false;
  try {
    const { balances } = await prov.fetchSpotBalances();
    const snap = stableQuoteSpotFingerprint(balances);
    if (lastStableQuoteSpotSnap !== undefined && lastStableQuoteSpotSnap !== snap && livePending.length > 0) {
      balanceDrift = true;
      await appendBotEvent("WARN", "BALANCE_DRIFT_DETECTED", "Saldo USDC/USDT spot mudou entre ticks com ordens LIVE abertas", {
        previous: lastStableQuoteSpotSnap,
        current: snap,
      });
    }
    lastStableQuoteSpotSnap = snap;
  } catch {
    /* ignore balance drift probe */
  }

  summary = {
    ...summary,
    lastTickAtMs: t0,
    lastTickDurationMs: Date.now() - t0,
    ordersScanned: livePending.length,
    ordersSynced: synced,
    fillsImported: fillsTotal,
    lastError: summary.lastError,
    fillSumDriftDetected: drift,
    fillSumDriftDetail: driftDetail,
    lastFillSumDriftAtMs: drift ? Date.now() : summary.lastFillSumDriftAtMs,
    lastBalanceDriftAtMs: balanceDrift ? Date.now() : summary.lastBalanceDriftAtMs,
    lastHealthyTickCompletedAtMs:
      !summary.lastError && !drift && !balanceDrift ? Date.now() : summary.lastHealthyTickCompletedAtMs,
  };

  if (balanceDrift) {
    summary.fillSumDriftDetected = summary.fillSumDriftDetected || balanceDrift;
    if (!summary.fillSumDriftDetail) {
      summary.fillSumDriftDetail = "Saldo USDC/USDT spot mudou (ver BALANCE_DRIFT_DETECTED nos eventos)";
    }
  }
}
