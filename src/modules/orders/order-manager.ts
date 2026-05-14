import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { getRuntimeStateService, type RuntimeStateService } from "../runtime/runtime-state.service.js";
import { SimulatedOrderExecutor } from "./executors/simulated-order.executor.js";
import { CoinexOrderExecutor } from "./executors/coinex-order.executor.js";
import type { OrderExecutor } from "./executors/order-executor.interface.js";
import type { CancelOrderInput, PlaceLimitOrderInput, PlacedOrder } from "../runtime/runtime-state.types.js";

export class OrderManager {
  constructor(
    private readonly runtime: RuntimeStateService,
    private readonly simulated: OrderExecutor,
    private readonly live: OrderExecutor,
    private readonly log: FastifyBaseLogger,
  ) {}

  async placeLimitOrder(input: PlaceLimitOrderInput): Promise<PlacedOrder> {
    const p = await this.runtime.getPermissions();

    if (this.runtime.isExecutionDisabled(p)) {
      const reason = p.liveBlockedMissingKeys ? "LIVE bloqueado: faltam chaves CoinEx no .env" : "execução desligada";
      throw new Error(reason);
    }

    if (input.side === "BUY" && !this.runtime.canPlaceBuyOrder(p)) {
      throw new Error("Compras não permitidas no runtime atual");
    }
    if (input.side === "SELL" && !this.runtime.canPlaceSellOrder(p)) {
      throw new Error("Vendas não permitidas no runtime atual");
    }

    if (this.runtime.mustUseSimulatedExecution(p)) {
      this.log.debug({ op: "order.placeLimitOrder", layer: "SIMULATED" }, "delegating to simulated executor");
      return this.simulated.placeLimitOrder(input);
    }

    if (this.runtime.mustUseLiveExecution(p)) {
      this.log.debug({ op: "order.placeLimitOrder", layer: "LIVE" }, "delegating to CoinEx executor");
      return this.live.placeLimitOrder(input);
    }

    throw new Error("Estado de execução inesperado");
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    const p = await this.runtime.getPermissions();
    if (this.runtime.isExecutionDisabled(p)) {
      return;
    }
    if (this.runtime.mustUseSimulatedExecution(p)) {
      await this.simulated.cancelOrder(input);
      return;
    }
    await this.live.cancelOrder(input);
  }
}

let _mgr: OrderManager | null = null;

export function initOrderManager(env: Env, log: FastifyBaseLogger): OrderManager {
  _mgr = new OrderManager(
    getRuntimeStateService(),
    new SimulatedOrderExecutor(log),
    new CoinexOrderExecutor(env, log),
    log,
  );
  return _mgr;
}

export function getOrderManager(): OrderManager {
  if (!_mgr) {
    throw new Error("OrderManager not initialized");
  }
  return _mgr;
}
