import type { FastifyInstance } from "fastify";
import { getMarketDataService } from "../../modules/market-data/market-data.service.js";
import { getMarketSpecService } from "../../modules/market-data/market-spec.service.js";

export async function marketRoutes(app: FastifyInstance) {
  app.get("/ticker/:market", async (request, reply) => {
    const { market } = request.params as { market: string };
    if (!/^[A-Za-z0-9]{4,32}$/.test(market)) {
      return reply.code(400).send({ error: "mercado inválido" });
    }
    const key = market.toUpperCase();
    try {
      const snap = await getMarketDataService().getTicker(key);
      return reply.send(snap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "indisponível";
      return reply.code(503).send({ error: "ticker indisponível", details: msg });
    }
  });

  app.get("/info/:market", async (request, reply) => {
    const { market } = request.params as { market: string };
    if (!/^[A-Za-z0-9]{4,32}$/.test(market)) {
      return reply.code(400).send({ error: "mercado inválido" });
    }
    const key = market.toUpperCase();
    try {
      const info = await getMarketSpecService().getSpecPublic(key);
      return reply.send(info);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "indisponível";
      return reply.code(503).send({ error: "market info indisponível", details: msg });
    }
  });
}
