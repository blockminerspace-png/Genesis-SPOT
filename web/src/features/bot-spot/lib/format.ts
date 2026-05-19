export function fmtMoney(value: number | null | undefined, currency = "USDC", digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Sem dado real disponível";
  }
  return `${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

export function fmtBtcQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Sem dado real disponível";
  }
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })} BTC`;
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Sem dado real disponível";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem dado real disponível";
  return d.toLocaleString();
}
