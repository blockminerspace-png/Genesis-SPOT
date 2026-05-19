import { Decimal } from "../../shared/decimal.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { floorPrice } from "../market-data/market-spec.rounding.js";
import type { MarketSpec } from "../market-data/market-spec.types.js";

function flooredLast(lastPrice: string, spec: MarketSpec): string {
  return floorPrice(new Decimal(lastPrice), spec).toFixed(spec.quotePrecision);
}

/** Último preço conhecido como referência de pico (compra quando cair gridStepPct abaixo disto). */
export async function getAutoLiveAnchorPrice(market: string, lastPrice: string, spec: MarketSpec): Promise<string> {
  const m = market.toUpperCase();
  const row = await prisma.autoLiveMarketAnchor.findUnique({ where: { market: m } });
  if (row) return row.anchorPrice.toString();
  const init = flooredLast(lastPrice, spec);
  await prisma.autoLiveMarketAnchor.create({
    data: { market: m, anchorPrice: init },
  });
  return init;
}

/** Enquanto não há ciclo aberto, o pico sobe com o mercado. */
export async function bumpAutoLiveAnchorToPeak(market: string, lastPrice: string, spec: MarketSpec): Promise<string> {
  const m = market.toUpperCase();
  const last = flooredLast(lastPrice, spec);
  const current = await getAutoLiveAnchorPrice(m, last, spec);
  const next = Decimal.max(new Decimal(current), new Decimal(last)).toFixed(spec.quotePrecision);
  if (next !== current) {
    await prisma.autoLiveMarketAnchor.upsert({
      where: { market: m },
      create: { market: m, anchorPrice: next },
      update: { anchorPrice: next },
    });
  }
  return next;
}

/** Após venda / ciclo fechado, reancora no preço corrente para a próxima queda de 5%. */
export async function resetAutoLiveAnchorAfterClose(market: string, lastPrice: string, spec: MarketSpec): Promise<void> {
  const m = market.toUpperCase();
  const last = flooredLast(lastPrice, spec);
  await prisma.autoLiveMarketAnchor.upsert({
    where: { market: m },
    create: { market: m, anchorPrice: last },
    update: { anchorPrice: last },
  });
}

export function gridDropBuyTriggered(anchorPrice: string, lastPrice: string, gridStepPct: string): boolean {
  const g = new Decimal(gridStepPct.trim().replace(",", "."));
  if (!g.gt(0) || g.gte(1)) return true;
  const trigger = new Decimal(anchorPrice).mul(new Decimal(1).minus(g));
  return new Decimal(lastPrice).lte(trigger);
}

export function gridDropTriggerPrice(anchorPrice: string, gridStepPct: string, spec: MarketSpec): string {
  const g = new Decimal(gridStepPct.trim().replace(",", "."));
  const raw = new Decimal(anchorPrice).mul(new Decimal(1).minus(g));
  return floorPrice(raw, spec).toFixed(spec.quotePrecision);
}
