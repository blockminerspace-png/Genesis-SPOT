import { useEffect, useState } from "react";
import { fetchBotSpotCycles } from "../api/botSpotApi.js";
import { fmtDate, fmtMoney } from "../lib/format.js";

type CycleRow = {
  cycleId: string;
  market: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  positionQty: number;
  avgEntryPrice: number | null;
  targetSellPrice: number | null;
  realizedPnl: number | null;
};

export function BotSpotCyclesPage() {
  const [rows, setRows] = useState<CycleRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const data = (await fetchBotSpotCycles()) as { cycles?: CycleRow[] } | null;
      if (!data?.cycles) {
        setErr("Sem dados de ciclos");
        return;
      }
      setRows(data.cycles);
    })();
  }, []);

  if (err) return <p className="bs-muted">{err}</p>;

  return (
    <table className="bs-table">
      <thead>
        <tr>
          <th>cycleId</th>
          <th>market</th>
          <th>status</th>
          <th>openedAt</th>
          <th>closedAt</th>
          <th>positionQty</th>
          <th>avgEntry</th>
          <th>targetSell</th>
          <th>realizedPnl</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cycleId}>
            <td title={r.cycleId}>{r.cycleId.slice(0, 8)}…</td>
            <td>{r.market}</td>
            <td>{r.status}</td>
            <td>{fmtDate(r.openedAt)}</td>
            <td>{fmtDate(r.closedAt)}</td>
            <td>{r.positionQty}</td>
            <td>{fmtMoney(r.avgEntryPrice)}</td>
            <td>{fmtMoney(r.targetSellPrice)}</td>
            <td>{fmtMoney(r.realizedPnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
