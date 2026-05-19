import { useEffect, useState } from "react";
import { fetchBotSpotSettings } from "../api/botSpotApi.js";

export function BotSpotSettingsPage() {
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      const data = (await fetchBotSpotSettings()) as Record<string, unknown> | null;
      setCfg(data);
    })();
  }, []);

  if (!cfg) return <p className="bs-muted">Carregando configuração (somente leitura)…</p>;

  return (
    <pre className="bs-debug-pre">{JSON.stringify(cfg, null, 2)}</pre>
  );
}
