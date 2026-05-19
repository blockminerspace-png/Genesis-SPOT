import { useCallback, useEffect, useState } from "react";
import { fetchBotSpotChart } from "../api/botSpotApi.js";
import type { BotSpotChart } from "../validation/botSpot.schema.js";

export function useBotSpotChart(interval = "15m") {
  const [chart, setChart] = useState<BotSpotChart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchBotSpotChart(interval);
    if (!data) {
      setError("Falha ao carregar gráfico");
      setChart(null);
    } else if (data.unavailable) {
      setError(data.unavailable.reason);
      setChart(data);
    } else if (data.candles.length === 0) {
      setError("Sem candles reais da Hyperliquid neste intervalo");
      setChart(data);
    } else {
      setChart(data);
    }
    setLoading(false);
  }, [interval]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { chart, loading, error, refresh };
}
