import type { Env } from "../../config/env.js";
import { coinexV2SignHex } from "../../infrastructure/coinex/coinex-v2-sign.js";
import { Decimal } from "../../shared/decimal.js";
import type { AssetBalance } from "./balance.types.js";

const SPOT_BALANCE_SIGN_PATH = "/v2/assets/spot/balance";

type CoinexListResponse<T> = { code: number; message: string; data: T };

function mapRow(r: Record<string, unknown>): AssetBalance {
  const ccy = String(r.ccy ?? "");
  const available = String(r.available ?? "0");
  const frozen = String(r.frozen ?? "0");
  const a = new Decimal(available);
  const f = new Decimal(frozen);
  return {
    asset: ccy,
    available,
    frozen,
    total: a.plus(f).toFixed(),
  };
}

export class CoinexBalanceProvider {
  constructor(private readonly env: Env) {}

  hasKeys(): boolean {
    return Boolean(this.env.COINEX_ACCESS_ID && this.env.COINEX_SECRET_KEY);
  }

  async fetchSpotBalances(): Promise<{ balances: AssetBalance[]; raw: unknown }> {
    if (!this.hasKeys()) {
      throw new Error("missing_api_keys");
    }
    const ts = String(Date.now());
    const sign = coinexV2SignHex(this.env.COINEX_SECRET_KEY, "GET", SPOT_BALANCE_SIGN_PATH, "", ts);
    const base = this.env.COINEX_BASE_URL.replace(/\/$/, "");
    const url = `${base}/assets/spot/balance`;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        signal: ac.signal,
        headers: {
          Accept: "application/json",
          "X-COINEX-KEY": this.env.COINEX_ACCESS_ID,
          "X-COINEX-SIGN": sign,
          "X-COINEX-TIMESTAMP": ts,
        },
      });
    } finally {
      clearTimeout(t);
    }

    const body = (await res.json().catch(() => ({}))) as CoinexListResponse<Array<Record<string, unknown>>> & {
      message?: string;
    };

    if (!res.ok) {
      const msg = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { httpStatus?: number; coinexCode?: number };
      err.httpStatus = res.status;
      err.coinexCode = body.code;
      throw err;
    }

    if (body.code !== 0 || !Array.isArray(body.data)) {
      const err = new Error(body.message || "CoinEx balance inválido") as Error & { coinexCode?: number };
      err.coinexCode = body.code;
      throw err;
    }

    return {
      balances: body.data.map((row) => mapRow(row)),
      raw: body.data,
    };
  }
}
