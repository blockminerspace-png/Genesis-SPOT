/** Resultado bruto do provider (sem `priceSource` — preenchido pelo serviço). */
export type ProviderTickerResult = {
  market: string;
  last: string;
  updatedAt: string;
  coinexRaw?: unknown;
};

export type MarketTickerSource = "COINEX";

export type MarketTickerSnapshot = ProviderTickerResult & {
  priceSource: MarketTickerSource;
};

export interface MarketDataProvider {
  readonly id: "coinex";
  fetchTicker(market: string): Promise<ProviderTickerResult>;
}
