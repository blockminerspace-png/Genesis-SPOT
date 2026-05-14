import type { Env } from "../../config/env.js";
import { coinexV2SignHex } from "./coinex-v2-sign.js";

type CoinexEnvelope<T> = { code: number; message: string; data: T; pagination?: { has_next?: boolean } };

/** Query string estável: chaves ordenadas (assinatura CoinEx v2 GET). */
export function stableSortedQueryString(params: Record<string, string | number>): string {
  const keys = Object.keys(params).sort();
  const usp = new URLSearchParams();
  for (const k of keys) {
    usp.set(k, String(params[k]));
  }
  return usp.toString();
}

/**
 * GET assinado CoinEx v2.
 * @param pathNoV2 — ex.: `spot/order-status` (sem prefixo /v2)
 */
export async function coinexSignedGet<T>(
  env: Env,
  pathNoV2: string,
  query: Record<string, string | number>,
): Promise<{ httpStatus: number; envelope: CoinexEnvelope<T> | null; rawText: string }> {
  const cleanPath = pathNoV2.replace(/^\/+/, "");
  const qs = stableSortedQueryString(query);
  const rel = qs ? `${cleanPath}?${qs}` : cleanPath;
  const signPath = `/v2/${rel}`;
  const ts = String(Date.now());
  const sign = coinexV2SignHex(env.COINEX_SECRET_KEY, "GET", signPath, "", ts);
  const base = env.COINEX_BASE_URL.replace(/\/$/, "");
  const url = `${base}/${rel}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: {
        Accept: "application/json",
        "X-COINEX-KEY": env.COINEX_ACCESS_ID,
        "X-COINEX-SIGN": sign,
        "X-COINEX-TIMESTAMP": ts,
      },
    });
  } finally {
    clearTimeout(timer);
  }

  const rawText = await res.text();
  let envelope: CoinexEnvelope<T> | null = null;
  try {
    envelope = JSON.parse(rawText) as CoinexEnvelope<T>;
  } catch {
    envelope = null;
  }
  return { httpStatus: res.status, envelope, rawText };
}
