import type { Env } from "../../config/env.js";
import { coinexV2SignHex } from "../../infrastructure/coinex/coinex-v2-sign.js";

/** JSON estável para assinatura (chaves ordenadas). */
export function stableCoinexJsonBody(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

type CoinexEnvelope<T> = { code: number; message: string; data: T };

export async function coinexSignedPost<T>(
  env: Env,
  signPath: string,
  urlPathSuffix: string,
  bodyObj: Record<string, unknown>,
): Promise<{ httpStatus: number; envelope: CoinexEnvelope<T> | null; rawText: string }> {
  const bodyStr = stableCoinexJsonBody(bodyObj);
  const ts = String(Date.now());
  const sign = coinexV2SignHex(env.COINEX_SECRET_KEY, "POST", signPath, bodyStr, ts);
  const base = env.COINEX_BASE_URL.replace(/\/$/, "");
  const url = `${base}/${urlPathSuffix.replace(/^\//, "")}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-COINEX-KEY": env.COINEX_ACCESS_ID,
        "X-COINEX-SIGN": sign,
        "X-COINEX-TIMESTAMP": ts,
      },
      body: bodyStr,
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
