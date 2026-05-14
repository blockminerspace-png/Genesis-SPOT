import { prisma } from "../../infrastructure/database/prisma.js";
import type { Prisma } from "@prisma/client";

export async function getCycleSummary() {
  const grouped = await prisma.tradeCycle.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<
    string,
    number
  >;

  const openStatuses = [
    "BUY_PLACED",
    "BUY_PARTIALLY_FILLED",
    "BUY_FILLED",
    "SELL_PLACED",
    "SELL_PARTIALLY_FILLED",
  ] as const;

  let openCycles = 0;
  for (const s of openStatuses) {
    openCycles += byStatus[s] ?? 0;
  }

  return {
    totalCycles: grouped.reduce((acc, g) => acc + g._count._all, 0),
    openCycles,
    byStatus,
  };
}

export async function createCyclePlaceholder(data: Prisma.TradeCycleCreateInput) {
  return prisma.tradeCycle.create({ data });
}

const RECENT_CYCLES_LIMIT = 25;

export async function getRecentCycles(limit = RECENT_CYCLES_LIMIT) {
  const take = Math.min(Math.max(limit, 1), 100);
  return prisma.tradeCycle.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      market: true,
      status: true,
      entryPrice: true,
      targetPrice: true,
      quoteBudget: true,
      quoteSpent: true,
      baseFilled: true,
      buyFee: true,
      sellFee: true,
      realizedProfitQuote: true,
      realizedProfitPct: true,
      buyOrderId: true,
      sellOrderId: true,
      openedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
