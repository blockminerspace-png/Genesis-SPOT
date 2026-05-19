/**
 * Smoke test interno (sem HTTP/JWT). Executar na VM:
 * docker compose -f docker-compose.vm.yml exec -T app node scripts/vm-smoke-bot-spot.mjs
 */
import { loadEnv } from "../dist/config/env.js";
import { initMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { getBotSpotState } from "../dist/modules/bot-spot/bot-spot.service.js";
import { getBotSpotChart } from "../dist/modules/bot-spot/bot-spot.service.js";

function hasBadNumber(obj, path = "") {
  const issues = [];
  if (obj === undefined) issues.push(`${path}=undefined`);
  if (typeof obj === "number" && !Number.isFinite(obj)) issues.push(`${path}=NaN`);
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      issues.push(...hasBadNumber(v, path ? `${path}.${k}` : k));
    }
  }
  return issues;
}

const env = loadEnv();
initMarketDataService(env, console);
const state = await getBotSpotState(env);
const issues = hasBadNumber(state);
const to = Date.now();
const from = to - 7 * 24 * 60 * 60 * 1000;
const chart = await getBotSpotChart(env, {
  market: state.market,
  interval: "15m",
  fromMs: from,
  toMs: to,
});

const out = {
  ok: issues.length === 0 && state.status !== undefined,
  stateStatus: state.status,
  market: state.market,
  livePrice: state.livePrice,
  candleCount: chart.candles?.length ?? 0,
  markerCount: chart.markers?.length ?? 0,
  chartUnavailable: chart.unavailable?.reason ?? null,
  errorsCount: state.errors?.length ?? 0,
  issues,
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
