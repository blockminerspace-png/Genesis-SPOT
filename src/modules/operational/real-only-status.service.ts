import type { BotExecutionMode, BotRuntimeStatus } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { AUTO_LIVE_CONFIRM_REQUIRED_PHRASE } from "../live-cycle/live-cycle.constants.js";
import { getLiveCycleSummary } from "../live-cycle/live-cycle-state.js";
import { getLiveReconciliationSummary } from "../reconciliation/live-order-reconciliation.worker.js";
import { readBtcDropConfig } from "../strategy/btc-drop.types.js";

export type OperationalCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
};

export type RealOnlyOperationalStatus = {
  realOnly: true;
  genesisMode: "REAL_ONLY";
  checks: OperationalCheck[];
  readyForAutoLive: boolean;
  blockingSummary: string[];
  env: {
    marketDataSource: string;
    portfolioBalanceSource: string;
    enableLiveTrading: boolean;
    enableAutoLiveWorker: boolean;
    autoLiveConfirmOk: boolean;
    btcStrategyEnabled: boolean;
    btcStrategyMarket: string;
    liveMarketAllowlist: string;
  };
  postgres: {
    runtimeStatus: BotRuntimeStatus;
    executionMode: BotExecutionMode;
    market: string;
  };
  worker: {
    status: string;
    enabledByEnv: boolean;
    lastDecision: string | null;
    circuitOpen: boolean;
  };
};

function push(checks: OperationalCheck[], id: string, label: string, ok: boolean, detail?: string): void {
  checks.push({ id, label, ok, detail });
}

export function buildRealOnlyOperationalStatus(
  env: Env,
  postgres: { runtimeStatus: BotRuntimeStatus; executionMode: BotExecutionMode; market: string },
): RealOnlyOperationalStatus {
  const checks: OperationalCheck[] = [];
  const btc = readBtcDropConfig(env);
  const keysOk = Boolean(env.COINEX_ACCESS_ID?.trim() && env.COINEX_SECRET_KEY?.trim());

  push(
    checks,
    "market_data_source_coinex",
    "MARKET_DATA_SOURCE = COINEX",
    env.MARKET_DATA_SOURCE === "COINEX",
    env.MARKET_DATA_SOURCE !== "COINEX" ? "Genesis SPOT exige MARKET_DATA_SOURCE=COINEX" : undefined,
  );

  push(
    checks,
    "portfolio_balance_source_coinex",
    "PORTFOLIO_BALANCE_SOURCE = COINEX",
    env.PORTFOLIO_BALANCE_SOURCE === "COINEX",
    env.PORTFOLIO_BALANCE_SOURCE !== "COINEX"
      ? "Genesis SPOT exige saldo real CoinEx (PORTFOLIO_BALANCE_SOURCE=COINEX)"
      : undefined,
  );

  push(
    checks,
    "execution_mode_live",
    "execution_mode = LIVE (Postgres)",
    postgres.executionMode === "LIVE",
    postgres.executionMode !== "LIVE" ? "Genesis SPOT exige execution_mode=LIVE" : undefined,
  );

  push(checks, "enable_live_trading", "ENABLE_LIVE_TRADING = true", env.ENABLE_LIVE_TRADING);
  push(checks, "coinex_keys", "Chaves CoinEx configuradas", keysOk);
  push(
    checks,
    "auto_live_confirm_env",
    "AUTO_LIVE_CONFIRM_ENV correto",
    env.AUTO_LIVE_CONFIRM_ENV === AUTO_LIVE_CONFIRM_REQUIRED_PHRASE,
    env.AUTO_LIVE_CONFIRM_ENV ? "definido" : "vazio",
  );
  push(
    checks,
    "enable_auto_live_worker",
    "ENABLE_AUTO_LIVE_WORKER (.env)",
    env.ENABLE_AUTO_LIVE_WORKER,
    env.ENABLE_AUTO_LIVE_WORKER ? "true" : "false — motor Auto não corre ticks",
  );
  push(checks, "runtime_running", "runtime_status = RUNNING", postgres.runtimeStatus === "RUNNING", postgres.runtimeStatus);
  push(checks, "kill_switch_off", "Kill switch inativo", postgres.runtimeStatus !== "KILL_SWITCH");

  const allow = env.LIVE_MARKET_ALLOWLIST.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const market = btc.enabled ? btc.market : postgres.market.toUpperCase();
  push(
    checks,
    "live_market_allowlist",
    `Allowlist inclui ${market}`,
    allow.includes(market),
    allow.join(", ") || "(vazio)",
  );

  if (btc.enabled) {
    push(checks, "btc_strategy_enabled", "Estratégia BTC Drop 2K ativa", true);
  }

  const lc = getLiveCycleSummary();
  const recon = getLiveReconciliationSummary();
  push(checks, "circuit_breaker_closed", "Circuit breaker fechado", lc.status !== "CIRCUIT_OPEN");
  push(
    checks,
    "reconciliation_healthy",
    "Reconciliador LIVE saudável",
    recon.lastHealthyTickCompletedAtMs !== null && !recon.lastError && !recon.fillSumDriftDetected,
    recon.lastError ?? undefined,
  );

  const blockingSummary = checks.filter((c) => !c.ok).map((c) => c.detail ?? c.label);
  const readyForAutoLive = checks.every((c) => c.ok);

  return {
    realOnly: true,
    genesisMode: "REAL_ONLY",
    checks,
    readyForAutoLive,
    blockingSummary,
    env: {
      marketDataSource: env.MARKET_DATA_SOURCE,
      portfolioBalanceSource: env.PORTFOLIO_BALANCE_SOURCE,
      enableLiveTrading: env.ENABLE_LIVE_TRADING,
      enableAutoLiveWorker: env.ENABLE_AUTO_LIVE_WORKER,
      autoLiveConfirmOk: env.AUTO_LIVE_CONFIRM_ENV === AUTO_LIVE_CONFIRM_REQUIRED_PHRASE,
      btcStrategyEnabled: btc.enabled,
      btcStrategyMarket: btc.market,
      liveMarketAllowlist: env.LIVE_MARKET_ALLOWLIST,
    },
    postgres: {
      runtimeStatus: postgres.runtimeStatus,
      executionMode: postgres.executionMode,
      market: postgres.market,
    },
    worker: {
      status: lc.status,
      enabledByEnv: lc.enabledByEnv,
      lastDecision: lc.lastDecision,
      circuitOpen: lc.status === "CIRCUIT_OPEN",
    },
  };
}
