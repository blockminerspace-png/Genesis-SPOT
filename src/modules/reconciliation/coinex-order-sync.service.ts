import type { Env } from "../../config/env.js";
import { coinexSignedGet } from "../../infrastructure/coinex/coinex-signed-get.js";
import { OrderStatus } from "@prisma/client";
import { Decimal } from "../../shared/decimal.js";
import type { CoinexOrderStatusSnapshot } from "./reconciliation.types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

export function parseCoinexOrderStatusData(data: unknown): CoinexOrderStatusSnapshot | null {
  const o = asRecord(data);
  if (!o) return null;
  const orderId = Number(o.order_id);
  if (!Number.isFinite(orderId)) return null;
  return {
    orderId,
    market: String(o.market ?? "").trim().toUpperCase(),
    status: String(o.status ?? "").trim(),
    amount: String(o.amount ?? "0"),
    unfilledAmount: String(o.unfilled_amount ?? o.unfilledAmount ?? "0"),
    filledAmount: String(o.filled_amount ?? o.filledAmount ?? "0"),
    filledValue: String(o.filled_value ?? o.filledValue ?? "0"),
    baseFee: String(o.base_fee ?? o.baseFee ?? "0"),
    quoteFee: String(o.quote_fee ?? o.quoteFee ?? "0"),
    raw: o,
  };
}

/** CoinEx `order_status` → Prisma `OrderStatus`. */
export function mapCoinexOrderStatusToLocal(coinexStatus: string): OrderStatus {
  const s = coinexStatus.toLowerCase();
  switch (s) {
    case "open":
      return OrderStatus.OPEN;
    case "part_filled":
    case "part_deal":
      return OrderStatus.PARTIALLY_FILLED;
    case "filled":
      return OrderStatus.FILLED;
    case "canceled":
    case "cancelled":
    case "part_canceled":
    case "part_cancelled":
      return OrderStatus.CANCELLED;
    default:
      return OrderStatus.UNKNOWN;
  }
}

/** Corrige estados ambíguos com base em quantidades remotas. */
export function deriveEffectiveLocalStatus(snap: CoinexOrderStatusSnapshot): OrderStatus {
  const mapped = mapCoinexOrderStatusToLocal(snap.status);
  const filled = new Decimal(snap.filledAmount);
  const unfilled = new Decimal(snap.unfilledAmount);

  if (mapped === OrderStatus.OPEN && filled.gt(0) && unfilled.gt(0)) {
    return OrderStatus.PARTIALLY_FILLED;
  }

  if (mapped === OrderStatus.UNKNOWN && filled.gt(0) && unfilled.eq(0)) {
    return OrderStatus.FILLED;
  }

  return mapped;
}

export type FetchOrderStatusResult =
  | { ok: true; snapshot: CoinexOrderStatusSnapshot }
  | { ok: false; reason: "not_found" | "error"; message: string; httpStatus?: number; coinexCode?: number };

export async function fetchCoinexOrderStatus(
  env: Env,
  market: string,
  exchangeOrderId: string,
): Promise<FetchOrderStatusResult> {
  const orderId = Number(exchangeOrderId);
  if (!Number.isFinite(orderId)) {
    return { ok: false, reason: "error", message: "exchange_order_id inválido" };
  }
  const { httpStatus, envelope, rawText } = await coinexSignedGet<unknown>(
    env,
    "spot/order-status",
    {
      market: market.toUpperCase(),
      order_id: orderId,
    },
  );

  if (!envelope) {
    return { ok: false, reason: "error", message: rawText.slice(0, 200), httpStatus };
  }

  if (envelope.code !== 0) {
    const msg = envelope.message || rawText.slice(0, 200);
    const low = msg.toLowerCase();
    if (
      low.includes("not found") ||
      low.includes("does not exist") ||
      low.includes("invalid order")
    ) {
      return { ok: false, reason: "not_found", message: msg, httpStatus, coinexCode: envelope.code };
    }
    return { ok: false, reason: "error", message: msg, httpStatus, coinexCode: envelope.code };
  }

  const snap = parseCoinexOrderStatusData(envelope.data);
  if (!snap) {
    return { ok: false, reason: "error", message: "order-status: data inválido" };
  }
  return { ok: true, snapshot: snap };
}
