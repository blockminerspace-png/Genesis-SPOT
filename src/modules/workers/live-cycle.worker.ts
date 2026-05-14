import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { runLiveAutoCycleServiceTick } from "../live-cycle/live-cycle.service.js";

let timer: NodeJS.Timeout | undefined;

export function startLiveAutoCycleWorker(env: Env, log: FastifyBaseLogger): void {
  if (timer) clearInterval(timer);
  const tick = () => {
    void runLiveAutoCycleServiceTick(env, log).catch((err) => {
      log.error({ err }, "live-auto-cycle tick failed");
    });
  };
  timer = setInterval(tick, env.AUTO_LIVE_WORKER_INTERVAL_MS);
  tick();
  log.info({ intervalMs: env.AUTO_LIVE_WORKER_INTERVAL_MS }, "live auto cycle worker started");
}

/** Alias pedido na documentação da Fase 1.7 (`startLiveCycleWorker`). */
export const startLiveCycleWorker = startLiveAutoCycleWorker;

export function stopLiveAutoCycleWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
