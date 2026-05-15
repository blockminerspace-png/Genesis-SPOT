export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeText(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function formatNumber(value: unknown, decimals = 8): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return escapeHtml(String(value));
  return escapeHtml(n.toLocaleString("pt-BR", { maximumFractionDigits: decimals }));
}

export function formatDate(value: unknown): string {
  if (!value) return "—";
  try {
    return escapeHtml(new Date(String(value)).toLocaleString("pt-BR"));
  } catch {
    return "—";
  }
}

export function shortId(cid: string | null | undefined): string {
  if (!cid) return "—";
  const str = String(cid);
  return str.length > 10 ? `${str.slice(0, 6)}…${str.slice(-4)}` : str;
}

export function fmtNum(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  if (s.length > 18) return `${escapeHtml(s.slice(0, 16))}…`;
  return escapeHtml(s);
}
