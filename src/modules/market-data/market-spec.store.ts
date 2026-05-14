import type { MarketSpec } from "./market-spec.types.js";

type Entry = { spec: MarketSpec; expiresAt: number; fetchedAtMs: number };

export class MarketSpecStore {
  private readonly data = new Map<string, Entry>();

  get(market: string): { spec: MarketSpec; fetchedAtMs: number } | null {
    const key = market.toUpperCase();
    const hit = this.data.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return { spec: hit.spec, fetchedAtMs: hit.fetchedAtMs };
  }

  set(market: string, spec: MarketSpec, ttlMs: number): void {
    const key = market.toUpperCase();
    const fetchedAtMs = Date.now();
    this.data.set(key, { spec, expiresAt: Date.now() + ttlMs, fetchedAtMs });
  }

  invalidate(market: string): void {
    this.data.delete(market.toUpperCase());
  }
}
