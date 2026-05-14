import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { Decimal } from "../../shared/decimal.js";
import { getOrderSummary, getRecentOrders } from "../../modules/orders/order.repository.js";
import { getOrderManager } from "../../modules/orders/order-manager.js";
import { getRuntimeStateService } from "../../modules/runtime/runtime-state.service.js";
import { runLivePlacePrecheck } from "../../modules/orders/live-safety/live-safety.guard.js";
import { ensureBotConfigFromEnv } from "../../modules/strategy/bot-config.service.js";

const decStr = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "número decimal inválido");

const orderPreviewSchema = z
  .object({
    market: z.string().min(3).max(32),
    side: z.enum(["BUY", "SELL"]),
    amount: decStr,
    price: decStr,
  })
  .strict();

const liveTestSchema = z
  .object({
    market: z.string().min(3).max(32),
    side: z.enum(["BUY", "SELL"]),
    amount: decStr,
    price: decStr,
    confirm: z.literal("LIVE_TEST_ORDER"),
  })
  .strict();

export async function ordersRoutes(app: FastifyInstance, env: Env) {
  app.get("/summary", async (_request, reply) => {
    const summary = await getOrderSummary();
    return reply.send(summary);
  });

  app.get("/recent", async (_request, reply) => {
    const items = await getRecentOrders();
    return reply.send({ items });
  });

  app.post("/preview", async (request, reply) => {
    const parsed = orderPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido", details: parsed.error.flatten() });
    }
    await ensureBotConfigFromEnv(env);
    const p = await getRuntimeStateService().getPermissions();
    const pre = await runLivePlacePrecheck(env, app.log, p, {
      market: parsed.data.market,
      side: parsed.data.side,
      amount: parsed.data.amount,
      price: parsed.data.price,
    });
    const m = parsed.data.market.toUpperCase();
    return reply.send({
      wouldPlaceLiveOrder: pre.valid && env.ENABLE_LIVE_TRADING && p.executionLayer === "LIVE",
      executionLayer: p.executionLayer,
      runtimeStatus: p.runtimeStatus,
      enableLiveTrading: env.ENABLE_LIVE_TRADING,
      market: m,
      side: parsed.data.side,
      inputPrice: parsed.data.price,
      inputAmount: parsed.data.amount,
      flooredPrice: pre.flooredPrice || null,
      flooredAmount: pre.flooredAmount || null,
      quoteValue: pre.quoteValue || null,
      valid: pre.valid,
      checks: pre.checks,
      error: pre.error ?? null,
    });
  });

  app.post("/live-test", async (request, reply) => {
    const parsed = liveTestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido", details: parsed.error.flatten() });
    }
    const cap = Decimal.min(new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE), new Decimal(env.LIVE_TEST_MAX_QUOTE_VALUE)).toFixed();
    const clientId = `LIVETEST_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    try {
      const placed = await getOrderManager().placeLimitOrder({
        cycleId: null,
        market: parsed.data.market,
        side: parsed.data.side,
        amount: parsed.data.amount,
        price: parsed.data.price,
        clientId,
        liveMaxQuoteOverride: cap,
      });
      return reply.send({ ok: true, placed });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: msg });
    }
  });
}
