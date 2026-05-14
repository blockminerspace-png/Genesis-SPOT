import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { ensureBotConfigFromEnv } from "../../modules/strategy/bot-config.service.js";
import { buildPortfolioBalancePayload } from "../../modules/portfolio/balance.service.js";

export async function portfolioRoutes(app: FastifyInstance, env: Env) {
  app.get("/balance", async (_request, reply) => {
    const row = await ensureBotConfigFromEnv(env);
    const payload = await buildPortfolioBalancePayload(env, app.log, row.executionMode);
    return reply.send(payload);
  });
}
