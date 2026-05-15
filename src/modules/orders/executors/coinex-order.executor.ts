import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { OrderSide, OrderStatus, OrderType } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma.js";
import { coinexSignedPost } from "../../../infrastructure/coinex/coinex-signed-post.js";
import type { Env } from "../../../config/env.js";
import { Decimal } from "../../../shared/decimal.js";
import { appendBotEvent } from "../../strategy/bot-control.service.js";
import { getRuntimeStateService } from "../../runtime/runtime-state.service.js";
import type { OrderExecutor } from "./order-executor.interface.js";
import type {
  CancelOrderInput,
  PlaceLimitOrderInput,
  PlaceMarketBuyInput,
  PlacedOrder,
} from "../../runtime/runtime-state.types.js";
import { runLivePlacePrecheck } from "../live-safety/live-safety.guard.js";
import {
  buildCancelOrderBody,
  extractOrderIdFromPlaceResponse,
  mapPlaceLimitFromInput,
  mapPlaceMarketBuyFromInput,
} from "./coinex-order.mapper.js";
import { recordLiveQuoteNotional } from "../live-daily-quote-volume.js";
import { floorPrice } from "../../market-data/market-spec.rounding.js";
import { pickPrimaryFeeFromSnapshot } from "../../reconciliation/cycle-live-sync.js";

function parseCoinexSpotPlaceFillState(
  data: unknown,
  quotePrecision: number,
): {
  filledAmount: string;
  filledValue: string;
  unfilledAmount: string;
  status: OrderStatus;
  rawAvgPrice: string;
} {
  const o = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const filledAmount = String(o.filled_amount ?? "0");
  const filledValue = String(o.filled_value ?? "0");
  const unfilledAmount = String(o.unfilled_amount ?? "0");
  const lastPx = String(o.last_filled_price ?? o.last_fill_price ?? "");
  let rawAvgPrice = lastPx;
  try {
    const fa = new Decimal(filledAmount);
    const fv = new Decimal(filledValue);
    if (fa.gt(0) && fv.gt(0)) {
      rawAvgPrice = fv.div(fa).toDecimalPlaces(Math.min(18, quotePrecision + 8), Decimal.ROUND_HALF_UP).toFixed();
    }
  } catch {
    /* keep lastPx */
  }
  const u = new Decimal(unfilledAmount);
  const f = new Decimal(filledAmount);
  let status: OrderStatus;
  if (u.lte(0) && f.gt(0)) status = OrderStatus.FILLED;
  else if (f.gt(0) && u.gt(0)) status = OrderStatus.PARTIALLY_FILLED;
  else status = OrderStatus.OPEN;

  return { filledAmount, filledValue, unfilledAmount, status, rawAvgPrice };
}

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

  async placeMarketBuy(input: PlaceMarketBuyInput): Promise<PlacedOrder> {
    const p = await getRuntimeStateService().getPermissions();
    const pre = await runLivePlacePrecheck(
      this.env,
      this.log,
      p,
      {
        market: input.market,
        side: "BUY",
        amount: input.baseAmount,
        price: input.referencePrice,
      },
      {
        maxQuotePerOrder: input.liveMaxQuoteOverride,
        skipMakerOnlyHint: true,
      },
    );
    if (!pre.valid || !pre.spec) {
      await appendBotEvent("WARN", "LIVE_ORDER_PRECHECK_FAILED", pre.error ?? "precheck market buy", {
        clientId: input.clientId,
        market: input.market,
        checks: pre.checks,
      });
      throw new Error(pre.error ?? "LIVE precheck mercado falhou");
    }

    const spec = pre.spec;
    const body = mapPlaceMarketBuyFromInput(input, pre.flooredAmount, spec.baseCurrency);

    await appendBotEvent("INFO", "LIVE_ORDER_PLACING", `BUY market ${input.market}`, {
      clientId: input.clientId,
      amount: pre.flooredAmount,
      ccy: spec.baseCurrency,
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

    const fill = parseCoinexSpotPlaceFillState(envelope.data, spec.quotePrecision);
    const pxSrc = new Decimal(fill.rawAvgPrice).gt(0) ? fill.rawAvgPrice : input.referencePrice;
    const priceStr = floorPrice(new Decimal(pxSrc), spec).toFixed(spec.quotePrecision);

    const raw = envelope.data as Record<string, unknown>;
    const baseFee = String(raw.base_fee ?? "0");
    const quoteFee = String(raw.quote_fee ?? "0");
    const { fee: feeStr, feeCurrency } = pickPrimaryFeeFromSnapshot(input.market, baseFee, quoteFee);

    const order = await prisma.order.create({
      data: {
        cycleId: input.cycleId ?? undefined,
        exchangeOrderId: oid,
        clientId: input.clientId,
        market: input.market.toUpperCase(),
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        status: fill.status,
        price: priceStr,
        amount: pre.flooredAmount,
        filledAmount: fill.filledAmount,
        filledValue: fill.filledValue,
        fee: feeStr,
        feeCurrency,
        rawResponse: envelope.data as unknown as Prisma.InputJsonValue,
      },
    });

    await appendBotEvent("INFO", "LIVE_ORDER_PLACED", `Ordem LIVE mercado ${oid}`, {
      orderId: order.id,
      clientId: input.clientId,
      exchangeOrderId: oid,
    });

    this.log.info({ op: "coinex.placeMarketBuy", orderId: order.id, exchangeOrderId: oid }, "live market buy placed");

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
