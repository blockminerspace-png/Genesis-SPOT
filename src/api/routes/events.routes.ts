import type { FastifyInstance } from "fastify";
import { getRecentBotEvents } from "../../modules/events/bot-events.repository.js";

export async function eventsRoutes(app: FastifyInstance) {
  app.get("/recent", async (_request, reply) => {
    const items = await getRecentBotEvents();
    return reply.send({ items });
  });
}
