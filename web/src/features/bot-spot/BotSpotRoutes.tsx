import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { BotSpotDashboard } from "./components/BotSpotDashboard.js";
import { BotSpotChartView } from "./components/BotSpotChartView.js";
import { BotSpotCyclesPage } from "./pages/BotSpotCyclesPage.js";
import { BotSpotOrdersPage } from "./pages/BotSpotOrdersPage.js";
import { BotSpotSettingsPage } from "./pages/BotSpotSettingsPage.js";
import { BotSpotDebugPage } from "./pages/BotSpotDebugPage.js";

const subnav = [
  { to: "/bot-spot", label: "Cockpit", end: true },
  { to: "/bot-spot/chart", label: "Gráfico" },
  { to: "/bot-spot/cycles", label: "Ciclos" },
  { to: "/bot-spot/orders", label: "Ordens" },
  { to: "/bot-spot/settings", label: "Config" },
  { to: "/bot-spot/debug", label: "Debug" },
] as const;

/** Secção Bot Spot integrada ao layout principal (sem shell paralelo). */
export function BotSpotSection() {
  return (
    <>
      <nav className="bs-subnav" aria-label="Bot Spot">
        {subnav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={"end" in n ? n.end : false}
            className={({ isActive }) => `bs-subnav-link${isActive ? " bs-subnav-link-active" : ""}`}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="bs-page">
        <Routes>
          <Route path="/bot-spot" element={<BotSpotDashboard />} />
          <Route path="/bot-spot/chart" element={<BotSpotChartView />} />
          <Route path="/bot-spot/cycles" element={<BotSpotCyclesPage />} />
          <Route path="/bot-spot/orders" element={<BotSpotOrdersPage />} />
          <Route path="/bot-spot/settings" element={<BotSpotSettingsPage />} />
          <Route path="/bot-spot/debug" element={<BotSpotDebugPage />} />
          <Route path="/bot-spot/*" element={<Navigate to="/bot-spot" replace />} />
        </Routes>
      </div>
    </>
  );
}
