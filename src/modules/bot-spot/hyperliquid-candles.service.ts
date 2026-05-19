import type { Env } from "../../config/env.js";

const HL_INFO = "https://api.hyperliquid.xyz/info";
const CACHE_TTL_MS = 15_000;

type HlCandle = {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
};

type CacheEntry = { at: number; candles: HlCandle[] };

const cache = new Map<string, CacheEntry>();

export function resolveHyperliquidCoinSymbol(market: string): string {
  const m = market.toUpperCase();
  if (m.startsWith("BTC")) return "BTC";
  if (m.startsWith("ETH")) return "ETH";
  if (m.startsWith("SOL")) return "SOL";
  if (m.startsWith("BNB")) return "BNB";
  return m.replace(/USDT$|USDC$|USD$/, "") || "BTC";
}

export async function fetchHyperliquidCandles(
  _env: Env,
  market: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<{ ok: true; candles: HlCandle[] } | { ok: false; reason: string }> {
  const coin = resolveHyperliquidCoinSymbol(market);
  const key = `${coin}:${interval}:${startTime}:${endTime}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ok: true, candles: hit.candles };
  }

  try {
    const res = await fetch(HL_INFO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval, startTime, endTime },
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: `Hyperliquid HTTP ${res.status}` };
    }
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) {
      return { ok: false, reason: "Hyperliquid resposta inválida" };
    }
    const candles = raw as HlCandle[];
    cache.set(key, { at: Date.now(), candles });
    return { ok: true, candles };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function mapHlCandles(candles: HlCandle[]) {
  return candles
    .map((c) => {
      const open = Number(c.o);
      const high = Number(c.h);
      const low = Number(c.l);
      const close = Number(c.c);
      const vol = Number(c.v);
      if (![open, high, low, close].every((x) => Number.isFinite(x) && x > 0)) return null;
      return {
        time: c.t,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(vol) && vol >= 0 ? vol : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.time - b.time);
}
