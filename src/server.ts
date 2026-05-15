import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** Sempre o `.env` na raiz do projeto (evita falhas se `node`/`tsx` arrancar com cwd noutro sítio). */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

import { loadEnv, type Env } from "./config/env.js";
import { Decimal } from "./shared/decimal.js";
import { buildApp } from "./app.js";
import { prisma } from "./infrastructure/database/prisma.js";
import { initRuntimeStateService } from "./modules/runtime/runtime-state.service.js";
import { initOrderManager } from "./modules/orders/order-manager.js";
import { startLiveOrderReconciliationWorker } from "./modules/reconciliation/live-order-reconciliation.worker.js";
import { startLiveCycleWorker } from "./modules/workers/live-cycle.worker.js";
import { initMarketDataService } from "./modules/market-data/market-data.service.js";
import { initMarketSpecService } from "./modules/market-data/market-spec.service.js";
import { runStartupLiveOpenSellReview } from "./modules/startup/startup-live-review.service.js";
import { runStartupPendingOrderSync } from "./modules/startup/startup-pending-orders-sync.service.js";

function isListenError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function warnLiveQuoteCapIfTooLow(env: Env, log: { warn: (o: object, msg?: string) => void }) {
  if (!env.ENABLE_LIVE_TRADING && !env.ENABLE_AUTO_LIVE_WORKER) return;
  try {
    const cap = new Decimal(env.LIVE_MAX_ORDER_QUOTE_VALUE);
    if (cap.lt(10)) {
      log.warn(
        {
          LIVE_MAX_ORDER_QUOTE_VALUE: env.LIVE_MAX_ORDER_QUOTE_VALUE,
        },
        "LIVE_MAX_ORDER_QUOTE_VALUE está baixo no .env: o lote mínimo da CoinEx (ex. 0,0001 BTC) costuma exigir vários USDC de notional. Define pelo menos 50 (ou remove a linha para usar a omissão).",
      );
    }
  } catch {
    /* ignore parse */
  }
}

async function main() {
  const env = loadEnv();
  initRuntimeStateService(env);
  const app = await buildApp(env);
  warnLiveQuoteCapIfTooLow(env, app.log);
  if (!env.DASHBOARD_AUTH_ENABLED) {
    app.log.warn(
      "DASHBOARD_AUTH_ENABLED=false: o dashboard em / não exige login (qualquer guia anónima vê dados). " +
        "Para exigir JWT + 2FA por email: DASHBOARD_AUTH_ENABLED=true, DASHBOARD_JWT_SECRET (≥32), DASHBOARD_USERS, SMTP_HOST/SMTP_FROM e migração Prisma dashboard_*.",
    );
  }
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

  await runStartupPendingOrderSync(env, app.log).catch((err) => {
    app.log.error({ err }, "sync ordens pendentes CoinEx ao arranque falhou");
  });

  const cfg = await prisma.botConfig.findFirst();
  const market = cfg?.market ?? env.BOT_MARKET;
  app.log.info({ market }, "spot: ticker e spec só via CoinEx (sem simulador)");

  startLiveOrderReconciliationWorker(env, app.log);

  startLiveCycleWorker(env, app.log);

  setTimeout(() => {
    void runStartupLiveOpenSellReview(env, app.log).catch((err) => {
      app.log.error({ err }, "revisão LIVE ao arranque falhou");
    });
  }, 2500);
}

void main();
