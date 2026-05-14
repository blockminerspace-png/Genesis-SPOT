import { Decimal } from "../../shared/decimal.js";

let usdt = new Decimal("10000");
let btc = new Decimal("0");
let forcedPrice: string | null = null;

export function getSimulationBalances() {
  return {
    USDT: { available: usdt.toFixed(4), locked: "0" },
    BTC: { available: btc.toFixed(8), locked: "0" },
  };
}

export function getSimulationState() {
  return {
    usdt: usdt.toString(),
    btc: btc.toString(),
    forcedPrice,
  };
}

export function resetSimulationState() {
  usdt = new Decimal("10000");
  btc = new Decimal("0");
  forcedPrice = null;
}

export function seedSimulationBalance(usdtStr: string, btcStr: string) {
  usdt = new Decimal(usdtStr);
  btc = new Decimal(btcStr);
}

export function setForcedSimulationPrice(price: string | null) {
  forcedPrice = price;
}

export function applySimulatedBuyFill(quoteSpent: string, btcReceived: string) {
  usdt = usdt.minus(new Decimal(quoteSpent));
  btc = btc.plus(new Decimal(btcReceived));
}

export function applySimulatedSellFill(btcSold: string, quoteReceived: string) {
  btc = btc.minus(new Decimal(btcSold));
  usdt = usdt.plus(new Decimal(quoteReceived));
}
