import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { CoinexMarketDataProvider } from "./coinex-market-data.provider.js";
import type { MarketTickerSnapshot } from "./market-data-provider.interface.js";

const lastCoinexOkEventMs = new Map<string, number>();
const lastCoinexErrEventMs = new Map<string, number>();
const COINEX_OK_EVENT_MS = 45_000;
const COINEX_ERR_EVENT_MS = 60_000;

type CacheEntry = { snap: MarketTickerSnapshot; expires: number; fetchedAtMs: number };

export class MarketDataService {
  private readonly coinex: CoinexMarketDataProvider;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {
    this.coinex = new CoinexMarketDataProvider(env);
  }

  private cacheTtl(): number {
    return this.env.MARKET_DATA_CACHE_TTL_MS;
  }

  /** Último fetch ao CoinEx (para travas LIVE). */
  async getTickerWithFetchMeta(
    market: string,
  ): Promise<{ snap: MarketTickerSnapshot; fetchedAtMs: number }> {
    const key = market.toUpperCase();

    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) {
      return { snap: hit.snap, fetchedAtMs: hit.fetchedAtMs };
    }

    try {
      const c = await this.coinex.fetchTicker(key);
      const snap: MarketTickerSnapshot = {
        ...c,
        priceSource: "COINEX",
      };
      const fetchedAtMs = Date.now();
      this.cache.set(key, { snap, expires: now + this.cacheTtl(), fetchedAtMs });
      this.maybeEmitCoinexOk(key);
      return { snap, fetchedAtMs };
    } catch (err) {
      this.log.warn({ err, market: key }, "CoinEx ticker falhou");
      this.maybeEmitCoinexError(key, err);
      throw err;
    }
  }

  async getTicker(market: string): Promise<MarketTickerSnapshot> {
    const { snap } = await this.getTickerWithFetchMeta(market);
    return snap;
  }

  private maybeEmitCoinexOk(market: string) {
    const now = Date.now();
    const last = lastCoinexOkEventMs.get(market) ?? 0;
    if (now - last < COINEX_OK_EVENT_MS) return;
    lastCoinexOkEventMs.set(market, now);
    void appendBotEvent("INFO", "MARKET_DATA_UPDATED", `Ticker CoinEx OK (${market})`, { market });
  }

  private maybeEmitCoinexError(market: string, err: unknown) {
    const now = Date.now();
    const last = lastCoinexErrEventMs.get(market) ?? 0;
    if (now - last < COINEX_ERR_EVENT_MS) return;
    lastCoinexErrEventMs.set(market, now);
    const msg = err instanceof Error ? err.message : String(err);
    void appendBotEvent("ERROR", "MARKET_DATA_ERROR", `CoinEx ticker: ${msg}`, { market });
  }
}

let _svc: MarketDataService | null = null;

export function initMarketDataService(env: Env, log: FastifyBaseLogger): MarketDataService {
  _svc = new MarketDataService(env, log);
  return _svc;
}

export function getMarketDataService(): MarketDataService {
  if (!_svc) {
    throw new Error("MarketDataService not initialized");
  }
  return _svc;
}
