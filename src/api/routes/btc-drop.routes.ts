import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { Decimal } from "../../shared/decimal.js";
import { getMarketDataService } from "../../modules/market-data/market-data.service.js";
import { getMarketSpecService } from "../../modules/market-data/market-spec.service.js";
import { floorPrice } from "../../modules/market-data/market-spec.rounding.js";
import { readBtcDropConfig } from "../../modules/strategy/btc-drop.types.js";
import { bootstrapInitialMarketBuy } from "../../modules/live-cycle/live-cycle.service.js";
import { getBtcDropStateView, resetBtcDropState } from "../../modules/strategy/btc-drop-state.service.js";

const RESET_CONFIRM = "RESET_BTC_DROP_WITH_OPEN_CYCLES";

export async function btcDropRoutes(app: FastifyInstance, env: Env) {
  app.get("/state", async (_request, reply) => {
    const cfg = readBtcDropConfig(env);
    if (!cfg.enabled) {
      return reply.send({
        enabled: false,
        market: cfg.market,
        anchorPrice: null,
        nextBuyPrice: null,
        stepUsdt: cfg.stepUsdt,
        baseAmount: cfg.baseAmount,
        targetProfitPct: cfg.targetProfitPct,
        estimatedQuoteValueAtNextBuy: null,
        updatedAt: null,
      });
    }
    let spec = null;
    try {
      const loaded = await getMarketSpecService().getSpecWithFetchedAt(cfg.market);
      spec = loaded.spec;
    } catch {
      /* view sem estimativa */
    }
    const view = await getBtcDropStateView(env, spec);
    if (!view) {
      return reply.send({
        enabled: true,
        market: cfg.market,
        anchorPrice: null,
        nextBuyPrice: null,
        stepUsdt: cfg.stepUsdt,
        baseAmount: cfg.baseAmount,
        targetProfitPct: cfg.targetProfitPct,
        estimatedQuoteValueAtNextBuy: null,
        updatedAt: null,
      });
    }
    return reply.send(view);
  });

  app.post("/reset", async (request, reply) => {
    const cfg = readBtcDropConfig(env);
    if (!cfg.enabled) {
      return reply.status(400).send({ ok: false, error: "BTC_STRATEGY_ENABLED=false" });
    }
    const body = (request.body ?? {}) as { confirm?: string };
    const force = body.confirm === RESET_CONFIRM;
    const { spec } = await getMarketSpecService().getSpecWithFetchedAt(cfg.market);
    const { snap } = await getMarketDataService().getTickerWithFetchMeta(cfg.market);
    const last = floorPrice(new Decimal(String(snap.last)), spec).toFixed(spec.quotePrecision);
    const result = await resetBtcDropState(env, last, spec, force);
    if (!result.ok) {
      return reply.status(409).send({ ok: false, error: result.error });
    }
    const bootstrap = await bootstrapInitialMarketBuy(env, request.log);
    return reply.send({ ok: true, state: result.state, bootstrap });
  });
}
