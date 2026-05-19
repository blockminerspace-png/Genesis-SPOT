import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { Decimal } from "../../shared/decimal.js";
import { floorPrice } from "../market-data/market-spec.rounding.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";
import { appendBotEvent } from "./bot-control.service.js";
import {
  btcDropNextBuyFromAnchor,
  readBtcDropConfig,
} from "./btc-drop.strategy.js";
import type { BtcDropStateRow, BtcDropStateView } from "./btc-drop.types.js";
import { btcDropQuoteValue } from "./btc-drop.strategy.js";

function flooredLast(lastPrice: string, spec: MarketSpec): string {
  return floorPrice(new Decimal(lastPrice), spec).toFixed(spec.quotePrecision);
}

function rowToView(row: {
  market: string;
  anchorPrice: { toString(): string };
  nextBuyPrice: { toString(): string };
  stepUsdt: { toString(): string };
  baseAmount: { toString(): string };
  initialized: boolean;
  updatedAt: Date;
}, cfg: ReturnType<typeof readBtcDropConfig>, spec: MarketSpec | null): BtcDropStateView {
  const base: BtcDropStateRow = {
    market: row.market,
    anchorPrice: row.anchorPrice.toString(),
    nextBuyPrice: row.nextBuyPrice.toString(),
    stepUsdt: row.stepUsdt.toString(),
    baseAmount: row.baseAmount.toString(),
    initialized: row.initialized,
    updatedAt: row.updatedAt.toISOString(),
  };
  let estimatedQuoteValueAtNextBuy: string | null = null;
  if (spec) {
    try {
      estimatedQuoteValueAtNextBuy = btcDropQuoteValue(base.baseAmount, base.nextBuyPrice, spec);
    } catch {
      estimatedQuoteValueAtNextBuy = null;
    }
  }
  return {
    ...base,
    enabled: cfg.enabled,
    targetProfitPct: cfg.targetProfitPct,
    estimatedQuoteValueAtNextBuy,
  };
}

export async function getBtcDropStateView(env: Env, spec: MarketSpec | null): Promise<BtcDropStateView | null> {
  const cfg = readBtcDropConfig(env);
  if (!cfg.enabled) return null;
  const row = await prisma.btcDropStrategyState.findUnique({ where: { market: cfg.market } });
  if (!row) return null;
  return rowToView(row, cfg, spec);
}

export type EnsureBtcDropStateResult = {
  state: BtcDropStateRow;
  justInitialized: boolean;
};

/** Garante linha de estado; no primeiro tick só inicializa níveis (sem compra). */
export async function ensureBtcDropState(
  env: Env,
  lastPrice: string,
  spec: MarketSpec,
): Promise<EnsureBtcDropStateResult> {
  const cfg = readBtcDropConfig(env);
  const m = cfg.market;
  const last = flooredLast(lastPrice, spec);
  const existing = await prisma.btcDropStrategyState.findUnique({ where: { market: m } });
  if (existing) {
    return {
      state: {
        market: existing.market,
        anchorPrice: existing.anchorPrice.toString(),
        nextBuyPrice: existing.nextBuyPrice.toString(),
        stepUsdt: existing.stepUsdt.toString(),
        baseAmount: existing.baseAmount.toString(),
        initialized: existing.initialized,
        updatedAt: existing.updatedAt.toISOString(),
      },
      justInitialized: false,
    };
  }

  const anchor = last;
  const nextBuy = btcDropNextBuyFromAnchor(anchor, cfg.stepUsdt, spec);
  const created = await prisma.btcDropStrategyState.create({
    data: {
      market: m,
      anchorPrice: anchor,
      nextBuyPrice: nextBuy,
      stepUsdt: cfg.stepUsdt,
      baseAmount: cfg.baseAmount,
      initialized: false,
    },
  });
  await appendBotEvent("INFO", "BTC_DROP_STATE_INITIALIZED", `${m}: anchor=${anchor} próxima compra≤${nextBuy}`, {
    market: m,
    anchorPrice: anchor,
    nextBuyPrice: nextBuy,
    stepUsdt: cfg.stepUsdt,
    baseAmount: cfg.baseAmount,
  });

  return {
    state: {
      market: created.market,
      anchorPrice: created.anchorPrice.toString(),
      nextBuyPrice: created.nextBuyPrice.toString(),
      stepUsdt: created.stepUsdt.toString(),
      baseAmount: created.baseAmount.toString(),
      initialized: created.initialized,
      updatedAt: created.updatedAt.toISOString(),
    },
    justInitialized: true,
  };
}

/** Marca estado pronto para compras após o primeiro tick de inicialização. */
export async function armBtcDropStateAfterInit(market: string): Promise<void> {
  await prisma.btcDropStrategyState.updateMany({
    where: { market: market.toUpperCase(), initialized: false },
    data: { initialized: true },
  });
}

export async function countBtcDropOpenCycles(market: string): Promise<number> {
  const terminal = ["CLOSED_PROFIT", "CANCELLED", "ERROR", "MANUAL_REVIEW"] as const;
  return prisma.tradeCycle.count({
    where: {
      market: market.toUpperCase(),
      isLiveAutoWorker: true,
      status: { notIn: [...terminal] },
    },
  });
}

/** Sobe anchor quando não há ciclos abertos (modo LAST_HIGH). */
export async function maybeBumpBtcDropAnchor(
  env: Env,
  lastPrice: string,
  spec: MarketSpec,
): Promise<BtcDropStateRow | null> {
  const cfg = readBtcDropConfig(env);
  if (cfg.anchorMode !== "LAST_HIGH") return null;
  const m = cfg.market;
  const open = await countBtcDropOpenCycles(m);
  if (open > 0) return null;

  const row = await prisma.btcDropStrategyState.findUnique({ where: { market: m } });
  if (!row) return null;

  const last = flooredLast(lastPrice, spec);
  if (!new Decimal(last).gt(new Decimal(row.anchorPrice.toString()))) return null;

  const nextBuy = btcDropNextBuyFromAnchor(last, cfg.stepUsdt, spec);
  const updated = await prisma.btcDropStrategyState.update({
    where: { market: m },
    data: { anchorPrice: last, nextBuyPrice: nextBuy },
  });
  await appendBotEvent("INFO", "BTC_DROP_ANCHOR_UPDATED", `${m}: pico=${last} próxima≤${nextBuy}`, {
    market: m,
    anchorPrice: last,
    nextBuyPrice: nextBuy,
  });
  return {
    market: updated.market,
    anchorPrice: updated.anchorPrice.toString(),
    nextBuyPrice: updated.nextBuyPrice.toString(),
    stepUsdt: updated.stepUsdt.toString(),
    baseAmount: updated.baseAmount.toString(),
    initialized: updated.initialized,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function advanceBtcDropLevelAfterBuy(market: string, stepUsdt: string, spec: MarketSpec): Promise<string> {
  const m = market.toUpperCase();
  const row = await prisma.btcDropStrategyState.findUnique({ where: { market: m } });
  if (!row) throw new Error(`BTC drop state missing for ${m}`);
  const prev = row.nextBuyPrice.toString();
  const next = btcDropNextBuyFromAnchor(prev, stepUsdt, spec);
  await prisma.btcDropStrategyState.update({
    where: { market: m },
    data: { nextBuyPrice: next },
  });
  await appendBotEvent("INFO", "BTC_DROP_NEXT_LEVEL_UPDATED", `${m}: próximo nível≤${next}`, {
    market: m,
    previousLevel: prev,
    nextBuyPrice: next,
  });
  return next;
}

export async function resetBtcDropState(
  env: Env,
  lastPrice: string,
  spec: MarketSpec,
  forceWithOpenCycles: boolean,
): Promise<{ ok: true; state: BtcDropStateView } | { ok: false; error: string }> {
  const cfg = readBtcDropConfig(env);
  const m = cfg.market;
  const open = await countBtcDropOpenCycles(m);
  if (open > 0 && !forceWithOpenCycles) {
    return {
      ok: false,
      error: `${open} ciclo(s) aberto(s). Envie confirm: RESET_BTC_DROP_WITH_OPEN_CYCLES para forçar.`,
    };
  }

  const anchor = flooredLast(lastPrice, spec);
  const nextBuy = btcDropNextBuyFromAnchor(anchor, cfg.stepUsdt, spec);
  const row = await prisma.btcDropStrategyState.upsert({
    where: { market: m },
    create: {
      market: m,
      anchorPrice: anchor,
      nextBuyPrice: nextBuy,
      stepUsdt: cfg.stepUsdt,
      baseAmount: cfg.baseAmount,
      initialized: false,
    },
    update: {
      anchorPrice: anchor,
      nextBuyPrice: nextBuy,
      stepUsdt: cfg.stepUsdt,
      baseAmount: cfg.baseAmount,
      initialized: false,
    },
  });

  await appendBotEvent("INFO", "BTC_DROP_STATE_RESET", `${m}: anchor=${anchor} próxima≤${nextBuy}`, {
    market: m,
    anchorPrice: anchor,
    nextBuyPrice: nextBuy,
    forcedWithOpenCycles: forceWithOpenCycles,
  });

  return { ok: true, state: rowToView(row, cfg, spec) };
}
