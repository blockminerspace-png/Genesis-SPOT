import { useEffect, useState } from "react";
import { fetchBotSpotOrders } from "../api/botSpotApi.js";
import { fmtDate, fmtMoney } from "../lib/format.js";

type OrderRow = {
  orderId: string;
  exchangeOrderId: string | null;
  cycleId: string | null;
  side: string;
  type: string;
  status: string;
  price: number | null;
  qty: number | null;
  filledQty: number;
  avgFillPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export function BotSpotOrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const data = (await fetchBotSpotOrders()) as { orders?: OrderRow[] } | null;
      if (!data?.orders) {
        setErr("Sem dados de ordens");
        return;
      }
      setRows(data.orders);
    })();
  }, []);

  if (err) return <p className="bs-muted">{err}</p>;

  return (
    <table className="bs-table">
      <thead>
        <tr>
          <th>orderId</th>
          <th>exchange</th>
          <th>cycleId</th>
          <th>side</th>
          <th>type</th>
          <th>status</th>
          <th>price</th>
          <th>qty</th>
          <th>filled</th>
          <th>avgFill</th>
          <th>created</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.orderId}>
            <td title={r.orderId}>{r.orderId.slice(0, 8)}…</td>
            <td>{r.exchangeOrderId ?? "—"}</td>
            <td>{r.cycleId?.slice(0, 8) ?? "—"}</td>
            <td>{r.side}</td>
            <td>{r.type}</td>
            <td>{r.status}</td>
            <td>{fmtMoney(r.price)}</td>
            <td>{r.qty ?? "—"}</td>
            <td>{r.filledQty}</td>
            <td>{fmtMoney(r.avgFillPrice)}</td>
            <td>{fmtDate(r.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
