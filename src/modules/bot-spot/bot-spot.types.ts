import { z } from "zod";

export const botSpotStatusSchema = z.enum(["LIVE", "PAUSED", "ERROR", "UNAVAILABLE"]);
export const priceSourceSchema = z.enum(["COINEX", "HYPERLIQUID", "DATABASE", "UNKNOWN"]);
export const fillSourceSchema = z.enum(["COINEX", "DATABASE", "UNKNOWN"]);

export const tradeFillSchema = z.object({
  fillId: z.string(),
  orderId: z.string(),
  cycleId: z.string(),
  side: z.enum(["BUY", "SELL"]),
  market: z.string(),
  price: z.number().finite().positive(),
  qty: z.number().finite().positive(),
  fee: z.number().finite().nonnegative().nullable(),
  feeCurrency: z.string().nullable(),
  source: fillSourceSchema,
  filledAt: z.string(),
});

export const botSpotStateSchema = z.object({
  status: botSpotStatusSchema,
  market: z.string(),
  livePrice: z.number().finite().positive().nullable(),
  priceSource: priceSourceSchema,
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
      status: z.enum(["OPEN", "BUY_PENDING", "BUY_FILLED", "SELL_PENDING", "CLOSED", "ERROR"]),
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
  lastBuyFill: tradeFillSchema.nullable(),
  lastSellFill: tradeFillSchema.nullable(),
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

export const chartIntervalSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);

export const botSpotChartResponseSchema = z.object({
  market: z.string(),
  interval: chartIntervalSchema,
  candles: z.array(
    z.object({
      time: z.number().int().positive(),
      open: z.number().finite().positive(),
      high: z.number().finite().positive(),
      low: z.number().finite().positive(),
      close: z.number().finite().positive(),
      volume: z.number().finite().nonnegative().nullable(),
    }),
  ),
  markers: z.array(
    z.object({
      time: z.number().int().positive(),
      position: z.enum(["aboveBar", "belowBar"]),
      shape: z.enum(["arrowUp", "arrowDown", "circle"]),
      text: z.string(),
      side: z.enum(["BUY", "SELL"]),
      price: z.number().finite().positive(),
      qty: z.number().finite().positive(),
      cycleId: z.string(),
      orderId: z.string(),
    }),
  ),
  lines: z.object({
    nextBuyLevel: z.number().finite().positive().nullable(),
    targetSellPrice: z.number().finite().positive().nullable(),
    avgEntryPrice: z.number().finite().positive().nullable(),
  }),
  unavailable: z
    .object({
      status: z.literal("UNAVAILABLE"),
      reason: z.string(),
    })
    .optional(),
});

export type BotSpotState = z.infer<typeof botSpotStateSchema>;
export type BotSpotChartResponse = z.infer<typeof botSpotChartResponseSchema>;
export type TradeFillDto = z.infer<typeof tradeFillSchema>;
