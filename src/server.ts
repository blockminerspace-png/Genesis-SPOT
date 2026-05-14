import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { prisma } from "./infrastructure/database/prisma.js";
import { startSimulatedTickerWorker } from "./modules/workers/simulated-ticker.worker.js";
import { initRuntimeStateService } from "./modules/runtime/runtime-state.service.js";
import { initOrderManager } from "./modules/orders/order-manager.js";
import { startSimulatedCycleWorker } from "./modules/workers/simulated-cycle.worker.js";
import { startLiveOrderReconciliationWorker } from "./modules/reconciliation/live-order-reconciliation.worker.js";
import { startLiveCycleWorker } from "./modules/workers/live-cycle.worker.js";
import { initMarketDataService } from "./modules/market-data/market-data.service.js";
import { initMarketSpecService } from "./modules/market-data/market-spec.service.js";
import { runStartupLiveOpenSellReview } from "./modules/startup/startup-live-review.service.js";

function isListenError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

async function main() {
  const env = loadEnv();
  initRuntimeStateService(env);
  const app = await buildApp(env);
  initMarketDataService(env, app.log);
  initMarketSpecService(env, app.log);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    if (isListenError(err) && err.code === "EACCES" && env.PORT < 1024) {
      // eslint-disable-next-line no-console -- before exit, stderr is ok
      console.error(
        "\n[genesis-spot] PORT < 1024: no Linux isso exige privilégios (EACCES). " +
          "Use PORT>=1024 no .env ou: sudo setcap 'cap_net_bind_service=+ep' \"$(readlink -f \"$(which node)\")\"\n",
      );
    }
    process.exit(1);
  }

  initOrderManager(env, app.log);

  const cfg = await prisma.botConfig.findFirst();
  const market = cfg?.market ?? env.BOT_MARKET;
  startSimulatedTickerWorker({ market, intervalMs: env.BOT_PRICE_POLL_INTERVAL_MS });
  app.log.info({ market, intervalMs: env.BOT_PRICE_POLL_INTERVAL_MS }, "simulated ticker worker started");

  startSimulatedCycleWorker(app.log, 8000);
  app.log.info("simulated cycle worker started (8s)");

  startLiveOrderReconciliationWorker(env, app.log);

  startLiveCycleWorker(env, app.log);

  setTimeout(() => {
    void runStartupLiveOpenSellReview(env, app.log).catch((err) => {
      app.log.error({ err }, "revisão LIVE ao arranque falhou");
    });
  }, 2500);
}

void main();
