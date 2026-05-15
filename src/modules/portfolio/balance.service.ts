import type { FastifyBaseLogger } from "fastify";
import type { BotExecutionMode } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { CoinexBalanceProvider } from "./coinex-balance.provider.js";
import type { AssetBalance, CoinexBalanceSlice, PortfolioBalancePayload } from "./balance.types.js";

type CoinexCacheEntry = {
  balances: AssetBalance[];
  updatedAt: string;
  expires: number;
};

let coinexCache: CoinexCacheEntry | null = null;
let lastBalanceUpdatedEventMs = 0;
let lastBalanceErrorEventMs = 0;

function classifyCoinexFailure(err: unknown): { authFailed: boolean; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const httpStatus = (err as { httpStatus?: number }).httpStatus;
  const code = (err as { coinexCode?: number }).coinexCode;
  const authFailed =
    httpStatus === 401 ||
    httpStatus === 403 ||
    code === 4001 ||
    /auth|signature|sign|invalid\s*key|permission|unauthor/i.test(msg);
  return { authFailed, message: msg };
}

async function emitBalanceUpdatedThrottled() {
  const now = Date.now();
  if (now - lastBalanceUpdatedEventMs < 60_000) return;
  lastBalanceUpdatedEventMs = now;
  await appendBotEvent("INFO", "BALANCE_UPDATED", "Saldo spot CoinEx lido (read-only)", {});
}

async function emitBalanceErrorThrottled(message: string) {
  const now = Date.now();
  if (now - lastBalanceErrorEventMs < 120_000) return;
  lastBalanceErrorEventMs = now;
  await appendBotEvent("WARN", "BALANCE_ERROR", message, {});
}

async function buildCoinexSlice(env: Env, log: FastifyBaseLogger): Promise<CoinexBalanceSlice> {
  const provider = new CoinexBalanceProvider(env);
  if (!provider.hasKeys()) {
    await appendBotEvent("WARN", "BALANCE_SOURCE_UNAVAILABLE", "CoinEx: faltam COINEX_ACCESS_ID / COINEX_SECRET_KEY", {});
    return {
      source: "COINEX",
      available: false,
      balances: [],
      error: "Chaves CoinEx ausentes no .env",
      authFailed: false,
    };
  }

  const now = Date.now();
  const hit = coinexCache;
  if (hit && hit.expires > now) {
    return {
      source: "COINEX",
      available: true,
      balances: hit.balances,
      updatedAt: hit.updatedAt,
    };
  }

  try {
    const { balances } = await provider.fetchSpotBalances();
    const updatedAt = new Date().toISOString();
    coinexCache = {
      balances,
      updatedAt,
      expires: now + env.PORTFOLIO_BALANCE_CACHE_TTL_MS,
    };
    void emitBalanceUpdatedThrottled();
    return { source: "COINEX", available: true, balances, updatedAt };
  } catch (err) {
    log.warn({ err }, "CoinEx balance read failed");
    const { authFailed, message } = classifyCoinexFailure(err);
    if (authFailed) {
      coinexCache = null;
      await appendBotEvent("ERROR", "COINEX_BALANCE_AUTH_FAILED", message, {});
    } else {
      void emitBalanceErrorThrottled(message);
    }
    return {
      source: "COINEX",
      available: false,
      balances: [],
      error: message,
      authFailed,
    };
  }
}

export async function buildPortfolioBalancePayload(
  env: Env,
  log: FastifyBaseLogger,
  executionMode: BotExecutionMode,
): Promise<PortfolioBalancePayload> {
  const coinex = await buildCoinexSlice(env, log);

  return {
    executionMode,
    portfolioBalanceSource: env.PORTFOLIO_BALANCE_SOURCE,
    coinex,
  };
}
