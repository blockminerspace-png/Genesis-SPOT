import type { ReactNode } from "react";
import { fmtNum } from "../lib/format.js";

export function KvText({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value mono">{value}</span>
    </div>
  );
}

export function KvNum({ label, value, mono = true }: { label: string; value: unknown; mono?: boolean }) {
  const inner = mono ? (
    <span className="mono" dangerouslySetInnerHTML={{ __html: fmtNum(value) }} />
  ) : (
    <span>{String(value ?? "—")}</span>
  );
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className={mono ? "kv-value mono" : "kv-value"}>{inner}</span>
    </div>
  );
}

export function PctStoredRow({ label, stored }: { label: string; stored: unknown }) {
  const s0 = stored === null || stored === undefined ? "" : String(stored).trim();
  const n = Number(s0.replace(",", "."));
  let right: ReactNode;
  if (!s0 || !Number.isFinite(n)) {
    right = s0 || "—";
  } else {
    const pct = (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    right = (
      <>
        {pct}% <span className="muted">(fração {s0})</span>
      </>
    );
  }
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value mono">{right}</span>
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "default" | "danger" | "warn" }) {
  const toneClass = tone === "danger" ? " stat-card--danger" : tone === "warn" ? " stat-card--warn" : "";
  return (
    <div className={`stat-card${toneClass}`}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {hint ? <div className="stat-card-hint muted">{hint}</div> : null}
    </div>
  );
}

export function ChecksList({ checks }: { checks: Array<{ name: string; ok: boolean; message?: string }> }) {
  if (!Array.isArray(checks) || checks.length === 0) return <p className="muted">Sem checks.</p>;
  return (
    <ul className="checks-list">
      {checks.map((c) => (
        <li key={c.name}>
          <span className={c.ok ? "check-ok" : "check-err"} aria-hidden="true">
            {c.ok ? "✅" : "❌"}
          </span>
          <span>
            <code>{c.name}</code>
            {c.message ? <span className="muted"> ({c.message})</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function cycleStatusClass(status: unknown): string {
  const s = String(status || "").toUpperCase();
  if (s.includes("ERROR") || s.includes("MANUAL")) return "status-badge-err";
  if (s.includes("CLOSED") || s.includes("FILLED")) return "status-badge-ok";
  if (s.includes("OPEN") || s.includes("PARTIAL")) return "status-badge-warn";
  return "";
}
