import { prisma } from "../../infrastructure/database/prisma.js";

export async function getOrderSummary() {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<
    string,
    number
  >;

  return {
    totalOrders: grouped.reduce((acc, g) => acc + g._count._all, 0),
    byStatus,
  };
}

const RECENT_ORDERS_LIMIT = 30;

export async function getRecentOrders(limit = RECENT_ORDERS_LIMIT) {
  const take = Math.min(Math.max(limit, 1), 100);
  return prisma.order.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cycleId: true,
      exchangeOrderId: true,
      clientId: true,
      market: true,
      side: true,
      type: true,
      status: true,
      price: true,
      amount: true,
      filledAmount: true,
      filledValue: true,
      fee: true,
      feeCurrency: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
