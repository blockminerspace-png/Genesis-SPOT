import type { BotRuntimeStatus } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { Env } from "../../config/env.js";
import type { RuntimeExecutionLayer, RuntimePermission } from "./runtime-state.types.js";

function coinexKeysPresent(env: Env): boolean {
  return Boolean(env.COINEX_ACCESS_ID && env.COINEX_SECRET_KEY);
}

export function computeEnabledForRuntimeStatus(status: BotRuntimeStatus): boolean {
  return status !== "OFF" && status !== "KILL_SWITCH";
}

export class RuntimeStateService {
  constructor(private readonly env: Env) {}

  async getBotConfigRow() {
    const row = await prisma.botConfig.findFirst();
    if (!row) {
      throw new Error("BotConfig missing");
    }
    return row;
  }

  async getPermissions(): Promise<RuntimePermission> {
    const cfg = await this.getBotConfigRow();
    const status = cfg.runtimeStatus;
    const execDb = cfg.executionMode;
    const keys = coinexKeysPresent(this.env);

    let executionLayer: RuntimeExecutionLayer = "DISABLED";
    let liveBlockedMissingKeys = false;

    if (status === "OFF" || status === "KILL_SWITCH") {
      executionLayer = "DISABLED";
    } else if (execDb === "LIVE") {
      if (!keys) {
        executionLayer = "DISABLED";
        liveBlockedMissingKeys = true;
      } else {
        executionLayer = "LIVE";
      }
    } else {
      executionLayer = "DISABLED";
    }

    const canOperate = executionLayer !== "DISABLED";

    let canOpenNewCycles = false;
    let canPlaceBuyOrders = false;
    let canPlaceSellOrders = false;

    if (canOperate) {
      if (status === "RUNNING") {
        canOpenNewCycles = true;
        canPlaceBuyOrders = true;
        canPlaceSellOrders = true;
      } else if (status === "PAUSED_BUYS") {
        canOpenNewCycles = false;
        canPlaceBuyOrders = false;
        canPlaceSellOrders = true;
      } else if (status === "SELL_ONLY") {
        canOpenNewCycles = false;
        canPlaceBuyOrders = false;
        canPlaceSellOrders = true;
      }
    }

    return {
      runtimeStatus: status,
      executionModeDb: execDb,
      executionLayer,
      liveBlockedMissingKeys,
      canOpenNewCycles,
      canPlaceBuyOrders,
      canPlaceSellOrders,
    };
  }

  async isOff(): Promise<boolean> {
    return (await this.getBotConfigRow()).runtimeStatus === "OFF";
  }

  async isKillSwitch(): Promise<boolean> {
    return (await this.getBotConfigRow()).runtimeStatus === "KILL_SWITCH";
  }

  async isLiveExecution(): Promise<boolean> {
    return (await this.getBotConfigRow()).executionMode === "LIVE";
  }

  async isPausedBuys(): Promise<boolean> {
    return (await this.getBotConfigRow()).runtimeStatus === "PAUSED_BUYS";
  }

  async isSellOnly(): Promise<boolean> {
    return (await this.getBotConfigRow()).runtimeStatus === "SELL_ONLY";
  }

  mustUseLiveExecution(p: RuntimePermission): boolean {
    return p.executionLayer === "LIVE";
  }

  isExecutionDisabled(p: RuntimePermission): boolean {
    return p.executionLayer === "DISABLED";
  }

  canOpenBuyCycle(p: RuntimePermission): boolean {
    return p.canOpenNewCycles && p.canPlaceBuyOrders;
  }

  canPlaceBuyOrder(p: RuntimePermission): boolean {
    return p.canPlaceBuyOrders;
  }

  canPlaceSellOrder(p: RuntimePermission): boolean {
    return p.canPlaceSellOrders;
  }

  static enabledForStatus(status: BotRuntimeStatus): boolean {
    return computeEnabledForRuntimeStatus(status);
  }
}

let _runtime: RuntimeStateService | null = null;

export function initRuntimeStateService(env: Env): RuntimeStateService {
  _runtime = new RuntimeStateService(env);
  return _runtime;
}

export function getRuntimeStateService(): RuntimeStateService {
  if (!_runtime) {
    throw new Error("RuntimeStateService not initialized");
  }
  return _runtime;
}
