import { setSimulatedLastPrice } from "../market-data/simulated-ticker.store.js";

type Opts = { market: string; intervalMs?: number };

let timer: NodeJS.Timeout | undefined;

/**
 * Atualiza preço simulado (MVP). Substituível por CoinEx/WebSocket depois.
 */
export function startSimulatedTickerWorker(opts: Opts) {
  const market = opts.market.toUpperCase();
  const intervalMs = opts.intervalMs ?? 5000;
  if (timer) {
    clearInterval(timer);
  }
  let last = 98_000 + Math.random() * 4_000;
  const tick = () => {
    last += (Math.random() - 0.5) * 120;
    if (last < 10_000) last = 10_000;
    setSimulatedLastPrice(market, last.toFixed(2));
  };
  tick();
  timer = setInterval(tick, intervalMs);
}

export function stopSimulatedTickerWorker() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
