import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { DashboardLogin } from "../components/DashboardLogin.js";
import { useToast } from "../hooks/useToast.js";

export default function LoginPage() {
  const { loading, authRequired, session, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const { toast, show } = useToast();

  useEffect(() => {
    if (loading) return;
    if (!authRequired) {
      navigate("/", { replace: true });
      return;
    }
    if (session) {
      navigate("/", { replace: true });
    }
  }, [loading, authRequired, session, navigate]);

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="muted">A carregar…</p>
      </div>
    );
  }

  if (!authRequired) return null;

  return (
    <>
      <DashboardLogin
        onLoggedIn={() => {
          void refreshAuth().then(() => navigate("/", { replace: true }));
        }}
        show={show}
      />
      <footer className="site-footer site-footer-login">
        <span className={`toast ${toast?.kind === "err" ? "err" : toast?.kind === "ok" ? "ok" : "muted"}`} aria-live="polite">
          {toast?.msg ?? ""}
        </span>
      </footer>
    </>
  );
}
