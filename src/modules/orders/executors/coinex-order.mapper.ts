import { createHash } from "node:crypto";
import type { PlaceLimitOrderInput } from "../../runtime/runtime-state.types.js";

export function hashClientIdForCoinex(clientId: string): string {
  return createHash("sha256").update(clientId, "utf8").digest("hex").slice(0, 32);
}

export function buildSpotLimitOrderBody(input: {
  market: string;
  side: "BUY" | "SELL";
  amount: string;
  price: string;
  clientIdHashed: string;
}): Record<string, unknown> {
  return {
    market: input.market.toUpperCase(),
    market_type: "SPOT",
    side: input.side === "BUY" ? "buy" : "sell",
    type: "limit",
    amount: input.amount,
    price: input.price,
    client_id: input.clientIdHashed,
  };
}

export function mapPlaceLimitFromInput(
  input: PlaceLimitOrderInput,
  flooredAmount: string,
  flooredPrice: string,
): Record<string, unknown> {
  return buildSpotLimitOrderBody({
    market: input.market,
    side: input.side,
    amount: flooredAmount,
    price: flooredPrice,
    clientIdHashed: hashClientIdForCoinex(input.clientId),
  });
}

export function extractOrderIdFromPlaceResponse(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const o = data as Record<string, unknown>;
  const id = o.order_id ?? o.orderId;
  if (id === undefined || id === null) return "";
  return String(id);
}

export function buildCancelOrderBody(market: string, orderId: string): Record<string, unknown> {
  const n = Number(orderId);
  if (!Number.isFinite(n)) {
    throw new Error("order_id inválido");
  }
  return {
    market: market.toUpperCase(),
    market_type: "SPOT",
    order_id: n,
  };
}
