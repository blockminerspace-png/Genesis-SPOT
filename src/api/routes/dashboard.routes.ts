import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { sendDashboardIndex } from "../dashboard-html.js";

const publicRoot = () => path.join(process.cwd(), "public");
const dashboardRoot = () => path.join(publicRoot(), "dashboard");

/** Rotas UI antigas (não colidir com API JSON em /bot-spot/chart|cycles|orders). */
const legacySpaPaths = ["/bot-spot", "/bot-spot/settings", "/bot-spot/debug", "/legacy"] as const;

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => sendDashboardIndex(reply));

  /** SPA: mesmo bundle React para o ecrã de login. */
  app.get("/login", async (_request, reply) => sendDashboardIndex(reply));

  for (const p of legacySpaPaths) {
    app.get(p, async (_request, reply) => reply.redirect("/"));
  }
  app.get("/legacy/*", async (_request, reply) => reply.redirect("/"));

  await app.register(fastifyStatic, {
    root: path.join(dashboardRoot(), "dash-assets"),
    prefix: "/dash-assets/",
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: path.join(publicRoot(), "assets"),
    prefix: "/assets/",
    decorateReply: false,
  });
}
