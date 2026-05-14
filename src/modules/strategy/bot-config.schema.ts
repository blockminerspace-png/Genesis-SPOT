import { z } from "zod";

const decStr = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "número decimal inválido");

export const patchBotConfigBodySchema = z
  .object({
    market: z.string().min(1).max(32).optional(),
    orderQuoteSize: decStr.optional(),
    targetProfitPct: decStr.optional(),
    gridStepPct: decStr.optional(),
    maxOpenCycles: z.coerce.number().int().min(0).max(50_000).optional(),
    maxQuoteAllocation: decStr.optional(),
    minQuoteBalance: decStr.optional(),
    feeBufferPct: decStr.optional(),
  })
  .strict();

export type PatchBotConfigBody = z.infer<typeof patchBotConfigBodySchema>;

export const postBotStartBodySchema = z
  .object({
    mode: z.enum(["DRY_RUN", "LIVE"]).default("DRY_RUN"),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.mode === "LIVE" && val.confirm !== "ENABLE_LIVE_TRADING") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LIVE exige confirm: "ENABLE_LIVE_TRADING" no JSON',
        path: ["confirm"],
      });
    }
  });

export type PostBotStartBody = z.infer<typeof postBotStartBodySchema>;

export const postBotModeLiveBodySchema = z
  .object({
    confirm: z.literal("ENABLE_LIVE_TRADING"),
  })
  .strict();

export type PostBotModeLiveBody = z.infer<typeof postBotModeLiveBodySchema>;
