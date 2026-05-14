import type { FastifyInstance } from "fastify";
import { getCycleSummary, getRecentCycles } from "../../modules/cycles/cycle.repository.js";

export async function cyclesRoutes(app: FastifyInstance) {
  app.get("/summary", async (_request, reply) => {
    const summary = await getCycleSummary();
    return reply.send(summary);
  });

  app.get("/recent", async (_request, reply) => {
    const items = await getRecentCycles();
    return reply.send({ items });
  });
}
