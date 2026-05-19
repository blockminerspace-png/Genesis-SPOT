import { Decimal } from "../../shared/decimal.js";
import { floorPrice } from "../market-data/market-spec.rounding.js";
import { getMarketSpecService } from "../market-data/market-spec.service.js";
import { getRuntimeStateService } from "../runtime/runtime-state.service.js";
import { loadEnv } from "../../config/env.js";
import { targetSellFromEntry } from "../strategy/grid.strategy.js";

/** Preço limite de venda alvo a partir do preço médio de entrada (lucro-alvo + margem de taxas da config). */
export async function computeLiveAutoSellTargetPrice(market: string, avgEntryPrice: string): Promise<string | undefined> {
  try {
    const m = market.toUpperCase();
    const env = loadEnv();
    const [{ spec }, cfg] = await Promise.all([
      getMarketSpecService().getSpecWithFetchedAt(m),
      getRuntimeStateService().getBotConfigRow(),
    ]);
    const avgStr = floorPrice(new Decimal(avgEntryPrice), spec).toFixed(spec.quotePrecision);
    const targetProfitPct = env.BTC_STRATEGY_ENABLED ? env.BTC_TARGET_PROFIT_PCT : cfg.targetProfitPct.toString();
    return targetSellFromEntry(avgStr, targetProfitPct, cfg.feeBufferPct.toString(), spec);
  } catch {
    return undefined;
  }
}
