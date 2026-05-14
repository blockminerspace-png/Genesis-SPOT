import type { Env } from "../../config/env.js";
import type { Logger } from "../../shared/logger.js";

/**
 * CoinEx v2 client shell — signing and real HTTP calls come in Fase 2.
 */
export class CoinExClient {
  constructor(
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  get baseUrl(): string {
    return this.env.COINEX_BASE_URL;
  }

  isConfigured(): boolean {
    return Boolean(this.env.COINEX_ACCESS_ID && this.env.COINEX_SECRET_KEY);
  }

  async healthPing(): Promise<{ ok: boolean; configured: boolean }> {
    this.log.debug({ op: "coinex.healthPing" }, "stub");
    return { ok: true, configured: this.isConfigured() };
  }
}
