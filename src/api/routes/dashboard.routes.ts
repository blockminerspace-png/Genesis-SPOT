import path from "node:path";
import { readFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";

const publicRoot = () => path.join(process.cwd(), "public");
const dashboardRoot = () => path.join(publicRoot(), "dashboard");

async function sendDashboardIndex(reply: FastifyReply) {
  try {
    const html = await readFile(path.join(dashboardRoot(), "index.html"), "utf8");
    return reply
      .header("Cache-Control", "no-store, max-age=0")
      .type("text/html; charset=utf-8")
      .send(html);
  } catch {
    return reply
      .code(503)
      .type("text/html; charset=utf-8")
      .send(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Genesis SPOT</title></head><body><p>Dashboard não compilado. Corre <code>npm run build</code> ou <code>vite build --config web/vite.config.ts</code>.</p></body></html>",
      );
  }
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => sendDashboardIndex(reply));

  /** SPA: mesmo bundle React para o ecrã de login. */
  app.get("/login", async (_request, reply) => sendDashboardIndex(reply));

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
