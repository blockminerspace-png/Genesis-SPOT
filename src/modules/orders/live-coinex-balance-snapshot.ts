import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { CoinexBalanceProvider } from "../portfolio/coinex-balance.provider.js";
import type { AssetBalance } from "../portfolio/balance.types.js";

type Cache = { balances: AssetBalance[]; fetchedAtMs: number };

let cache: Cache | null = null;

/** Força novo pedido à CoinEx no próximo tick (ex.: após falha de saldo no pré-check). */
export function invalidateLiveBalanceCache(): void {
  cache = null;
}

/** Snapshot spot CoinEx para travas LIVE (independente de PORTFOLIO_BALANCE_SOURCE). */
export async function getSpotBalancesForLiveGuard(
  env: Env,
  log: FastifyBaseLogger,
  maxAgeMs: number,
): Promise<{ balances: AssetBalance[]; fetchedAtMs: number }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < maxAgeMs) {
    return { balances: cache.balances, fetchedAtMs: cache.fetchedAtMs };
  }

  const p = new CoinexBalanceProvider(env);
  if (!p.hasKeys()) {
    throw new Error("CoinEx: chaves ausentes");
  }
  try {
    const { balances } = await p.fetchSpotBalances();
    cache = { balances, fetchedAtMs: Date.now() };
    return { balances: cache.balances, fetchedAtMs: cache.fetchedAtMs };
  } catch (err) {
    log.warn({ err }, "live guard: CoinEx balance fetch failed");
    throw err;
  }
}
