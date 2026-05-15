import type {
  CancelOrderInput,
  PlaceLimitOrderInput,
  PlaceMarketBuyInput,
  PlacedOrder,
} from "../../runtime/runtime-state.types.js";

export interface OrderExecutor {
  placeLimitOrder(input: PlaceLimitOrderInput): Promise<PlacedOrder>;
  placeMarketBuy(input: PlaceMarketBuyInput): Promise<PlacedOrder>;
  cancelOrder(input: CancelOrderInput): Promise<void>;
}
