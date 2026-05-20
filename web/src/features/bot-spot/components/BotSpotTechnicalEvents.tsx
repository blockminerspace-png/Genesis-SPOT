import { useEffect, useState } from "react";
import { fetchBotSpotEvents } from "../api/botSpotApi.js";
import { fmtDate } from "../lib/format.js";

type Ev = { id: string; level: string; type: string; message: string; createdAt: string };

export function BotSpotTechnicalEvents() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = (await fetchBotSpotEvents()) as { events?: Ev[] } | null;
        setEvents(data?.events ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (err) return <p className="muted">{err}</p>;
  if (events.length === 0) return <p className="muted">Nenhum evento técnico recente.</p>;

  return (
    <ul className="events-list">
      {events.map((e) => {
        const lvl = String(e.level ?? "").toUpperCase();
        const bcls = lvl === "ERROR" || lvl === "CRITICAL" ? "badge-danger" : lvl === "WARN" ? "badge-warn" : "badge-good";
        return (
          <li key={e.id}>
            <div className="event-head">
              <span className={`badge ${bcls}`}>{e.level}</span>
              <strong>{e.type}</strong>
            </div>
            <div className="event-msg">{e.message}</div>
            <div className="event-meta">{fmtDate(e.createdAt)}</div>
          </li>
        );
      })}
    </ul>
  );
}
