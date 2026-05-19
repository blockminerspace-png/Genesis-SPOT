import type { Env } from "../../config/env.js";
import { readBtcDropConfig } from "../strategy/btc-drop.types.js";

export type StrategyValidation =
  | { ok: true; cfg: ReturnType<typeof readBtcDropConfig> }
  | { ok: false; errors: string[] };

function parsePositive(s: string, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(String(s).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `${label} inválido (deve ser > 0)` };
  }
  return { ok: true, value: n };
}

export function validateBtcDropStrategyEnv(env: Env): StrategyValidation {
  const errors: string[] = [];
  const cfg = readBtcDropConfig(env);

  if (!cfg.market || cfg.market.length < 4) {
    errors.push("BTC_STRATEGY_MARKET inválido");
  }

  const qty = parsePositive(cfg.baseAmount, "BTC_ORDER_BASE_AMOUNT");
  if (!qty.ok) errors.push(qty.error);

  const step = parsePositive(cfg.stepUsdt, "BTC_DROP_BUY_STEP_USDT");
  if (!step.ok) errors.push(step.error);

  const tp = parsePositive(cfg.targetProfitPct, "BTC_TARGET_PROFIT_PCT");
  if (!tp.ok) errors.push(tp.error);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, cfg };
}

export function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function finitePositiveOrNull(v: unknown): number | null {
  const n = finiteOrNull(v);
  if (n === null || n <= 0) return null;
  return n;
}
