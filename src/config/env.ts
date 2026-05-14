import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Endereço de bind (ex.: 127.0.0.1 = só máquina local; 0.0.0.0 = todas as interfaces). */
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().url(),

  COINEX_BASE_URL: z.string().url().default("https://api.coinex.com/v2"),
  COINEX_ACCESS_ID: z.string().optional().default(""),
  COINEX_SECRET_KEY: z.string().optional().default(""),

  MARKET_DATA_SOURCE: z.enum(["SIMULATED", "COINEX"]).default("SIMULATED"),
  /** TTL do cache em memória do ticker (CoinEx ou fallback). */
  MARKET_DATA_CACHE_TTL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),

  /** TTL do cache em memória do market spec (precisão / mínimos / fees). */
  MARKET_SPEC_CACHE_TTL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(120_000),

  /** Saldo no painel/API: simulado, CoinEx read-only, ou ambos. O motor em DRY_RUN usa sempre o store simulado. */
  PORTFOLIO_BALANCE_SOURCE: z.enum(["SIMULATED", "COINEX", "BOTH"]).default("SIMULATED"),
  /** Cache do snapshot CoinEx em GET /portfolio/balance. */
  PORTFOLIO_BALANCE_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(120_000).default(5_000),

  /** Travas Fase 1.6: ordem real só se true no .env + LIVE no Postgres + confirmação API. */
  ENABLE_LIVE_TRADING: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Mercados permitidos para LIVE (CSV, maiúsculas). */
  LIVE_MARKET_ALLOWLIST: z.string().default("BTCUSDC"),
  LIVE_MAX_ORDER_QUOTE_VALUE: z.coerce.string().default("10"),
  LIVE_MAX_DAILY_QUOTE_VOLUME: z.coerce.string().default("50"),
  LIVE_REQUIRE_MAKER_ONLY: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  LIVE_BALANCE_MAX_AGE_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
  LIVE_MARKET_DATA_MAX_AGE_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  LIVE_MARKET_SPEC_MAX_AGE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  /** Teto extra para POST /orders/live-test (quote). */
  LIVE_TEST_MAX_QUOTE_VALUE: z.coerce.string().default("5"),

  /** Fase 1.7: worker automático LIVE (ciclos reais). Por omissão desligado. */
  ENABLE_AUTO_LIVE_WORKER: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  AUTO_LIVE_WORKER_INTERVAL_MS: z.coerce.number().int().min(3_000).max(120_000).default(8000),
  /** Teto em quote por ciclo Auto LIVE (USDT/USDC conforme par); comparado com `LIVE_MAX_ORDER_QUOTE_VALUE`. */
  AUTO_LIVE_ORDER_QUOTE_VALUE: z.coerce.string().default("1"),
  /**
   * Legado: o Auto LIVE usa `target_profit_pct` de `bot_configs` (Parâmetros) na venda.
   * Mantido no schema para compatibilidade com `.env` antigos.
   */
  AUTO_LIVE_TARGET_PROFIT_PCT: z.coerce.string().default("0.02"),
  /**
   * Deve ser exatamente `I_UNDERSTAND_THIS_BOT_CAN_TRADE_REAL_MONEY` para o Auto LIVE operar.
   * Vazio por omissão (worker não opera até configurar conscientemente).
   */
  AUTO_LIVE_CONFIRM_ENV: z.string().default(""),
  /** Se vazio, usa `market` do Postgres (`bot_configs`). Senão, este par (ex.: BTCUSDC) com `LIVE_MARKET_ALLOWLIST`. */
  AUTO_LIVE_MARKET: z.string().max(32).optional().default(""),
  /** Exige que o reconciliador LIVE tenha completado um tick saudável há pouco tempo. */
  AUTO_LIVE_MIN_RECONCILIATION_SUCCESS_AGE_MS: z.coerce.number().int().min(5_000).max(600_000).default(20_000),
  AUTO_LIVE_MAX_OPEN_CYCLES: z.coerce.number().int().min(1).max(20).default(1),
  AUTO_LIVE_COOLDOWN_MS: z.coerce.number().int().min(0).max(3_600_000).default(60_000),
  AUTO_LIVE_REQUIRE_SELL_AFTER_BUY: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  AUTO_LIVE_ALLOW_NEW_BUY_WITH_OPEN_SELL: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  AUTO_LIVE_MAX_CONSECUTIVE_ERRORS: z.coerce.number().int().min(1).max(50).default(3),
  AUTO_LIVE_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  /** Bloqueia Auto LIVE se existir BALANCE_DRIFT_DETECTED nos eventos nesta janela (ms). */
  AUTO_LIVE_BALANCE_DRIFT_LOOKBACK_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(300_000),
  /** Ordem LIVE aberta: se `updatedAt` mais velho que isto, reconciliação considerada atrasada. */
  AUTO_LIVE_MAX_ORDER_STALE_MS: z.coerce.number().int().min(10_000).max(600_000).default(45_000),

  DRY_RUN: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  BOT_MARKET: z.string().default("BTCUSDC"),
  BOT_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  BOT_ORDER_QUOTE_SIZE: z.coerce.string().default("50"),
  BOT_TARGET_PROFIT_PCT: z.coerce.string().default("0.02"),
  BOT_GRID_STEP_PCT: z.coerce.string().default("0.01"),

  BOT_MAX_OPEN_CYCLES: z.coerce.number().int().nonnegative().default(10),
  BOT_MAX_QUOTE_ALLOCATION: z.coerce.string().default("500"),
  BOT_MIN_QUOTE_BALANCE: z.coerce.string().default("50"),

  BOT_FEE_BUFFER_PCT: z.coerce.string().default("0.002"),
  BOT_PRICE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  BOT_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const merged = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}
