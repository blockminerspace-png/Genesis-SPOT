import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { getBotConfigView } from "../../modules/strategy/bot-config.service.js";
import { buildRealOnlyOperationalStatus } from "../../modules/operational/real-only-status.service.js";
import { getRuntimeStateService } from "../../modules/runtime/runtime-state.service.js";
import {
  appendBotEvent,
  patchBotConfigRow,
  updateBotRuntimeState,
} from "../../modules/strategy/bot-control.service.js";
import {
  patchBotConfigBodySchema,
  postBotStartBodySchema,
  postBotModeLiveBodySchema,
} from "../../modules/strategy/bot-config.schema.js";
import type { Prisma } from "@prisma/client";
import {
  RESET_TRADING_DATA_CONFIRM,
  resetAllTradingData,
} from "../../modules/admin/trading-data-reset.service.js";

export async function botRoutes(app: FastifyInstance, env: Env) {
  app.get("/config", async (_request, reply) => {
    const body = await getBotConfigView(env);
    return reply.send(body);
  });

  app.get("/operational-status", async (_request, reply) => {
    const row = await getRuntimeStateService().getBotConfigRow();
    const operational = buildRealOnlyOperationalStatus(env, {
      runtimeStatus: row.runtimeStatus,
      executionMode: row.executionMode,
      market: row.market,
    });
    return reply.send(operational);
  });

  app.patch("/config", async (request, reply) => {
    const parsed = patchBotConfigBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido", details: parsed.error.flatten() });
    }
    const p = parsed.data;
    if (Object.keys(p).length === 0) {
      return reply.code(400).send({ error: "nenhum campo para atualizar" });
    }

    const data: Prisma.BotConfigUpdateInput = {};
    if (p.market !== undefined) data.market = p.market;
    if (p.orderQuoteSize !== undefined) data.orderQuoteSize = p.orderQuoteSize;
    if (p.targetProfitPct !== undefined) data.targetProfitPct = p.targetProfitPct;
    if (p.gridStepPct !== undefined) data.gridStepPct = p.gridStepPct;
    if (p.maxOpenCycles !== undefined) data.maxOpenCycles = p.maxOpenCycles;
    if (p.maxQuoteAllocation !== undefined) data.maxQuoteAllocation = p.maxQuoteAllocation;
    if (p.minQuoteBalance !== undefined) data.minQuoteBalance = p.minQuoteBalance;
    if (p.feeBufferPct !== undefined) data.feeBufferPct = p.feeBufferPct;

    const updated = await patchBotConfigRow(data, "Parâmetros do bot atualizados via painel", {
      fields: Object.keys(p),
    });
    return reply.send({ ok: true, config: updated });
  });

  app.post("/start", async (request, reply) => {
    const parsed = postBotStartBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido", details: parsed.error.flatten() });
    }
    if (!env.ENABLE_LIVE_TRADING) {
      await appendBotEvent("WARN", "LIVE_BLOCKED_ENV", "POST /bot/start com ENABLE_LIVE_TRADING=false", {});
      return reply.code(400).send({ error: "ENABLE_LIVE_TRADING=false no .env" });
    }
    if (!env.COINEX_ACCESS_ID || !env.COINEX_SECRET_KEY) {
      await appendBotEvent("WARN", "LIVE_BLOCKED_MISSING_KEYS", "POST /bot/start sem chaves CoinEx", {});
      return reply
        .code(400)
        .send({ error: "LIVE exige COINEX_ACCESS_ID e COINEX_SECRET_KEY no .env" });
    }
    const row = await updateBotRuntimeState(
      { runtimeStatus: "RUNNING", executionMode: "LIVE" },
      { via: "POST /bot/start" },
    );
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/stop", async (_request, reply) => {
    const row = await updateBotRuntimeState({ runtimeStatus: "OFF" }, { via: "POST /bot/stop" });
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/kill-switch", async (_request, reply) => {
    const row = await updateBotRuntimeState(
      { runtimeStatus: "KILL_SWITCH" },
      {
        via: "POST /bot/kill-switch",
        note: "Cancelamento CoinEx ainda não implementado nesta fase.",
      },
    );
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/mode/live", async (request, reply) => {
    const parsed = postBotModeLiveBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload inválido", details: parsed.error.flatten() });
    }
    if (!env.ENABLE_LIVE_TRADING) {
      await appendBotEvent("WARN", "LIVE_BLOCKED_ENV", "POST /bot/mode/live com ENABLE_LIVE_TRADING=false", {});
      return reply.code(400).send({ error: "ENABLE_LIVE_TRADING=false no .env" });
    }
    if (!env.COINEX_ACCESS_ID || !env.COINEX_SECRET_KEY) {
      await appendBotEvent("WARN", "LIVE_BLOCKED_MISSING_KEYS", "POST /bot/mode/live sem chaves CoinEx", {});
      return reply
        .code(400)
        .send({ error: "LIVE exige COINEX_ACCESS_ID e COINEX_SECRET_KEY no .env" });
    }
    const row = await updateBotRuntimeState(
      { executionMode: "LIVE", runtimeStatus: "RUNNING" },
      { via: "POST /bot/mode/live" },
    );
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/pause-buys", async (_request, reply) => {
    const row = await updateBotRuntimeState({ runtimeStatus: "PAUSED_BUYS" }, { via: "POST /bot/pause-buys" });
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/sell-only", async (_request, reply) => {
    const row = await updateBotRuntimeState({ runtimeStatus: "SELL_ONLY" }, { via: "POST /bot/sell-only" });
    return reply.send({
      ok: true,
      runtimeStatus: row?.runtimeStatus,
      executionMode: row?.executionMode,
      enabled: row?.enabled,
    });
  });

  app.post("/reset-trading-data", async (request, reply) => {
    const body = (request.body ?? {}) as {
      confirm?: string;
      bootstrapBuy?: boolean;
      stopMotor?: boolean;
    };
    if (body.confirm !== RESET_TRADING_DATA_CONFIRM) {
      return reply.code(400).send({
        ok: false,
        error: `Confirmação obrigatória: envie { "confirm": "${RESET_TRADING_DATA_CONFIRM}" }`,
      });
    }

    const result = await resetAllTradingData(env, request.log, {
      bootstrapBuy: body.bootstrapBuy,
      stopMotor: body.stopMotor,
    });
    const { bootstrap, ...counts } = result;
    const bootMsg =
      bootstrap?.attempted && bootstrap.ok
        ? " Compra inicial a mercado enviada."
        : bootstrap?.attempted && !bootstrap.ok
          ? ` Compra inicial não executada: ${bootstrap.message}`
          : "";
    const motorMsg = body.stopMotor ? " Motor desligado (OFF)." : " Motor mantido.";
    return reply.send({
      ok: true,
      message: `Histórico apagado.${bootMsg}${motorMsg}`,
      counts,
      bootstrap,
    });
  });
}
