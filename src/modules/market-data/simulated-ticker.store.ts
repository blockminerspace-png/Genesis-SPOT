const store = new Map<string, { last: string; updatedAt: string }>();

export function setSimulatedLastPrice(market: string, last: string) {
  const key = market.toUpperCase();
  store.set(key, { last, updatedAt: new Date().toISOString() });
}

export function getSimulatedTicker(market: string) {
  const key = market.toUpperCase();
  const row = store.get(key);
  if (!row) {
    return {
      market: key,
      last: null as string | null,
      updatedAt: null as string | null,
      source: "simulated" as const,
    };
  }
  return { market: key, last: row.last, updatedAt: row.updatedAt, source: "simulated" as const };
}
