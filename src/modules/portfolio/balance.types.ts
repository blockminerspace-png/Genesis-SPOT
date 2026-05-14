export type AssetBalance = {
  asset: string;
  available: string;
  frozen: string;
  total: string;
};

export type SimulatedBalanceSlice = {
  source: "SIMULATED";
  balances: AssetBalance[];
  updatedAt: string;
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
  /** Em DRY_RUN o motor continua a usar apenas o store simulado. */
  motorUsesSimulatedBalance: boolean;
  simulated: SimulatedBalanceSlice | null;
  coinex: CoinexBalanceSlice | null;
};
