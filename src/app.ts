import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "./config/env.js";
import { healthRoutes } from "./api/routes/health.routes.js";
import { authRoutes } from "./api/routes/auth.routes.js";
import { botRoutes } from "./api/routes/bot.routes.js";
import { cyclesRoutes } from "./api/routes/cycles.routes.js";
import { ordersRoutes } from "./api/routes/orders.routes.js";
import { eventsRoutes } from "./api/routes/events.routes.js";
import { portfolioRoutes } from "./api/routes/portfolio.routes.js";
import { marketRoutes } from "./api/routes/market.routes.js";
import { reconciliationRoutes } from "./api/routes/reconciliation.routes.js";
import { liveCycleRoutes } from "./api/routes/live-cycle.routes.js";
import { btcDropRoutes } from "./api/routes/btc-drop.routes.js";
import { botSpotRoutes } from "./api/routes/bot-spot.routes.js";
import { dashboardRoutes } from "./api/routes/dashboard.routes.js";
import { isDashboardAuthEnabled } from "./modules/auth/dashboard-auth.service.js";

async function registerApiRoutes(instance: FastifyInstance, env: Env) {
  await instance.register(async (i) => botRoutes(i, env), { prefix: "/bot" });
  await instance.register(async (i) => cyclesRoutes(i), { prefix: "/cycles" });
  await instance.register(async (i) => ordersRoutes(i, env), { prefix: "/orders" });
  await instance.register(async (i) => eventsRoutes(i), { prefix: "/events" });
  await instance.register(async (i) => portfolioRoutes(i, env), { prefix: "/portfolio" });
  await instance.register(async (i) => marketRoutes(i), { prefix: "/market" });
  await instance.register(async (i) => reconciliationRoutes(i), { prefix: "/reconciliation" });
  await instance.register(async (i) => liveCycleRoutes(i, env), { prefix: "/live-cycle" });
  await instance.register(async (i) => btcDropRoutes(i, env), { prefix: "/strategy/btc-drop" });
  await instance.register(async (i) => botSpotRoutes(i, env), { prefix: "/bot-spot" });
}

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
  await app.register(cookie);

  const authOn = isDashboardAuthEnabled(env);
  if (authOn) {
    await app.register(jwt, {
      secret: env.DASHBOARD_JWT_SECRET,
      sign: { expiresIn: env.DASHBOARD_JWT_EXPIRES_IN },
      cookie: {
        cookieName: env.DASHBOARD_SESSION_COOKIE_NAME,
        signed: false,
      },
    });
  }

  await app.register(healthRoutes);
  await app.register(dashboardRoutes);

  await app.register(
    async (scope) => {
      await scope.register(rateLimit, {
        max: env.DASHBOARD_AUTH_RATE_MAX,
        timeWindow: env.DASHBOARD_AUTH_RATE_WINDOW_MS,
      });
      await scope.register(async (i) => authRoutes(i, { env }));
    },
    { prefix: "/auth" },
  );

  if (authOn) {
    await app.register(async (protectedScope) => {
      protectedScope.addHook("onRequest", async (request, reply) => {
        if (env.DASHBOARD_BLOCK_DOCUMENT_NAV) {
          const dest = request.headers["sec-fetch-dest"];
          if (dest === "document") {
            return reply.code(403).send({ error: "browser_document_fetch_forbidden" });
          }
        }
        try {
          await request.jwtVerify();
        } catch {
          return reply.code(401).send({ error: "unauthorized" });
        }
      });
      await registerApiRoutes(protectedScope, env);
    });
  } else {
    await registerApiRoutes(app, env);
  }

  return app;
}
