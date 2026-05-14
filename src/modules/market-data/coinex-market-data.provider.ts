import type { Env } from "../../config/env.js";
import type { MarketDataProvider } from "./market-data-provider.interface.js";

type CoinexListResponse<T> = { code: number; message: string; data: T };

export class CoinexMarketDataProvider implements MarketDataProvider {
  readonly id = "coinex" as const;

  constructor(private readonly env: Env) {}

  private buildUrl(path: string, query: Record<string, string>) {
    const base = this.env.COINEX_BASE_URL.replace(/\/$/, "");
    const u = new URL(`${base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  }

  async fetchTicker(market: string) {
    const key = market.toUpperCase();
    const url = this.buildUrl("spot/ticker", { market: key });
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
    const body = (await res.json()) as CoinexListResponse<Array<Record<string, unknown>>>;
    if (body.code !== 0 || !Array.isArray(body.data) || body.data.length === 0) {
      throw new Error(body.message || "CoinEx ticker inválido");
    }
    const row = body.data[0];
    const last = String(row.last ?? row.close ?? "");
    if (!last) {
      throw new Error("CoinEx ticker sem campo last");
    }
    return {
      market: String(row.market ?? key),
      last,
      updatedAt: new Date().toISOString(),
      coinexRaw: row,
    };
  }
}
