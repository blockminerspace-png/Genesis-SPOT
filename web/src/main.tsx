import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import LoginPage from "./pages/LoginPage.js";
import DashboardApp from "./App.js";
import BotSpotApp from "./features/bot-spot/BotSpotApp.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/bot-spot/*" element={<BotSpotApp />} />
          <Route path="/legacy/*" element={<DashboardApp />} />
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
