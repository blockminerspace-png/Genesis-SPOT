import type { CancelOrderInput, PlaceLimitOrderInput, PlacedOrder } from "../../runtime/runtime-state.types.js";

export interface OrderExecutor {
  placeLimitOrder(input: PlaceLimitOrderInput): Promise<PlacedOrder>;
  cancelOrder(input: CancelOrderInput): Promise<void>;
}
