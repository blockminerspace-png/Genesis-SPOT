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
import { autoLiveMarket, autoLiveMarkets, effectiveAutoLiveQuoteBudget } from "../../modules/live-cycle/live-cycle.service.js";
import { getBtcDropStateView } from "../../modules/strategy/btc-drop-state.service.js";
import { readBtcDropConfig } from "../../modules/strategy/btc-drop.types.js";

export async function liveCycleRoutes(app: FastifyInstance, env: Env) {
  app.get("/summary", async (_request, reply) => {
    await ensureBotConfigFromEnv(env);
    const base = getLiveCycleSummary();
    const rt = getRuntimeStateService();
    const cfg = await rt.getBotConfigRow();
    const market = autoLiveMarket(env, cfg.market);
    const activeMarkets = autoLiveMarkets(env, cfg.market);
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

    const btcCfg = readBtcDropConfig(env);
    let btcDropState: LiveCycleApiSummary["btcDropState"] = null;
    if (btcCfg.enabled) {
      try {
        const { spec } = await getMarketSpecService().getSpecWithFetchedAt(btcCfg.market);
        const view = await getBtcDropStateView(env, spec);
        if (view) {
          btcDropState = {
            anchorPrice: view.anchorPrice,
            nextBuyPrice: view.nextBuyPrice,
            stepUsdt: view.stepUsdt,
            baseAmount: view.baseAmount,
            targetProfitPct: view.targetProfitPct,
            estimatedQuoteValueAtNextBuy: view.estimatedQuoteValueAtNextBuy,
            updatedAt: view.updatedAt,
          };
        }
      } catch {
        btcDropState = {
          anchorPrice: null,
          nextBuyPrice: null,
          stepUsdt: btcCfg.stepUsdt,
          baseAmount: btcCfg.baseAmount,
          targetProfitPct: btcCfg.targetProfitPct,
          estimatedQuoteValueAtNextBuy: null,
          updatedAt: null,
        };
      }
    }

    const payload: LiveCycleApiSummary = {
      ...base,
      liveTradingEnabled: env.ENABLE_LIVE_TRADING,
      runtimeStatus: cfg.runtimeStatus,
      executionMode: cfg.executionMode,
      market,
      activeMarkets,
      quoteValue: effectiveAutoLiveQuoteBudget(env),
      targetProfitPct: btcCfg.enabled ? btcCfg.targetProfitPct : cfg.targetProfitPct.toString(),
      gridStepPct: cfg.gridStepPct.toString(),
      quoteCurrency,
      referenceLastPrice,
      dropBuyReferencePrices,
      btcStrategyEnabled: btcCfg.enabled,
      btcDropState,
    };
    return reply.send(payload);
  });

  app.post("/reset-circuit-breaker", async (_request, reply) => {
    resetLiveCycleCircuitBreaker();
    await appendBotEvent("INFO", "LIVE_CYCLE_CIRCUIT_RESET", "Circuit breaker Auto LIVE resetado (memória)", {});
    return reply.send({ ok: true });
  });
}
