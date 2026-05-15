import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { appendBotEvent } from "../strategy/bot-control.service.js";
import { CoinexMarketSpecProvider } from "./coinex-market-spec.provider.js";
import { MarketSpecStore } from "./market-spec.store.js";
import type { MarketSpec, MarketSpecPublic } from "./market-spec.types.js";

const lastSpecOkEventMs = new Map<string, number>();
const lastSpecErrEventMs = new Map<string, number>();
const lastApiDisabledEventMs = new Map<string, number>();
const SPEC_OK_EVENT_MS = 300_000;
const SPEC_ERR_EVENT_MS = 120_000;
const API_DISABLED_EVENT_MS = 3_600_000;

function splitMarketPair(market: string): { baseCurrency: string; quoteCurrency: string } {
  const m = market.toUpperCase();
  const suffixes = ["USDT", "USDC", "USD", "BTC", "ETH"] as const;
  for (const q of suffixes) {
    if (m.endsWith(q) && m.length > q.length) {
      return { baseCurrency: m.slice(0, -q.length), quoteCurrency: q };
    }
  }
  if (m.length > 4) {
    return { baseCurrency: m.slice(0, -4), quoteCurrency: m.slice(-4) };
  }
  return { baseCurrency: "BASE", quoteCurrency: "QUOTE" };
}

export function buildStaticFallbackSpec(market: string): MarketSpec {
  const key = market.toUpperCase();
  const { baseCurrency, quoteCurrency } = splitMarketPair(key);
  const quotePrecision = quoteCurrency === "USDT" || quoteCurrency === "USDC" ? 2 : 8;
  return {
    market: key,
    baseCurrency,
    quoteCurrency,
    basePrecision: 8,
    quotePrecision,
    minAmount: "0.0001",
    minValue: null,
    makerFeeRate: "0.002",
    takerFeeRate: "0.002",
    tradingEnabled: true,
    apiTradingEnabled: true,
    raw: { staticFallback: true, market: key },
    source: "STATIC_FALLBACK",
    updatedAt: new Date().toISOString(),
  };
}

function toPublic(spec: MarketSpec): MarketSpecPublic {
  const { raw: _r, ...rest } = spec;
  return rest;
}

export class MarketSpecService {
  private readonly store = new MarketSpecStore();
  private readonly coinex: CoinexMarketSpecProvider;

  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {
    this.coinex = new CoinexMarketSpecProvider(env);
  }

  async getSpec(market: string): Promise<MarketSpec> {
    const { spec } = await this.getSpecWithFetchedAt(market);
    return spec;
  }

  async getSpecWithFetchedAt(market: string): Promise<{ spec: MarketSpec; fetchedAtMs: number }> {
    const key = market.toUpperCase();
    const cached = this.store.get(key);
    if (cached) return { spec: cached.spec, fetchedAtMs: cached.fetchedAtMs };

    try {
      const spec = await this.coinex.fetch(key);
      this.store.set(key, spec, this.env.MARKET_SPEC_CACHE_TTL_MS);
      this.maybeEmitSpecUpdated(key);
      if (!spec.apiTradingEnabled) {
        void this.maybeEmitApiTradingDisabled(key);
      }
      return this.store.get(key)!;
    } catch (err) {
      this.log.warn({ err, market: key }, "CoinEx market spec falhou — STATIC_FALLBACK");
      this.maybeEmitSpecError(key, err);
      const spec = buildStaticFallbackSpec(key);
      this.store.set(key, spec, Math.min(this.env.MARKET_SPEC_CACHE_TTL_MS, 60_000));
      return this.store.get(key)!;
    }
  }

  async getSpecPublic(market: string): Promise<MarketSpecPublic> {
    const spec = await this.getSpec(market);
    return toPublic(spec);
  }

  private maybeEmitSpecUpdated(market: string) {
    const now = Date.now();
    const last = lastSpecOkEventMs.get(market) ?? 0;
    if (now - last < SPEC_OK_EVENT_MS) return;
    lastSpecOkEventMs.set(market, now);
    void appendBotEvent("INFO", "MARKET_SPEC_UPDATED", `Market spec CoinEx (${market})`, { market });
  }

  private maybeEmitSpecError(market: string, err: unknown) {
    const now = Date.now();
    const last = lastSpecErrEventMs.get(market) ?? 0;
    if (now - last < SPEC_ERR_EVENT_MS) return;
    lastSpecErrEventMs.set(market, now);
    const msg = err instanceof Error ? err.message : String(err);
    void appendBotEvent("ERROR", "MARKET_SPEC_ERROR", `CoinEx market spec: ${msg}`, { market });
  }

  private maybeEmitApiTradingDisabled(market: string) {
    const now = Date.now();
    const last = lastApiDisabledEventMs.get(market) ?? 0;
    if (now - last < API_DISABLED_EVENT_MS) return;
    lastApiDisabledEventMs.set(market, now);
    void appendBotEvent(
      "WARN",
      "MARKET_API_TRADING_DISABLED",
      `API trading indisponível no mercado ${market} (CoinEx)`,
      { market },
    );
  }
}

let _svc: MarketSpecService | null = null;

export function initMarketSpecService(env: Env, log: FastifyBaseLogger): MarketSpecService {
  _svc = new MarketSpecService(env, log);
  return _svc;
}

export function getMarketSpecService(): MarketSpecService {
  if (!_svc) {
    throw new Error("MarketSpecService not initialized");
  }
  return _svc;
}
