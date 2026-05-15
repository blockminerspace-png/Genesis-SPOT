import { notifyDashboardAuthLost } from "../auth/auth-events.js";

const fetchDefaults: RequestInit = {
  credentials: "include",
};

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: "application/json", ...extra };
}

export async function apiGet(path: string): Promise<{ ok: boolean; status: number; data: unknown; error: string | null }> {
  try {
    const r = await fetch(path, { ...fetchDefaults, headers: jsonHeaders() });
    if (r.status === 401) notifyDashboardAuthLost();
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : String(data.error ?? r.statusText) };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function apiPost(path: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const r = await fetch(path, {
    ...fetchDefaults,
    method: "POST",
    headers: jsonHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path}: ${String(j.error ?? r.statusText)}`);
  return j;
}

export async function apiPatch(path: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(path, {
    ...fetchDefaults,
    method: "PATCH",
    headers: jsonHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path}: ${String(j.error ?? r.statusText)}`);
  return j;
}

export async function apiPostLogout(): Promise<void> {
  await fetch("/auth/logout", { ...fetchDefaults, method: "POST", headers: jsonHeaders({ "Content-Type": "application/json" }) });
}
