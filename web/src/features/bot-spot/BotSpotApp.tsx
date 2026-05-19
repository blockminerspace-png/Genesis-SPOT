import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { BotSpotDashboard } from "./components/BotSpotDashboard.js";
import { BotSpotChartView } from "./components/BotSpotChartView.js";
import { BotSpotCyclesPage } from "./pages/BotSpotCyclesPage.js";
import { BotSpotOrdersPage } from "./pages/BotSpotOrdersPage.js";
import { BotSpotSettingsPage } from "./pages/BotSpotSettingsPage.js";
import { BotSpotDebugPage } from "./pages/BotSpotDebugPage.js";

const nav = [
  { to: "/bot-spot", label: "Cockpit", end: true },
  { to: "/bot-spot/chart", label: "Gráfico" },
  { to: "/bot-spot/cycles", label: "Ciclos" },
  { to: "/bot-spot/orders", label: "Ordens" },
  { to: "/bot-spot/settings", label: "Settings" },
  { to: "/bot-spot/debug", label: "Debug" },
] as const;

export default function BotSpotApp() {
  return (
    <div className="bs-shell">
      <nav className="bs-nav">
        <span className="bs-brand">Bot Spot</span>
        <Link to="/" className="bs-back-link">
          ← Painel principal
        </Link>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="bs-main">
        <Routes>
          <Route index element={<BotSpotDashboard />} />
          <Route path="chart" element={<BotSpotChartView />} />
          <Route path="cycles" element={<BotSpotCyclesPage />} />
          <Route path="orders" element={<BotSpotOrdersPage />} />
          <Route path="settings" element={<BotSpotSettingsPage />} />
          <Route path="debug" element={<BotSpotDebugPage />} />
          <Route path="*" element={<Navigate to="/bot-spot" replace />} />
        </Routes>
      </main>
    </div>
  );
}
