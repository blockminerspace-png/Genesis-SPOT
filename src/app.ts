import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Env } from "./config/env.js";
import { healthRoutes } from "./api/routes/health.routes.js";
import { botRoutes } from "./api/routes/bot.routes.js";
import { cyclesRoutes } from "./api/routes/cycles.routes.js";
import { ordersRoutes } from "./api/routes/orders.routes.js";
import { eventsRoutes } from "./api/routes/events.routes.js";
import { portfolioRoutes } from "./api/routes/portfolio.routes.js";
import { marketRoutes } from "./api/routes/market.routes.js";
import { simulationRoutes } from "./api/routes/simulation.routes.js";
import { reconciliationRoutes } from "./api/routes/reconciliation.routes.js";
import { liveCycleRoutes } from "./api/routes/live-cycle.routes.js";
import { dashboardRoutes } from "./api/routes/dashboard.routes.js";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
            }
          : undefined,
    },
  });

  await app.register(cors, { origin: false });

  await app.register(healthRoutes);
  await app.register(async (instance) => botRoutes(instance, env), { prefix: "/bot" });
  await app.register(async (instance) => cyclesRoutes(instance), { prefix: "/cycles" });
  await app.register(async (instance) => ordersRoutes(instance, env), { prefix: "/orders" });
  await app.register(async (instance) => eventsRoutes(instance), { prefix: "/events" });
  await app.register(async (instance) => portfolioRoutes(instance, env), { prefix: "/portfolio" });
  await app.register(async (instance) => marketRoutes(instance), { prefix: "/market" });
  await app.register(async (instance) => simulationRoutes(instance), { prefix: "/simulation" });
  await app.register(async (instance) => reconciliationRoutes(instance), { prefix: "/reconciliation" });
  await app.register(async (instance) => liveCycleRoutes(instance, env), { prefix: "/live-cycle" });
  await app.register(dashboardRoutes);

  return app;
}
