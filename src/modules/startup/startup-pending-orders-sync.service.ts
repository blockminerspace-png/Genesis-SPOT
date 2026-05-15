import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { CycleStatus, OrderSide, OrderStatus, OrderType } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { coinexSignedGet } from "../../infrastructure/coinex/coinex-signed-get.js";
import { Decimal } from "../../shared/decimal.js";
import { invalidateLiveBalanceCache } from "../orders/live-coinex-balance-snapshot.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";

type CoinexPendingRow = Record<string, unknown>;

/**
 * CoinEx v2 — ordens não preenchidas (assinado).
 * @see https://docs.coinex.com/api/v2/spot/order/http/list-pending-order
 */
export async function fetchCoinexSpotPendingOrders(
  env: Env,
  log: FastifyBaseLogger,
  market: string,
): Promise<CoinexPendingRow[]> {
  const query: Record<string, string | number> = {
    market_type: "SPOT",
    market: market.toUpperCase(),
    limit: 100,
    page: 1,
  };
  const { httpStatus, envelope, rawText } = await coinexSignedGet<unknown>(env, "spot/pending-order", query);
  if (!envelope || envelope.code !== 0) {
    log.warn({ httpStatus, msg: envelope?.message, snippet: rawText.slice(0, 400) }, "CoinEx list-pending-order falhou");
    return [];
  }
  const data = envelope.data;
  return Array.isArray(data) ? (data as CoinexPendingRow[]) : [];
}

function mapOrderStatus(row: CoinexPendingRow): OrderStatus {
  const filled = new Decimal(String(row.filled_amount ?? "0"));
  const unfilled = new Decimal(String(row.unfilled_amount ?? row.amount ?? "0"));
  if (filled.gt(0) && unfilled.gt(0)) return OrderStatus.PARTIALLY_FILLED;
  return OrderStatus.OPEN;
}

async function importOnePendingRow(log: FastifyBaseLogger, row: CoinexPendingRow): Promise<boolean> {
  const orderIdRaw = row.order_id;
  if (orderIdRaw === undefined || orderIdRaw === null) return false;
  const exId = String(orderIdRaw).trim();
  if (!/^\d+$/.test(exId)) return false;

  const existing = await prisma.order.findFirst({ where: { exchangeOrderId: exId } });
  if (existing) return false;

  const market = String(row.market ?? "").replace(/\s+/g, "").toUpperCase();
  if (!market) return false;

  const sideStr = String(row.side ?? "buy").toLowerCase();
  const side = sideStr === "sell" ? OrderSide.SELL : OrderSide.BUY;

  const priceStr = String(row.price ?? "0");
  const amountStr = String(row.amount ?? "0");
  const filledStr = String(row.filled_amount ?? "0");
  const filledValStr = String(row.filled_value ?? "0");
  const baseFee = String(row.base_fee ?? "0");

  let clientId = String(row.client_id ?? "").trim();
  if (!clientId) {
    clientId = `LIVE_COINEX_IMPORT_${market}_${exId}`;
  } else if (await prisma.order.findUnique({ where: { clientId } })) {
    clientId = `LIVE_COINEX_IMPORT_${market}_${exId}`;
  }
  if (await prisma.order.findUnique({ where: { clientId } })) return false;

  let cycleId: string | null = null;
  let linkBuy = false;
  let linkSell = false;

  const rawClient = String(row.client_id ?? "").trim();
  const buyM = rawClient.match(/^LIVE_AUTO_BUY_([0-9a-fA-F-]{36})$/);
  const sellM = rawClient.match(/^LIVE_AUTO_SELL_([0-9a-fA-F-]{36})$/);
  if (buyM) {
    const c = await prisma.tradeCycle.findUnique({ where: { id: buyM[1] } });
    if (c) {
      cycleId = c.id;
      linkBuy = true;
    }
  } else if (sellM) {
    const c = await prisma.tradeCycle.findUnique({ where: { id: sellM[1] } });
    if (c) {
      cycleId = c.id;
      linkSell = true;
    }
  }

  if (!cycleId && side === OrderSide.BUY) {
    const orphan = await prisma.tradeCycle.findFirst({
      where: {
        market,
        isLiveAutoWorker: true,
        status: CycleStatus.WAITING_BUY_SIGNAL,
        buyOrderId: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (orphan) {
      cycleId = orphan.id;
      linkBuy = true;
    }
  }

  if (!cycleId && side === OrderSide.SELL) {
    const orphan = await prisma.tradeCycle.findFirst({
      where: {
        market,
        isLiveAutoWorker: true,
        status: CycleStatus.BUY_FILLED,
        sellOrderId: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (orphan) {
      cycleId = orphan.id;
      linkSell = true;
    }
  }

  const orderStatus = mapOrderStatus(row);

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          cycleId,
          exchangeOrderId: exId,
          clientId,
          market,
          side,
          type: OrderType.LIMIT,
          status: orderStatus,
          price: priceStr,
          amount: amountStr,
          filledAmount: filledStr,
          filledValue: filledValStr,
          fee: baseFee,
          rawResponse: row as unknown as Prisma.InputJsonValue,
        },
      });

      if (cycleId && linkBuy) {
        await tx.tradeCycle.update({
          where: { id: cycleId },
          data: {
            buyOrderId: order.id,
            status:
              orderStatus === OrderStatus.PARTIALLY_FILLED ? CycleStatus.BUY_PARTIALLY_FILLED : CycleStatus.BUY_PLACED,
          },
        });
      }
      if (cycleId && linkSell) {
        await tx.tradeCycle.update({
          where: { id: cycleId },
          data: {
            sellOrderId: order.id,
            status:
              orderStatus === OrderStatus.PARTIALLY_FILLED ? CycleStatus.SELL_PARTIALLY_FILLED : CycleStatus.SELL_PLACED,
          },
        });
      }
    });
  } catch (e) {
    log.warn({ err: e, exId, market }, "importação de ordem CoinEx ignorada");
    return false;
  }

  log.info({ exchangeOrderId: exId, market, clientId, cycleId }, "ordem CoinEx pendente importada ao arranque");
  return true;
}

/**
 * Uma vez ao arranque (antes do worker Auto LIVE): puxa ordens SPOT pendentes da CoinEx para a base,
 * para não ficar «cego» após restart (ordem na corretora sem linha em `orders`).
 */
export async function runStartupPendingOrderSync(env: Env, log: FastifyBaseLogger): Promise<void> {
  if (!env.ENABLE_LIVE_TRADING || !env.COINEX_ACCESS_ID || !env.COINEX_SECRET_KEY) {
    return;
  }

  const cfg = await prisma.botConfig.findFirst();
  const baseMarket = (cfg?.market ?? env.BOT_MARKET).toUpperCase();
  const markets = new Set<string>([baseMarket]);
  const autoM = (env.AUTO_LIVE_MARKET ?? "").trim().toUpperCase();
  if (autoM) markets.add(autoM);

  let total = 0;
  for (const market of markets) {
    const rows = await fetchCoinexSpotPendingOrders(env, log, market);
    for (const row of rows) {
      const ok = await importOnePendingRow(log, row);
      if (ok) total += 1;
    }
  }

  if (total > 0) {
    invalidateLiveBalanceCache();
    await appendBotEvent("INFO", "STARTUP_PENDING_ORDERS_IMPORTED", `${total} ordem(ns) pendente(s) CoinEx sincronizada(s) com a base`, {
      markets: [...markets],
    });
  }
}
