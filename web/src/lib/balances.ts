import type { AssetBalance } from "./types.js";
import { trFullAutoBadge } from "./translations.js";

export function parseSpotMarketPair(market: string): { base: string; quote: string } {
  const m = String(market ?? "BTCUSDC").toUpperCase();
  if (m.endsWith("USDT")) return { base: m.slice(0, -4) || "BTC", quote: "USDT" };
  if (m.endsWith("USDC")) return { base: m.slice(0, -4) || "BTC", quote: "USDC" };
  if (m.endsWith("USD")) return { base: m.slice(0, -3) || "BTC", quote: "USD" };
  return { base: "BTC", quote: "USDC" };
}

export function pickAsset(balances: AssetBalance[] | undefined, asset: string): AssetBalance | null {
  if (!Array.isArray(balances)) return null;
  return balances.find((x) => x.asset === asset) ?? null;
}

export function fmtBalLine(b: AssetBalance | null): string {
  if (!b) return "—";
  return `disponível ${b.available} · bloqueado ${b.frozen} · total ${b.total}`;
}

export function feeRateToPct(rate: unknown): string {
  try {
    const n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    return `${(n * 100).toFixed(2)}%`;
  } catch {
    return "—";
  }
}

export function reconcHealthSummary(r: Record<string, unknown> | null): { label: string; kind: "good" | "danger" | "warn"; stale: boolean } {
  if (!r || typeof r !== "object") return { label: "indisponível", kind: "warn", stale: true };
  const healthyMs = r.lastHealthyTickCompletedAtMs as number | undefined;
  const hasHealthy = typeof healthyMs === "number" && healthyMs > 0;
  const drift = r.fillSumDriftDetected as boolean | undefined;
  const err = r.lastError as string | undefined;
  if (!hasHealthy) return { label: "sem conferência saudável", kind: "danger", stale: true };
  if (err) return { label: "Erro", kind: "danger", stale: true };
  if (drift) return { label: "Desvio na soma das execuções", kind: "danger", stale: true };
  return { label: "em dia", kind: "good", stale: false };
}

export function fullAutoStatusPresentation(lc: Record<string, unknown> | null): {
  badge: string;
  cls: string;
  card: string;
} {
  const s = (lc && (lc.status as string)) || "DISABLED";
  if (s === "DISABLED") return { badge: trFullAutoBadge("DISABLED"), cls: "badge-neutral", card: "fullauto--disabled" };
  if (s === "BLOCKED") return { badge: trFullAutoBadge("BLOCKED"), cls: "badge-warn", card: "" };
  if (s === "RUNNING") return { badge: trFullAutoBadge("RUNNING"), cls: "badge-good", card: "fullauto--live-edge" };
  if (s === "CIRCUIT_OPEN" || s === "ERROR")
    return { badge: trFullAutoBadge(s === "CIRCUIT_OPEN" ? "CIRCUIT_OPEN" : "ERROR"), cls: "badge-danger", card: "fullauto--live-edge" };
  return { badge: trFullAutoBadge(s), cls: "badge-warn", card: "" };
}
