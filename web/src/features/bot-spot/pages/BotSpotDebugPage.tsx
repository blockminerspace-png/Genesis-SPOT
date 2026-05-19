import { useEffect, useState } from "react";
import { fetchBotSpotEvents } from "../api/botSpotApi.js";
import { fmtDate } from "../lib/format.js";

type Ev = { id: string; level: string; type: string; message: string; createdAt: string };

export function BotSpotDebugPage() {
  const [events, setEvents] = useState<Ev[]>([]);

  useEffect(() => {
    void (async () => {
      const data = (await fetchBotSpotEvents()) as { events?: Ev[] } | null;
      setEvents(data?.events ?? []);
    })();
  }, []);

  return (
    <div>
      <p className="bs-muted">Eventos técnicos recentes (dados reais do backend)</p>
      <ul className="bs-event-list">
        {events.map((e) => (
          <li key={e.id}>
            <span className="bs-pill">{e.level}</span> <strong>{e.type}</strong> — {e.message}
            <span className="bs-muted"> {fmtDate(e.createdAt)}</span>
          </li>
        ))}
      </ul>
      <p className="bs-muted">
        <a href="/">← Voltar ao painel principal</a>
      </p>
    </div>
  );
}
