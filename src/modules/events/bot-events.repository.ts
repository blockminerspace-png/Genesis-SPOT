import { prisma } from "../../infrastructure/database/prisma.js";

const RECENT_EVENTS_LIMIT = 50;

export async function getRecentBotEvents(limit = RECENT_EVENTS_LIMIT) {
  const take = Math.min(Math.max(limit, 1), 200);
  return prisma.botEvent.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      level: true,
      type: true,
      message: true,
      context: true,
      createdAt: true,
    },
  });
}
