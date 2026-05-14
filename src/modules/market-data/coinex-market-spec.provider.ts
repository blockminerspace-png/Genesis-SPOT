import type { Env } from "../../config/env.js";
import type { MarketSpec } from "./market-spec.types.js";

type CoinexListResponse = { code: number; message: string; data: Array<Record<string, unknown>> };

function normalizeBasePrecision(raw: number): number {
  if (Number.isFinite(raw) && raw > 0) return Math.min(18, Math.floor(raw));
  return 8;
}

function normalizeQuotePrecision(quoteCcy: string, raw: number): number {
  if (Number.isFinite(raw) && raw > 0) return Math.min(18, Math.floor(raw));
  const q = quoteCcy.toUpperCase();
  if (q === "USDT" || q === "USDC" || q === "USD") return 2;
  return 8;
}

function mapRow(row: Record<string, unknown>, marketKey: string): MarketSpec {
  const market = String(row.market ?? marketKey).toUpperCase();
  const baseCurrency = String(row.base_ccy ?? "");
  const quoteCurrency = String(row.quote_ccy ?? "");
  const basePrecision = normalizeBasePrecision(Number(row.base_ccy_precision));
  const quotePrecision = normalizeQuotePrecision(quoteCurrency, Number(row.quote_ccy_precision));
  const minAmount = String(row.min_amount ?? "0");
  const minValueRaw = row.min_value;
  const minValue =
    minValueRaw === undefined || minValueRaw === null || minValueRaw === ""
      ? null
      : String(minValueRaw);
  const makerFeeRate = String(row.maker_fee_rate ?? "0");
  const takerFeeRate = String(row.taker_fee_rate ?? "0");
  const status = String(row.status ?? "").toLowerCase();
  const tradingEnabled = status === "online";
  const apiTradingEnabled = Boolean(row.is_api_trading_available);

  return {
    market,
    baseCurrency,
    quoteCurrency,
    basePrecision,
    quotePrecision,
    minAmount,
    minValue,
    makerFeeRate,
    takerFeeRate,
    tradingEnabled,
    apiTradingEnabled,
    raw: row,
    source: "COINEX",
    updatedAt: new Date().toISOString(),
  };
}

export class CoinexMarketSpecProvider {
  constructor(private readonly env: Env) {}

  private buildUrl(path: string, query: Record<string, string>) {
    const base = this.env.COINEX_BASE_URL.replace(/\/$/, "");
    const u = new URL(`${base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  }

  async fetch(market: string): Promise<MarketSpec> {
    const key = market.toUpperCase();
    const url = this.buildUrl("spot/market", { market: key });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new Error(`CoinEx HTTP ${res.status}`);
    }
    const body = (await res.json()) as CoinexListResponse;
    if (body.code !== 0 || !Array.isArray(body.data) || body.data.length === 0) {
      throw new Error(body.message || "CoinEx market inválido");
    }
    return mapRow(body.data[0], key);
  }
}
