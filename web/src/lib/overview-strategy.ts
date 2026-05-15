/** Estados de ciclo ainda «abertos» no painel. */
const OPEN_CYCLE = new Set([
  "WAITING_BUY_SIGNAL",
  "BUY_PLACED",
  "BUY_PARTIALLY_FILLED",
  "BUY_FILLED",
  "SELL_PLACED",
  "SELL_PARTIALLY_FILLED",
]);

export function parseCfgFraction(raw: unknown): number | null {
  const s0 = raw === null || raw === undefined ? "" : String(raw).trim().replace(",", ".");
  if (!s0) return null;
  const n = Number(s0);
  if (!Number.isFinite(n) || n < 0) return null;
  if (Number.isInteger(n) && n >= 1 && n <= 100) return n / 100;
  return n;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

function floorQuote(n: number, decimals: number): number {
  const f = 10 ** Math.min(18, Math.max(0, decimals));
  return Math.floor(n * f + 1e-12) / f;
}

export function findActiveOpenCycle(items: unknown[] | undefined, market: string): Record<string, unknown> | null {
  if (!Array.isArray(items)) return null;
  const m = String(market ?? "").toUpperCase();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const c = it as Record<string, unknown>;
    if (String(c.market ?? "").toUpperCase() !== m) continue;
    const st = String(c.status ?? "");
    if (!OPEN_CYCLE.has(st)) continue;
    return c;
  }
  return null;
}

/** Próximos preços hipotéticos abaixo do último (passo da grelha; só ilustrativo no painel — não é a ordem do Auto LIVE). */
export function nextGridBuyLevels(last: number, gridStep: number, quoteDecimals: number, steps: number): number[] {
  const g = Math.max(0, gridStep);
  const out: number[] = [];
  let p = last;
  for (let i = 0; i < steps; i++) {
    p = p * (1 - g);
    out.push(floorQuote(p, quoteDecimals));
  }
  return out;
}

/** Alvo de venda aproximado a partir de um preço de entrada (lucro + margem de taxas). */
export function approximateSellTarget(entry: number, targetProfit: number, feeBuffer: number, quoteDecimals: number): number {
  const bump = targetProfit + feeBuffer;
  return floorQuote(entry * (1 + bump), quoteDecimals);
}

export function orderPrice(c: Record<string, unknown>): number | null {
  const bo = c.buyOrder as { price?: unknown } | undefined;
  return bo != null ? num(bo.price) : null;
}

/** Rótulo do preço da compra no resumo: distingue mercado vs limite (o preço em DB pode ser médio/referência). */
export function cycleBuyPriceDisplayLabel(active: Record<string, unknown>): string {
  const bo = active.buyOrder as { type?: unknown } | undefined;
  const t = bo?.type != null ? String(bo.type).toUpperCase() : "";
  if (t === "MARKET") return "Preço da compra a mercado (médio / referência)";
  if (t === "LIMIT") return "Preço da ordem de compra (limite)";
  if (active.isLiveAutoWorker === true) return "Preço da compra a mercado (médio / referência)";
  return "Preço registado na compra";
}

export function sellOrderPrice(c: Record<string, unknown>): number | null {
  const so = c.sellOrder as { price?: unknown } | undefined;
  return so != null ? num(so.price) : null;
}
