import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { getRuntimeStateService, type RuntimeStateService } from "../runtime/runtime-state.service.js";
import { CoinexOrderExecutor } from "./executors/coinex-order.executor.js";
import type { CancelOrderInput, PlaceLimitOrderInput, PlaceMarketBuyInput, PlacedOrder } from "../runtime/runtime-state.types.js";

export class OrderManager {
  constructor(
    private readonly runtime: RuntimeStateService,
    private readonly live: CoinexOrderExecutor,
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

    if (this.runtime.mustUseLiveExecution(p)) {
      this.log.debug({ op: "order.placeLimitOrder", layer: "LIVE" }, "delegating to CoinEx executor");
      return this.live.placeLimitOrder(input);
    }

    throw new Error("Execução LIVE indisponível (motor OFF ou chaves CoinEx)");
  }

  async placeMarketBuy(input: PlaceMarketBuyInput): Promise<PlacedOrder> {
    const p = await this.runtime.getPermissions();

    if (this.runtime.isExecutionDisabled(p)) {
      const reason = p.liveBlockedMissingKeys ? "LIVE bloqueado: faltam chaves CoinEx no .env" : "execução desligada";
      throw new Error(reason);
    }

    if (!this.runtime.canPlaceBuyOrder(p)) {
      throw new Error("Compras não permitidas no runtime atual");
    }

    if (this.runtime.mustUseLiveExecution(p)) {
      this.log.debug({ op: "order.placeMarketBuy", layer: "LIVE" }, "delegating to CoinEx executor");
      return this.live.placeMarketBuy(input);
    }

    throw new Error("Execução LIVE indisponível (motor OFF ou chaves CoinEx)");
  }

  async cancelOrder(input: CancelOrderInput): Promise<void> {
    const p = await this.runtime.getPermissions();
    if (this.runtime.isExecutionDisabled(p)) {
      return;
    }
    await this.live.cancelOrder(input);
  }
}

let _mgr: OrderManager | null = null;

export function initOrderManager(env: Env, log: FastifyBaseLogger): OrderManager {
  _mgr = new OrderManager(getRuntimeStateService(), new CoinexOrderExecutor(env, log), log);
  return _mgr;
}

export function getOrderManager(): OrderManager {
  if (!_mgr) {
    throw new Error("OrderManager not initialized");
  }
  return _mgr;
}
