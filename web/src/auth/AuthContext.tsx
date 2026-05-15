import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setDashboardAuthLostHandler } from "./auth-events.js";

export type AuthContextValue = {
  loading: boolean;
  authRequired: boolean;
  session: boolean;
  refreshAuth: () => Promise<void>;
  invalidateSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [session, setSession] = useState(false);

  const refreshAuth = useCallback(async () => {
    setLoading(true);
    try {
      const st = await fetch("/auth/status", { headers: { Accept: "application/json" } });
      if (!st.ok) throw new Error(String(st.status));
      const sj = (await st.json()) as { authRequired?: boolean };
      const req = Boolean(sj.authRequired);
      setAuthRequired(req);
      if (!req) {
        setSession(true);
        return;
      }
      const se = await fetch("/auth/session", { credentials: "include", headers: { Accept: "application/json" } });
      const sej = se.ok ? ((await se.json()) as { session?: boolean }) : { session: false };
      setSession(Boolean(sej.session));
    } catch {
      setAuthRequired(false);
      setSession(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const invalidateSession = useCallback(() => {
    setSession(false);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    setDashboardAuthLostHandler(() => setSession(false));
    return () => setDashboardAuthLostHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, authRequired, session, refreshAuth, invalidateSession }),
    [loading, authRequired, session, refreshAuth, invalidateSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth só dentro de <AuthProvider>");
  return v;
}
