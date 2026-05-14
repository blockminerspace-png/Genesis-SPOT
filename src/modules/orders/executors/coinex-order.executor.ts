import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { OrderSide, OrderStatus, OrderType } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma.js";
import { coinexSignedPost } from "../../../infrastructure/coinex/coinex-signed-post.js";
import type { Env } from "../../../config/env.js";
import { appendBotEvent } from "../../strategy/bot-control.service.js";
import { getRuntimeStateService } from "../../runtime/runtime-state.service.js";
import type { OrderExecutor } from "./order-executor.interface.js";
import type { CancelOrderInput, PlaceLimitOrderInput, PlacedOrder } from "../../runtime/runtime-state.types.js";
import { runLivePlacePrecheck } from "../live-safety/live-safety.guard.js";
import {
  buildCancelOrderBody,
  extractOrderIdFromPlaceResponse,
  mapPlaceLimitFromInput,
} from "./coinex-order.mapper.js";
import { recordLiveQuoteNotional } from "../live-daily-quote-volume.js";

export class CoinexOrderExecutor implements OrderExecutor {
  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  async placeLimitOrder(input: PlaceLimitOrderInput): Promise<PlacedOrder> {
    const p = await getRuntimeStateService().getPermissions();
    const pre = await runLivePlacePrecheck(
      this.env,
      this.log,
      p,
      {
        market: input.market,
        side: input.side,
        amount: input.amount,
        price: input.price,
      },
      input.liveMaxQuoteOverride ? { maxQuotePerOrder: input.liveMaxQuoteOverride } : undefined,
    );
    if (!pre.valid) {
      await appendBotEvent("WARN", "LIVE_ORDER_PRECHECK_FAILED", pre.error ?? "precheck", {
        clientId: input.clientId,
        market: input.market,
        checks: pre.checks,
      });
      throw new Error(pre.error ?? "LIVE precheck falhou");
    }

    const body = mapPlaceLimitFromInput(input, pre.flooredAmount, pre.flooredPrice);

    await appendBotEvent("INFO", "LIVE_ORDER_PLACING", `${input.side} ${input.market}`, {
      clientId: input.clientId,
      amount: pre.flooredAmount,
      price: pre.flooredPrice,
    });

    const { httpStatus, envelope, rawText } = await coinexSignedPost<Record<string, unknown>>(
      this.env,
      "/v2/spot/order",
      "spot/order",
      body,
    );

    if (!envelope || envelope.code !== 0) {
      const msg = envelope?.message ?? rawText.slice(0, 200) ?? `HTTP ${httpStatus}`;
      await appendBotEvent("ERROR", "LIVE_ORDER_REJECTED", msg, {
        clientId: input.clientId,
        code: envelope?.code,
        httpStatus,
      });
      throw new Error(msg);
    }

    const oid = extractOrderIdFromPlaceResponse(envelope.data);
    if (!oid) {
      await appendBotEvent("ERROR", "LIVE_ORDER_ERROR", "resposta sem order_id", {
        data: envelope.data as unknown as Prisma.InputJsonValue,
      });
      throw new Error("CoinEx: resposta sem order_id");
    }

    recordLiveQuoteNotional(pre.quoteValue);

    const side = input.side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
    const order = await prisma.order.create({
      data: {
        cycleId: input.cycleId ?? undefined,
        exchangeOrderId: oid,
        clientId: input.clientId,
        market: input.market.toUpperCase(),
        side,
        type: OrderType.LIMIT,
        status: OrderStatus.OPEN,
        price: pre.flooredPrice,
        amount: pre.flooredAmount,
        filledAmount: "0",
        filledValue: "0",
        fee: "0",
        rawResponse: envelope.data as unknown as Prisma.InputJsonValue,
      },
    });

    await appendBotEvent("INFO", "LIVE_ORDER_PLACED", `Ordem LIVE ${oid}`, {
      orderId: order.id,
      clientId: input.clientId,
      exchangeOrderId: oid,
    });

    this.log.info({ op: "coinex.placeLimitOrder", orderId: order.id, exchangeOrderId: oid }, "live limit placed");

    return {
      exchangeOrderId: oid,
      orderId: order.id,
      mode: "live",
      raw: envelope.data,
    };
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    await appendBotEvent("INFO", "LIVE_ORDER_CANCEL_REQUESTED", `cancel ${input.exchangeOrderId}`, {
      market: input.market,
    });
    let body: Record<string, unknown>;
    try {
      body = buildCancelOrderBody(input.market, input.exchangeOrderId);
    } catch (e) {
      await appendBotEvent("ERROR", "LIVE_ORDER_ERROR", String((e as Error).message), {});
      throw e;
    }

    const { httpStatus, envelope, rawText } = await coinexSignedPost<Record<string, unknown>>(
      this.env,
      "/v2/spot/cancel-order",
      "spot/cancel-order",
      body,
    );

    if (!envelope || envelope.code !== 0) {
      const msg = envelope?.message ?? rawText.slice(0, 200) ?? `HTTP ${httpStatus}`;
      await appendBotEvent("ERROR", "LIVE_ORDER_ERROR", msg, { httpStatus, code: envelope?.code });
      throw new Error(msg);
    }

    await appendBotEvent("INFO", "LIVE_ORDER_CANCELLED", `cancelled ${input.exchangeOrderId}`, {
      market: input.market,
    });
    await prisma.order.updateMany({
      where: { exchangeOrderId: input.exchangeOrderId },
      data: { status: OrderStatus.CANCELLED },
    });
    this.log.info({ op: "coinex.cancelOrder", exchangeOrderId: input.exchangeOrderId }, "live cancel ok");
  }
}
