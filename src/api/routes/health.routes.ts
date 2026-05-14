import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    let database: "up" | "down" = "down";
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "up";
    } catch {
      database = "down";
    }

    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      timestamp: new Date().toISOString(),
    };
  });
}
