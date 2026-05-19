import { apiGet, apiPost } from "../../../lib/api.js";
import { botSpotChartSchema, botSpotStateSchema, type BotSpotChart, type BotSpotState } from "../validation/botSpot.schema.js";

export async function fetchBotSpotState(): Promise<BotSpotState | null> {
  const res = await apiGet("/bot-spot/state");
  if (!res.ok) return null;
  const parsed = botSpotStateSchema.safeParse(res.data);
  return parsed.success ? parsed.data : null;
}

export async function fetchBotSpotChart(interval = "15m"): Promise<BotSpotChart | null> {
  const to = Date.now();
  const from = to - 7 * 24 * 60 * 60 * 1000;
  const res = await apiGet(`/bot-spot/chart?interval=${encodeURIComponent(interval)}&from=${from}&to=${to}`);
  if (!res.ok) return null;
  const parsed = botSpotChartSchema.safeParse(res.data);
  return parsed.success ? parsed.data : null;
}

export async function postBotSpotReconcile(): Promise<unknown> {
  return apiPost("/bot-spot/reconcile", {});
}

export async function postBotSpotPause(): Promise<BotSpotState | null> {
  try {
    const j = await apiPost("/bot-spot/pause", {});
    const parsed = botSpotStateSchema.safeParse(j);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function postBotSpotResume(): Promise<BotSpotState | null> {
  try {
    const j = await apiPost("/bot-spot/resume", {});
    const parsed = botSpotStateSchema.safeParse(j);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fetchBotSpotCycles(): Promise<unknown> {
  const res = await apiGet("/bot-spot/cycles");
  return res.ok ? res.data : null;
}

export async function fetchBotSpotOrders(): Promise<unknown> {
  const res = await apiGet("/bot-spot/orders");
  return res.ok ? res.data : null;
}

export async function fetchBotSpotSettings(): Promise<unknown> {
  const res = await apiGet("/bot/config");
  return res.ok ? res.data : null;
}

export async function fetchBotSpotEvents(): Promise<unknown> {
  const res = await apiGet("/bot-spot/events");
  return res.ok ? res.data : null;
}
