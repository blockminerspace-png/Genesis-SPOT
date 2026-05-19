import { useCallback, useEffect, useState } from "react";
import { fetchBotSpotState } from "../api/botSpotApi.js";
import type { BotSpotState } from "../validation/botSpot.schema.js";

export function useBotSpotState(pollMs = 4000) {
  const [state, setState] = useState<BotSpotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const data = await fetchBotSpotState();
    if (!data) {
      setError("Não foi possível carregar estado real do bot");
      setState(null);
    } else {
      setState(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  return { state, loading, error, refresh };
}
