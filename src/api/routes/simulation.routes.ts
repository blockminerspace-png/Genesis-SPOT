import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendBotEvent } from "../../modules/strategy/bot-control.service.js";
import {
  getSimulationState,
  resetSimulationState,
  seedSimulationBalance,
  setForcedSimulationPrice,
} from "../../modules/simulation/simulation-state.store.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const seedSchema = z.object({
  usdt: z.string().regex(/^\d+(\.\d+)?$/),
  btc: z.string().regex(/^\d+(\.\d+)?$/),
});

const forceSchema = z.object({
  price: z.union([z.string().regex(/^\d+(\.\d+)?$/), z.null()]),
});

export async function simulationRoutes(app: FastifyInstance) {
  app.get("/state", async (_request, reply) => {
    const sim = getSimulationState();
    const [openCycles, openOrders] = await Promise.all([
      prisma.tradeCycle.count({
        where: {
          status: {
            in: [
              "WAITING_BUY_SIGNAL",
              "BUY_PLACED",
              "BUY_PARTIALLY_FILLED",
              "BUY_FILLED",
              "SELL_PLACED",
              "SELL_PARTIALLY_FILLED",
            ],
          },
        },
      }),
      prisma.order.count({ where: { status: { in: ["OPEN", "PARTIALLY_FILLED", "PENDING"] } } }),
    ]);
    return reply.send({ simulation: sim, openCycles, openOrders });
  });

  app.post("/reset", async (_request, reply) => {
    resetSimulationState();
    await appendBotEvent("INFO", "SIMULATION_RESET", "Estado de simulação (saldo forçado) reposto", {});
    return reply.send({ ok: true, state: getSimulationState() });
  });

  app.post("/seed-balance", async (request, reply) => {
    const parsed = seedSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido" });
    }
    seedSimulationBalance(parsed.data.usdt, parsed.data.btc);
    await appendBotEvent("INFO", "SIMULATION_SEED", "Saldo simulado definido", parsed.data);
    return reply.send({ ok: true, state: getSimulationState() });
  });

  app.post("/force-price", async (request, reply) => {
    const parsed = forceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido" });
    }
    setForcedSimulationPrice(parsed.data.price);
    await appendBotEvent("INFO", "SIMULATION_FORCE_PRICE", "Preço forçado atualizado", {
      price: parsed.data.price,
    });
    return reply.send({ ok: true, state: getSimulationState() });
  });
}
