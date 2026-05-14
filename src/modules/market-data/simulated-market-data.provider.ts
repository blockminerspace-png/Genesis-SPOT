import { getSimulatedTicker } from "./simulated-ticker.store.js";
import type { MarketDataProvider } from "./market-data-provider.interface.js";

export class SimulatedMarketDataProvider implements MarketDataProvider {
  readonly id = "simulated" as const;

  async fetchTicker(market: string) {
    const key = market.toUpperCase();
    const tick = getSimulatedTicker(key);
    if (!tick.last) {
      throw new Error("Ticker simulado ainda sem preço (aguarde o worker)");
    }
    return {
      market: key,
      last: tick.last,
      updatedAt: tick.updatedAt ?? new Date().toISOString(),
    };
  }
}
