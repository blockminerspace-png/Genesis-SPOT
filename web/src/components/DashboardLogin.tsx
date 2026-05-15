import { type FormEvent, useState } from "react";
import { BrandLogo } from "./BrandLogo.js";
import { apiPost } from "../lib/api.js";

type Props = {
  onLoggedIn: () => void;
  show: (msg: string, kind?: "ok" | "err" | "muted") => void;
};

export function DashboardLogin({ onLoggedIn, show }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"pwd" | "otp">("pwd");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPwd(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      const j = (await apiPost("/auth/login", { email, password })) as {
        step?: string;
        challengeId?: string;
        lockedUntil?: string;
      };
      if (j.challengeId) {
        setChallengeId(j.challengeId);
        setStep("otp");
        show("Código de verificação enviado para o teu email.", "ok");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("locked")) {
        show("Conta bloqueada temporariamente por demasiadas tentativas. Tenta mais tarde.", "err");
      } else {
        show(msg.includes("invalid_credentials") ? "Email ou palavra-passe incorretos." : msg, "err");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      await apiPost("/auth/verify-otp", { challengeId, code: code.replace(/\s/g, "") });
      onLoggedIn();
      show("Sessão iniciada.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show(msg.includes("invalid_otp") ? "Código incorreto ou expirado." : msg, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo-wrap" aria-hidden="true">
          <BrandLogo size={56} />
        </div>
        <h1 className="auth-title">Genesis SPOT</h1>
        <p className="auth-lead muted">Inicia sessão para aceder ao dashboard.</p>
        {step === "pwd" ? (
          <form className="auth-form" onSubmit={submitPwd}>
            <label className="auth-label">
              Email
              <input
                className="auth-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                required
              />
            </label>
            <label className="auth-label">
              Palavra-passe
              <input
                className="auth-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn primary auth-submit" disabled={busy}>
              {busy ? "A enviar…" : "Continuar"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitOtp}>
            <p className="muted auth-hint">Introduz o código de 6 dígitos enviado por email.</p>
            <label className="auth-label">
              Código
              <input
                className="auth-input auth-input-mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn primary auth-submit" disabled={busy}>
              {busy ? "A validar…" : "Entrar"}
            </button>
            <button
              type="button"
              className="btn ghost auth-back"
              disabled={busy}
              onClick={() => {
                setStep("pwd");
                setCode("");
                setChallengeId("");
              }}
            >
              Voltar
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
