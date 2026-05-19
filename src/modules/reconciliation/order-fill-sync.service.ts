import { Prisma } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { coinexSignedGet } from "../../infrastructure/coinex/coinex-signed-get.js";
import { Decimal } from "../../shared/decimal.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { CoinexUserDeal } from "./reconciliation.types.js";

function parseDealRow(r: Record<string, unknown>): CoinexUserDeal | null {
  const dealId = Number(r.deal_id ?? r.dealId);
  const orderId = Number(r.order_id ?? r.orderId);
  if (!Number.isFinite(dealId) || !Number.isFinite(orderId)) return null;
  return {
    dealId,
    orderId,
    createdAtMs: Number(r.created_at ?? r.createdAt ?? 0),
    price: String(r.price ?? "0"),
    amount: String(r.amount ?? "0"),
    fee: String(r.fee ?? "0"),
    feeCcy: String(r.fee_ccy ?? r.feeCcy ?? ""),
    side: String(r.side ?? ""),
  };
}

/**
 * Lista deals CoinEx para um mercado no intervalo [sinceMs, now], todas as páginas,
 * filtrando pelo `orderId` remoto.
 */
export async function fetchCoinexUserDealsForOrder(
  env: Env,
  market: string,
  remoteOrderId: number,
  sinceMs: number,
): Promise<CoinexUserDeal[]> {
  const out: CoinexUserDeal[] = [];
  let page = 1;
  const limit = 100;
  const endTime = Date.now();
  for (;;) {
    const { httpStatus, envelope, rawText } = await coinexSignedGet<unknown[]>(env, "spot/user-deals", {
      market: market.toUpperCase(),
      market_type: "SPOT",
      start_time: Math.max(0, Math.floor(sinceMs)),
      end_time: endTime,
      page,
      limit,
    });

    if (!envelope || envelope.code !== 0) {
      throw new Error(envelope?.message ?? rawText.slice(0, 200) ?? `HTTP ${httpStatus}`);
    }

    const rows = Array.isArray(envelope.data) ? envelope.data : [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const d = parseDealRow(row as Record<string, unknown>);
      if (d && d.orderId === remoteOrderId) {
        out.push(d);
      }
    }

    if (!envelope.pagination?.has_next) break;
    page += 1;
    if (page > 50) break;
  }
  return out;
}

export async function importCoinexDealsAsFills(orderId: string, deals: CoinexUserDeal[]): Promise<number> {
  let inserted = 0;
  for (const d of deals) {
    const value = new Decimal(d.price).mul(new Decimal(d.amount)).toFixed(12);
    const feeCcy = d.feeCcy || "USDC";
    try {
      await prisma.orderFill.create({
        data: {
          orderId,
          exchangeDealId: String(d.dealId),
          price: d.price,
          amount: d.amount,
          value,
          fee: d.fee,
          feeCurrency: feeCcy,
          executedAt: new Date(d.createdAtMs || Date.now()),
        },
      });
      inserted += 1;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue;
      }
      throw e;
    }
  }
  return inserted;
}

/** Soma `value` dos fills já persistidos para a ordem. */
export async function sumLocalFillValues(orderId: string) {
  const agg = await prisma.orderFill.aggregate({
    where: { orderId },
    _sum: { value: true },
  });
  const v = agg._sum.value;
  return v ? new Decimal(v.toString()) : new Decimal(0);
}
