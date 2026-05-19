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

  /** Genesis SPOT REAL ONLY: ticker só via CoinEx. */
  MARKET_DATA_SOURCE: z.enum(["COINEX"]).default("COINEX"),

  /** TTL do cache em memória do ticker (CoinEx ou fallback). */
  MARKET_DATA_CACHE_TTL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),

  /** TTL do cache em memória do market spec (precisão / mínimos / fees). */
  MARKET_SPEC_CACHE_TTL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(120_000),

  /** Genesis SPOT REAL ONLY: saldo só via CoinEx. */
  PORTFOLIO_BALANCE_SOURCE: z.enum(["COINEX"]).default("COINEX"),
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
  /** Teto por ordem LIVE (quote). Omissão 50: cobre ~0,0001 BTC a ~80k–500k USDC/BTC + margem. */
  LIVE_MAX_ORDER_QUOTE_VALUE: z.coerce.string().default("50"),
  LIVE_MAX_DAILY_QUOTE_VOLUME: z.coerce.string().default("50"),
  LIVE_REQUIRE_MAKER_ONLY: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  LIVE_BALANCE_MAX_AGE_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
  LIVE_MARKET_DATA_MAX_AGE_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  /**
   * Idade máxima do snapshot de spec (mínimos / precisão) para LIVE e Auto LIVE.
   * Deve ser ≥ `MARKET_SPEC_CACHE_TTL_MS` (omissão 120s), senão o worker fica «Bloqueado» só porque o spec ainda está em cache.
   */
  LIVE_MARKET_SPEC_MAX_AGE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(180_000),
  /** Teto extra para POST /orders/live-test (quote). */
  LIVE_TEST_MAX_QUOTE_VALUE: z.coerce.string().default("5"),

  /** Fase 1.7: worker automático LIVE (ciclos reais). Por omissão desligado. */
  ENABLE_AUTO_LIVE_WORKER: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  AUTO_LIVE_WORKER_INTERVAL_MS: z.coerce.number().int().min(3_000).max(120_000).default(8000),
  /** Teto em quote por ciclo Auto LIVE (USDC/USDT conforme par); comparado com `LIVE_MAX_ORDER_QUOTE_VALUE`. */
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

  /** Estratégia BTC Drop 2K (queda absoluta em USDT + lote fixo em BTC). */
  BTC_STRATEGY_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  BTC_STRATEGY_MARKET: z.string().default("BTCUSDT"),
  BTC_DROP_BUY_STEP_USDT: z.coerce.string().default("2000"),
  BTC_ORDER_BASE_AMOUNT: z.coerce.string().default("0.0001"),
  BTC_TARGET_PROFIT_PCT: z.coerce.string().default("0.02"),
  BTC_STRATEGY_ANCHOR_MODE: z.enum(["LAST_HIGH"]).default("LAST_HIGH"),

  /**
   * Protege todas as rotas JSON do dashboard (exceto `/health` e `/auth/*`) com JWT + 2FA por email.
   * Requer `DASHBOARD_JWT_SECRET`, `DASHBOARD_USERS`, SMTP e migração Prisma `dashboard_*`.
   */
  DASHBOARD_AUTH_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Mínimo 32 caracteres quando `DASHBOARD_AUTH_ENABLED`. */
  DASHBOARD_JWT_SECRET: z.string().default(""),
  /** Ex.: `8h`, `15m` (jsonwebtoken expiresIn). */
  DASHBOARD_JWT_EXPIRES_IN: z.string().min(1).default("8h"),
  /** Cookie httpOnly com o JWT (não enviar token no JSON nem em sessionStorage). */
  DASHBOARD_SESSION_COOKIE_NAME: z.string().min(2).max(64).default("genesis_spot_session"),
  /**
   * Utilizadores locais: `email:senha|outro@dominio:senha2` (o primeiro `:` separa email da senha).
   * Senhas em texto no `.env` — protege o ficheiro e o acesso ao host.
   */
  DASHBOARD_USERS: z.string().default(""),

  DASHBOARD_OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  DASHBOARD_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  DASHBOARD_PASSWORD_MAX_FAILS: z.coerce.number().int().min(3).max(30).default(5),
  DASHBOARD_LOCKOUT_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),

  /** Rejeita chamadas à API com `Sec-Fetch-Dest: document` (abrir `/bot/...` diretamente no browser). */
  DASHBOARD_BLOCK_DOCUMENT_NAV: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  DASHBOARD_AUTH_RATE_MAX: z.coerce.number().int().min(5).max(500).default(40),
  DASHBOARD_AUTH_RATE_WINDOW_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),

  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  DASHBOARD_2FA_EMAIL_SUBJECT: z.string().min(1).default("Genesis SPOT — código de acesso"),
  /**
   * Opcional: para onde enviar o código 2FA por utilizador de login.
   * Formato `loginNorm:emailDestino|...` (loginNorm = mesmo texto que em DASHBOARD_USERS antes do `:`, em minúsculas).
   * Ex.: `jamanta:gustavo.empresarial.br@gmail.com` — SMTP continua a ser o da Hostinger; só o campo `To` muda.
   */
  DASHBOARD_2FA_DELIVER_MAP: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const merged = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  const data = parsed.data;
  if (data.DASHBOARD_AUTH_ENABLED) {
    if (data.DASHBOARD_JWT_SECRET.length < 32) {
      throw new Error("DASHBOARD_AUTH_ENABLED exige DASHBOARD_JWT_SECRET com pelo menos 32 caracteres.");
    }
    const hasUser = data.DASHBOARD_USERS.split("|").some((s) => s.includes(":") && s.trim().length > 3);
    if (!hasUser) {
      throw new Error("DASHBOARD_AUTH_ENABLED exige DASHBOARD_USERS (formato email:senha|...).");
    }
    const smtpConsole = data.SMTP_HOST.trim().toLowerCase() === "console";
    if (!smtpConsole && (!data.SMTP_HOST.trim() || !data.SMTP_FROM.trim())) {
      throw new Error(
        "DASHBOARD_AUTH_ENABLED exige SMTP_HOST e SMTP_FROM para enviar o código 2FA, ou SMTP_HOST=console para imprimir o código nos logs (só desenvolvimento).",
      );
    }
    if (smtpConsole && !data.SMTP_FROM.trim()) {
      throw new Error("Com SMTP_HOST=console define SMTP_FROM (ex.: noreply@local) para metadados nos logs.");
    }
  }
  return data;
}
