import { Decimal } from "../../shared/decimal.js";

let utcDay = "";
let volume = new Decimal(0);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Só para testes. */
export function resetLiveDailyVolumeForTests() {
  utcDay = "";
  volume = new Decimal(0);
}

export function recordLiveQuoteNotional(quoteValue: string): void {
  const d = todayUtc();
  if (d !== utcDay) {
    utcDay = d;
    volume = new Decimal(0);
  }
  volume = volume.plus(new Decimal(quoteValue));
}

export function getLiveDailyQuoteNotional(): { day: string; total: string } {
  const d = todayUtc();
  if (d !== utcDay) {
    return { day: d, total: "0" };
  }
  return { day: utcDay, total: volume.toFixed() };
}
