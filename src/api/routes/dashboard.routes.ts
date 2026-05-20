import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { sendDashboardIndex } from "../dashboard-html.js";

const publicRoot = () => path.join(process.cwd(), "public");
const dashboardRoot = () => path.join(publicRoot(), "dashboard");

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => sendDashboardIndex(reply));

  /** SPA: mesmo bundle React para o ecrã de login. */
  app.get("/login", async (_request, reply) => sendDashboardIndex(reply));

  /** SPA: índice Bot Spot (subpaths partilham URL com API — HTML via negociação em bot-spot.routes). */
  app.get("/bot-spot", async (_request, reply) => sendDashboardIndex(reply));
  app.get("/bot-spot/settings", async (_request, reply) => sendDashboardIndex(reply));
  app.get("/bot-spot/debug", async (_request, reply) => sendDashboardIndex(reply));

  app.get("/legacy", async (_request, reply) => sendDashboardIndex(reply));
  app.get("/legacy/*", async (_request, reply) => sendDashboardIndex(reply));

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
