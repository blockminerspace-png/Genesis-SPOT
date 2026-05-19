import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { readBtcDropConfig } from "../../modules/strategy/btc-drop.types.js";
import {
  getBotSpotChart,
  getBotSpotState,
  listBotSpotCycles,
  listBotSpotOrders,
  pauseBotSpot,
  resumeBotSpot,
  runBotSpotReconcile,
} from "../../modules/bot-spot/bot-spot.service.js";
import { chartIntervalSchema } from "../../modules/bot-spot/bot-spot.types.js";

const marketQuery = z.object({
  market: z.string().min(4).max(32).optional(),
});

const chartQuery = z.object({
  market: z.string().min(4).max(32).optional(),
  interval: chartIntervalSchema.default("15m"),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

export async function botSpotRoutes(app: FastifyInstance, env: Env) {
  const defaultMarket = () => readBtcDropConfig(env).market.toUpperCase();

  app.get("/state", async (_req, reply) => {
    const state = await getBotSpotState(env);
    return reply.send(state);
  });

  app.get("/chart", async (req, reply) => {
    const q = chartQuery.parse(req.query);
    const market = (q.market ?? defaultMarket()).toUpperCase();
    const toMs = q.to ?? Date.now();
    const fromMs = q.from ?? toMs - 7 * 24 * 60 * 60 * 1000;
    const chart = await getBotSpotChart(env, {
      market,
      interval: q.interval,
      fromMs,
      toMs,
    });
    return reply.send(chart);
  });

  app.get("/cycles", async (req, reply) => {
    const q = marketQuery.parse(req.query);
    const market = (q.market ?? defaultMarket()).toUpperCase();
    return reply.send({ market, cycles: await listBotSpotCycles(market) });
  });

  app.get("/orders", async (req, reply) => {
    const q = marketQuery.parse(req.query);
    const market = (q.market ?? defaultMarket()).toUpperCase();
    return reply.send({ market, orders: await listBotSpotOrders(market) });
  });

  app.get("/events", async (req, reply) => {
    const q = marketQuery.parse(req.query);
    const market = (q.market ?? defaultMarket()).toUpperCase();
    const fromRaw = z.coerce.number().int().positive().optional().parse((req.query as { from?: string }).from);
    const { prisma } = await import("../../infrastructure/database/prisma.js");
    const rows = await prisma.botEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      ...(fromRaw ? { where: { createdAt: { gte: new Date(fromRaw) } } } : {}),
    });
    return reply.send({
      market,
      events: rows.map((e) => ({
        id: e.id,
        level: e.level,
        type: e.type,
        message: e.message,
        context: e.context,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  app.post("/reconcile", async (_req, reply) => {
    const market = defaultMarket();
    const result = await runBotSpotReconcile(env, app.log, market);
    return reply.send(result);
  });

  app.post("/pause", async (_req, reply) => {
    const state = await pauseBotSpot(env);
    return reply.send(state);
  });

  app.post("/resume", async (_req, reply) => {
    const state = await resumeBotSpot(env);
    return reply.send(state);
  });
}
