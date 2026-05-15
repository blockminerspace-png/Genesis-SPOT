export type AssetBalance = {
  asset: string;
  available: string;
  frozen: string;
  total: string;
};

export type CoinexBalanceSlice = {
  source: "COINEX";
  available: boolean;
  balances: AssetBalance[];
  updatedAt?: string;
  error?: string;
  authFailed?: boolean;
};

export type PortfolioBalancePayload = {
  executionMode: string;
  portfolioBalanceSource: string;
  coinex: CoinexBalanceSlice | null;
};
