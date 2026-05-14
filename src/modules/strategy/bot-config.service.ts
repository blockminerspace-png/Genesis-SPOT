import type { BotExecutionMode, BotRuntimeStatus } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { Env } from "../../config/env.js";
import { computeEnabledForRuntimeStatus } from "../runtime/runtime-state.service.js";

/**
 * Ensures a single BotConfig row exists, seeded from environment defaults.
 */
export async function ensureBotConfigFromEnv(env: Env) {
  const existing = await prisma.botConfig.findFirst();
  if (existing) {
    return existing;
  }

  let runtimeStatus: BotRuntimeStatus = "OFF";
  let executionMode: BotExecutionMode = "DRY_RUN";
  if (env.BOT_ENABLED) {
    runtimeStatus = "RUNNING";
    executionMode = env.DRY_RUN ? "DRY_RUN" : "LIVE";
  }

  return prisma.botConfig.create({
    data: {
      market: env.BOT_MARKET,
      quoteCurrency: "USDT",
      baseCurrency: "BTC",
      enabled: computeEnabledForRuntimeStatus(runtimeStatus),
      runtimeStatus,
      executionMode,
      orderQuoteSize: env.BOT_ORDER_QUOTE_SIZE,
      targetProfitPct: env.BOT_TARGET_PROFIT_PCT,
      gridStepPct: env.BOT_GRID_STEP_PCT,
      maxOpenCycles: env.BOT_MAX_OPEN_CYCLES,
      maxQuoteAllocation: env.BOT_MAX_QUOTE_ALLOCATION,
      minQuoteBalance: env.BOT_MIN_QUOTE_BALANCE,
      feeBufferPct: env.BOT_FEE_BUFFER_PCT,
    },
  });
}

export async function getBotConfigView(env: Env) {
  const row = await ensureBotConfigFromEnv(env);
  const keys = Boolean(env.COINEX_ACCESS_ID && env.COINEX_SECRET_KEY);

  let executionLayer: "SIMULATED" | "LIVE" | "DISABLED" = "DISABLED";
  let liveBlockedMissingKeys = false;

  if (row.runtimeStatus === "OFF" || row.runtimeStatus === "KILL_SWITCH") {
    executionLayer = "DISABLED";
  } else if (row.executionMode === "LIVE") {
    if (!keys) {
      executionLayer = "DISABLED";
      liveBlockedMissingKeys = true;
    } else {
      executionLayer = "LIVE";
    }
  } else {
    executionLayer = "SIMULATED";
  }

  const simulatedExecution = executionLayer === "SIMULATED";
  const liveExecution = executionLayer === "LIVE";

  return {
    source: "database" as const,
    runtime: {
      marketDataSource: env.MARKET_DATA_SOURCE,
      marketDataCacheTtlMs: env.MARKET_DATA_CACHE_TTL_MS,
      marketSpecCacheTtlMs: env.MARKET_SPEC_CACHE_TTL_MS,
      portfolioBalanceSource: env.PORTFOLIO_BALANCE_SOURCE,
      portfolioBalanceCacheTtlMs: env.PORTFOLIO_BALANCE_CACHE_TTL_MS,
      enableLiveTrading: env.ENABLE_LIVE_TRADING,
      liveMarketAllowlist: env.LIVE_MARKET_ALLOWLIST,
      listenHost: env.HOST,
      listenPort: env.PORT,
      runtimeStatus: row.runtimeStatus,
      executionMode: row.executionMode,
      executionLayer,
      liveBlockedMissingKeys,
      simulatedExecution,
      liveExecution,
      envDryRun: env.DRY_RUN,
      nodeEnv: env.NODE_ENV,
      coinexConfigured: keys,
      pricePollIntervalMs: env.BOT_PRICE_POLL_INTERVAL_MS,
      reconciliationIntervalMs: env.BOT_RECONCILIATION_INTERVAL_MS,
    },
    config: row,
  };
}
