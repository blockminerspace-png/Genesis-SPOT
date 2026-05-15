import { safeText } from "./format.js";

export function trRuntimeStatus(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  const m: Record<string, string> = {
    OFF: "Desligado",
    RUNNING: "Em execução",
    PAUSED_BUYS: "Compras pausadas",
    SELL_ONLY: "Só vendas",
    KILL_SWITCH: "Paragem de emergência",
  };
  return m[s] ?? safeText(v, "—");
}

export function trExecutionMode(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  if (s === "LIVE") return "Real (LIVE)";
  return safeText(v, "—");
}

export function trExecutionLayer(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  const m: Record<string, string> = { LIVE: "Conta real", DISABLED: "Desativada" };
  return m[s] ?? safeText(v, "—");
}

export function trMarketDataSource(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  if (s === "COINEX") return "CoinEx";
  return safeText(v, "—");
}

export function trOrderSide(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  if (s === "BUY") return "Compra";
  if (s === "SELL") return "Venda";
  return safeText(v, "—");
}

export function trOrderType(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  if (s === "MARKET") return "Mercado";
  if (s === "LIMIT") return "Limite";
  return safeText(v, "—");
}

export function trOrderStatus(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  const m: Record<string, string> = {
    PENDING: "Pendente",
    OPEN: "Aberta",
    PARTIALLY_FILLED: "Parcial",
    FILLED: "Preenchida",
    CANCELLED: "Cancelada",
    REJECTED: "Rejeitada",
    EXPIRED: "Expirada",
    UNKNOWN: "Desconhecido",
  };
  return m[s] ?? safeText(v, "—");
}

export function trCycleStatus(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  const m: Record<string, string> = {
    WAITING_BUY_SIGNAL: "Aguardando compra",
    BUY_PLACED: "Compra colocada",
    BUY_PARTIALLY_FILLED: "Compra parcial",
    BUY_FILLED: "Compra preenchida",
    SELL_PLACED: "Venda colocada",
    SELL_PARTIALLY_FILLED: "Venda parcial",
    CLOSED_PROFIT: "Fechado com lucro",
    CANCELLED: "Cancelado",
    ERROR: "Erro",
    MANUAL_REVIEW: "Revisão manual",
  };
  return m[s] ?? safeText(v, "—");
}

export function trFullAutoBadge(s: unknown): string {
  const u = String(s ?? "").toUpperCase();
  const m: Record<string, string> = {
    DISABLED: "Desativado",
    BLOCKED: "Bloqueado",
    RUNNING: "Em execução",
    CIRCUIT_OPEN: "Circuito aberto",
    ERROR: "Erro",
  };
  return m[u] ?? safeText(s, "—");
}

export function priceSourceLabel(ps: unknown): string {
  if (ps === "COINEX") return "Preço real (CoinEx)";
  return String(ps ?? "—");
}
