/** Linha de ciclo vinda de `/cycles/recent` (JSON). */
export type CycleRow = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

export type ClosedPnlStats = {
  closedWithProfitCount: number;
  totalRealizedQuote: number;
  avgReturnPct: number | null;
};

export function computeClosedPnlStats(items: CycleRow[] | undefined): ClosedPnlStats {
  if (!items?.length) {
    return { closedWithProfitCount: 0, totalRealizedQuote: 0, avgReturnPct: null };
  }
  let total = 0;
  let n = 0;
  let sumPct = 0;
  let pctCount = 0;
  for (const c of items) {
    if (String(c.status ?? "") !== "CLOSED_PROFIT") continue;
    const p = num(c.realizedProfitQuote);
    if (p != null) {
      total += p;
      n += 1;
    }
    const rp = num(c.realizedProfitPct);
    if (rp != null) {
      sumPct += rp;
      pctCount += 1;
    }
  }
  return {
    closedWithProfitCount: n,
    totalRealizedQuote: total,
    avgReturnPct: pctCount > 0 ? sumPct / pctCount : null,
  };
}

/** Preço médio ponderado por `baseFilled` nos ciclos com entrada (amostra recente). */
export function computeWeightedAvgEntry(items: CycleRow[] | undefined, maxRows = 15): number | null {
  if (!items?.length) return null;
  let sumPxBase = 0;
  let sumBase = 0;
  let used = 0;
  for (const c of items) {
    if (used >= maxRows) break;
    const ep = num(c.entryPrice);
    const bf = num(c.baseFilled);
    if (ep == null || bf == null || !(bf > 0)) continue;
    sumPxBase += ep * bf;
    sumBase += bf;
    used += 1;
  }
  if (!(sumBase > 0)) return null;
  return sumPxBase / sumBase;
}

/** Pontos (0..1, 0..1) para sparkline: entrada média por ciclo fechado com lucro, do mais antigo ao mais recente. */
export function buildClosedEntrySparkline(items: CycleRow[] | undefined, maxPoints = 10): number[] {
  if (!items?.length) return [];
  const closed = items.filter((c) => String(c.status ?? "") === "CLOSED_PROFIT");
  const pts: number[] = [];
  for (const c of closed) {
    const ep = num(c.entryPrice);
    if (ep != null && ep > 0) pts.push(ep);
    if (pts.length >= maxPoints) break;
  }
  return pts.slice().reverse();
}

export function normalizeSparklineY(values: number[]): { norm: number[]; min: number; max: number } {
  if (!values.length) return { norm: [], min: 0, max: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const norm = values.map((v) => (v - min) / span);
  return { norm, min, max };
}
