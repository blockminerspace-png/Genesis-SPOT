import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { OrderSide, OrderStatus, OrderType } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma.js";
import { appendBotEvent } from "../../strategy/bot-control.service.js";
import type { OrderExecutor } from "./order-executor.interface.js";
import type { CancelOrderInput, PlaceLimitOrderInput, PlacedOrder } from "../../runtime/runtime-state.types.js";
import { Decimal } from "../../../shared/decimal.js";
import { getMarketSpecService } from "../../market-data/market-spec.service.js";
import { assertValidOrderAmount, floorBaseAmount, floorPrice } from "../../market-data/market-spec.rounding.js";
import { OrderRejectedMinValueError } from "../../market-data/market-spec.types.js";

export class SimulatedOrderExecutor implements OrderExecutor {
  constructor(private readonly log: FastifyBaseLogger) {}

  async placeLimitOrder(input: PlaceLimitOrderInput): Promise<PlacedOrder> {
    const spec = await getMarketSpecService().getSpec(input.market);

    const a0 = new Decimal(input.amount);
    const p0 = new Decimal(input.price);
    const aFlo = floorBaseAmount(a0, spec);
    const pFlo = floorPrice(p0, spec);
    const amount = aFlo.toFixed(spec.basePrecision);
    const price = pFlo.toFixed(spec.quotePrecision);

    if (!aFlo.eq(a0) || !pFlo.eq(p0)) {
      await appendBotEvent("INFO", "ORDER_AMOUNT_FLOORED", "Quantidade e/ou preço ajustados (floor)", {
        clientId: input.clientId,
        market: input.market,
        before: { amount: input.amount, price: input.price },
        after: { amount, price },
      });
    }

    try {
      assertValidOrderAmount(new Decimal(amount), new Decimal(price), spec);
    } catch (err) {
      const typ =
        err instanceof OrderRejectedMinValueError
          ? "ORDER_REJECTED_MIN_VALUE"
          : "ORDER_REJECTED_MIN_AMOUNT";
      await appendBotEvent("WARN", typ, String((err as Error).message), {
        clientId: input.clientId,
        market: input.market,
        amount,
        price,
      });
      throw err;
    }

    const side = input.side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
    const exchangeOrderId = `sim-${randomUUID()}`;

    const order = await prisma.order.create({
      data: {
        cycleId: input.cycleId ?? undefined,
        exchangeOrderId,
        clientId: input.clientId,
        market: input.market,
        side,
        type: OrderType.LIMIT,
        status: OrderStatus.OPEN,
        price,
        amount,
        filledAmount: "0",
        filledValue: "0",
        fee: "0",
        rawResponse: { simulated: true, marketSpecSource: spec.source },
      },
    });

    await appendBotEvent("INFO", "SIMULATED_ORDER_PLACED", `${input.side} limit @ ${price}`, {
      orderId: order.id,
      clientId: input.clientId,
    });

    this.log.info(
      { op: "simulated.placeLimitOrder", orderId: order.id, side: input.side },
      "simulated limit order created",
    );

    return {
      exchangeOrderId,
      orderId: order.id,
      mode: "simulated",
      raw: { order },
    };
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    await appendBotEvent("INFO", "SIMULATED_ORDER_CANCEL", `cancel ${input.exchangeOrderId}`, {
      market: input.market,
    });
    this.log.info({ op: "simulated.cancelOrder", exchangeOrderId: input.exchangeOrderId }, "stub cancel");
  }
}
