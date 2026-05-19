import type { BotSpotState } from "../validation/botSpot.schema.js";
import { fmtDate } from "../lib/format.js";

export function BotSpotErrorsPanel({ errors }: { errors: BotSpotState["errors"] }) {
  const critical = errors.filter((e) => e.severity === "CRITICAL" || e.severity === "HIGH");
  if (critical.length === 0) return null;
  return (
    <section className="bs-errors" role="alert">
      <h2>Erros críticos</h2>
      <ul>
        {critical.map((e) => (
          <li key={`${e.code}-${e.createdAt}`}>
            <strong>{e.code}</strong> — {e.message}
            <span className="bs-muted"> {fmtDate(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
