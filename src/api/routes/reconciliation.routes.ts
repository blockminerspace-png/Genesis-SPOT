import type { FastifyInstance } from "fastify";
import { getLiveReconciliationSummary } from "../../modules/reconciliation/live-order-reconciliation.worker.js";

export async function reconciliationRoutes(app: FastifyInstance) {
  app.get("/live-summary", async (_request, reply) => {
    return reply.send(getLiveReconciliationSummary());
  });
}
