import type { BotExecutionMode, BotRuntimeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeEnabledForRuntimeStatus } from "../runtime/runtime-state.service.js";

export async function appendBotEvent(
  level: string,
  type: string,
  message: string,
  context?: Prisma.InputJsonValue,
) {
  return prisma.botEvent.create({
    data: { level, type, message, context: context ?? undefined },
  });
}

export async function updateBotRuntimeState(
  patch: { runtimeStatus?: BotRuntimeStatus; executionMode?: BotExecutionMode },
  context?: Prisma.InputJsonValue,
) {
  const row = await prisma.botConfig.findFirst();
  if (!row) {
    throw new Error("BotConfig missing");
  }

  const nextStatus = patch.runtimeStatus ?? row.runtimeStatus;
  const nextExec = patch.executionMode ?? row.executionMode;

  await prisma.botConfig.update({
    where: { id: row.id },
    data: {
      runtimeStatus: nextStatus,
      executionMode: nextExec,
      enabled: computeEnabledForRuntimeStatus(nextStatus),
    },
  });

  await appendBotEvent(
    "INFO",
    "BOT_RUNTIME_CHANGED",
    `runtime_status=${nextStatus} execution_mode=${nextExec}`,
    {
      runtimeStatus: nextStatus,
      executionMode: nextExec,
      ...(typeof context === "object" && context !== null && !Array.isArray(context)
        ? (context as Record<string, unknown>)
        : {}),
    },
  );

  return prisma.botConfig.findUnique({ where: { id: row.id } });
}

export async function patchBotConfigRow(
  data: Prisma.BotConfigUpdateInput,
  eventMessage: string,
  eventContext?: Prisma.InputJsonValue,
) {
  const row = await prisma.botConfig.findFirst();
  if (!row) {
    throw new Error("BotConfig missing");
  }
  const updated = await prisma.botConfig.update({
    where: { id: row.id },
    data,
  });
  await appendBotEvent("INFO", "CONFIG_UPDATED", eventMessage, eventContext);
  return updated;
}
