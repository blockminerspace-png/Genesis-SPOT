import { useEffect, useState } from "react";
import { fetchBotSpotCycles, fetchBotSpotOrders } from "../features/bot-spot/api/botSpotApi.js";
import { fmtDate, fmtMoney } from "../features/bot-spot/lib/format.js";

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
};

export function CyclesOrdersApiTables() {
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, o] = await Promise.all([fetchBotSpotCycles(), fetchBotSpotOrders()]);
      const cRows = (c as { cycles?: CycleRow[] } | null)?.cycles;
      const oRows = (o as { orders?: OrderRow[] } | null)?.orders;
      if (!cRows && !oRows) {
        setErr("Sem dados consolidados de ciclos/ordens");
        return;
      }
      setCycles(cRows ?? []);
      setOrders(oRows ?? []);
    })();
  }, []);

  if (err) return <p className="muted">{err}</p>;

  return (
    <>
      <div className="cycles-orders-block">
        <h3 className="ov-subtitle">Ciclos (consolidado)</h3>
        <div className="table-responsive">
          <table className="data-table data-table-cycles">
            <thead>
              <tr>
                <th>ID</th>
                <th>Mercado</th>
                <th>Status</th>
                <th>Aberto</th>
                <th>Fechado</th>
                <th>Qty</th>
                <th>Média</th>
                <th>Alvo</th>
                <th>PnL</th>
              </tr>
            </thead>
            <tbody>
              {cycles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted empty-state">
                    Sem ciclos
                  </td>
                </tr>
              ) : (
                cycles.map((r) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="cycles-orders-block">
        <h3 className="ov-subtitle">Ordens (consolidado)</h3>
        <div className="table-responsive">
          <table className="data-table data-table-orders">
            <thead>
              <tr>
                <th>ID</th>
                <th>Exchange</th>
                <th>Ciclo</th>
                <th>Lado</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Preço</th>
                <th>Qty</th>
                <th>Preenchido</th>
                <th>Média fill</th>
                <th>Criado</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted empty-state">
                    Sem ordens
                  </td>
                </tr>
              ) : (
                orders.map((r) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
