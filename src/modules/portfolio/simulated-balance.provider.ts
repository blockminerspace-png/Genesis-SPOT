import { Decimal } from "../../shared/decimal.js";
import { getSimulationBalances } from "../simulation/simulation-state.store.js";
import type { AssetBalance } from "./balance.types.js";

function row(asset: string, available: string, frozen: string): AssetBalance {
  const a = new Decimal(available);
  const f = new Decimal(frozen);
  return {
    asset,
    available,
    frozen,
    total: a.plus(f).toFixed(),
  };
}

export function getSimulatedBalanceSlice(): { source: "SIMULATED"; balances: AssetBalance[]; updatedAt: string } {
  const assets = getSimulationBalances();
  return {
    source: "SIMULATED",
    balances: [
      row("USDT", assets.USDT.available, assets.USDT.locked),
      row("BTC", assets.BTC.available, assets.BTC.locked),
    ],
    updatedAt: new Date().toISOString(),
  };
}
