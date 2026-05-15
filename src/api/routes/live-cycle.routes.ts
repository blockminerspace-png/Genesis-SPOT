import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { Decimal } from "../../shared/decimal.js";
import { floorPrice } from "../../modules/market-data/market-spec.rounding.js";
import { getMarketDataService } from "../../modules/market-data/market-data.service.js";
import { getMarketSpecService } from "../../modules/market-data/market-spec.service.js";
import { getLiveCycleSummary, resetLiveCycleCircuitBreaker } from "../../modules/live-cycle/live-cycle-state.js";
import type { LiveCycleApiSummary } from "../../modules/live-cycle/live-cycle.types.js";
import { appendBotEvent } from "../../modules/strategy/bot-control.service.js";
import { ensureBotConfigFromEnv } from "../../modules/strategy/bot-config.service.js";
import { gridBuyDropReferenceLevels } from "../../modules/strategy/grid.strategy.js";
import { getRuntimeStateService } from "../../modules/runtime/runtime-state.service.js";
import { autoLiveMarket, effectiveAutoLiveQuoteBudget } from "../../modules/live-cycle/live-cycle.service.js";

export async function liveCycleRoutes(app: FastifyInstance, env: Env) {
  app.get("/summary", async (_request, reply) => {
    await ensureBotConfigFromEnv(env);
    const base = getLiveCycleSummary();
    const rt = getRuntimeStateService();
    const cfg = await rt.getBotConfigRow();
    const market = autoLiveMarket(env, cfg.market);
    let quoteCurrency = "";
    let referenceLastPrice: string | null = null;
    const dropBuyReferencePrices: string[] = [];
    try {
      const [{ snap }, { spec }] = await Promise.all([
        getMarketDataService().getTickerWithFetchMeta(market),
        getMarketSpecService().getSpecWithFetchedAt(market),
      ]);
      quoteCurrency = spec.quoteCurrency;
      const lastRaw = snap.last;
      if (lastRaw != null && String(lastRaw).trim() !== "") {
        const lp = floorPrice(new Decimal(String(lastRaw)), spec).toFixed(spec.quotePrecision);
        referenceLastPrice = lp;
        const stepStr = cfg.gridStepPct.toString().replace(",", ".");
        dropBuyReferencePrices.push(...gridBuyDropReferenceLevels(lp, stepStr, spec, 6));
      }
    } catch {
      /* referência de queda é opcional */
    }

    const payload: LiveCycleApiSummary = {
      ...base,
      liveTradingEnabled: env.ENABLE_LIVE_TRADING,
      runtimeStatus: cfg.runtimeStatus,
      executionMode: cfg.executionMode,
      market,
      quoteValue: effectiveAutoLiveQuoteBudget(env),
      targetProfitPct: cfg.targetProfitPct.toString(),
      gridStepPct: cfg.gridStepPct.toString(),
      quoteCurrency,
      referenceLastPrice,
      dropBuyReferencePrices,
    };
    return reply.send(payload);
  });

  app.post("/reset-circuit-breaker", async (_request, reply) => {
    resetLiveCycleCircuitBreaker();
    await appendBotEvent("INFO", "LIVE_CYCLE_CIRCUIT_RESET", "Circuit breaker Auto LIVE resetado (memória)", {});
    return reply.send({ ok: true });
  });
}
