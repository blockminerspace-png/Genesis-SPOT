import path from "node:path";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

const publicRoot = () => path.join(process.cwd(), "public");

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => {
    const html = await readFile(path.join(publicRoot(), "index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  await app.register(fastifyStatic, {
    root: path.join(publicRoot(), "assets"),
    prefix: "/assets/",
    decorateReply: false,
  });
}
