import { z } from "zod";

export const botSpotStateSchema = z.object({
  status: z.enum(["LIVE", "PAUSED", "ERROR", "UNAVAILABLE"]),
  market: z.string(),
  livePrice: z.number().finite().positive().nullable(),
  priceSource: z.enum(["COINEX", "HYPERLIQUID", "DATABASE", "UNKNOWN"]),
  strategy: z.object({
    name: z.literal("BTC_DROP_2K"),
    enabled: z.boolean(),
    orderQty: z.number().finite().positive(),
    dropStepUsd: z.number().finite().positive(),
    targetProfitPct: z.number().finite().positive(),
  }),
  nextBuyLevel: z.number().finite().positive().nullable(),
  openCycle: z
    .object({
      cycleId: z.string(),
      status: z.string(),
      openedAt: z.string(),
    })
    .nullable(),
  position: z.object({
    qty: z.number().finite().nonnegative(),
    avgEntryPrice: z.number().finite().positive().nullable(),
    notional: z.number().finite().nonnegative().nullable(),
  }),
  targets: z.object({
    sellPrice: z.number().finite().positive().nullable(),
    expectedProfitPct: z.number().finite().nullable(),
  }),
  pnl: z.object({
    realized: z.number().finite().nullable(),
    unrealized: z.number().finite().nullable(),
    currency: z.string(),
  }),
  lastBuyFill: z.unknown().nullable(),
  lastSellFill: z.unknown().nullable(),
  lastReconciledAt: z.string().nullable(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      createdAt: z.string(),
    }),
  ),
});

export const botSpotChartSchema = z.object({
  market: z.string(),
  interval: z.string(),
  candles: z.array(
    z.object({
      time: z.number(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().nullable(),
    }),
  ),
  markers: z.array(z.object({}).passthrough()),
  lines: z.object({
    nextBuyLevel: z.number().nullable(),
    targetSellPrice: z.number().nullable(),
    avgEntryPrice: z.number().nullable(),
  }),
  unavailable: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }).optional(),
});

export type BotSpotState = z.infer<typeof botSpotStateSchema>;
export type BotSpotChart = z.infer<typeof botSpotChartSchema>;
