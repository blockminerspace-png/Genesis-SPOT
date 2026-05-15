import { Decimal } from "../../shared/decimal.js";
import { floorPrice } from "../market-data/market-spec.rounding.js";
import { getMarketSpecService } from "../market-data/market-spec.service.js";
import { getRuntimeStateService } from "../runtime/runtime-state.service.js";
import { targetSellFromEntry } from "../strategy/grid.strategy.js";

/** Preço limite de venda alvo a partir do preço médio de entrada (lucro-alvo + margem de taxas da config). */
export async function computeLiveAutoSellTargetPrice(market: string, avgEntryPrice: string): Promise<string | undefined> {
  try {
    const m = market.toUpperCase();
    const [{ spec }, cfg] = await Promise.all([
      getMarketSpecService().getSpecWithFetchedAt(m),
      getRuntimeStateService().getBotConfigRow(),
    ]);
    const avgStr = floorPrice(new Decimal(avgEntryPrice), spec).toFixed(spec.quotePrecision);
    return targetSellFromEntry(avgStr, cfg.targetProfitPct.toString(), cfg.feeBufferPct.toString(), spec);
  } catch {
    return undefined;
  }
}
