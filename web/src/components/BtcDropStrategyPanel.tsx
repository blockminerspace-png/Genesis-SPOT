import { useCallback, useState } from "react";
import { apiPost } from "../lib/api.js";
import { useToast } from "../hooks/useToast.js";
import { KvNum, PctStoredRow } from "./parts.js";

export type BtcDropPanelSnapshot = {
  enabled: boolean;
  market: string;
  anchorPrice: string | null;
  nextBuyPrice: string | null;
  stepUsdt: string;
  baseAmount: string;
  targetProfitPct: string;
  estimatedQuoteValueAtNextBuy: string | null;
  updatedAt: string | null;
  executionLayer: string;
  liveTradingEnabled: boolean;
};

type Props = {
  snapshot: BtcDropPanelSnapshot | null;
  quoteCcy: string;
  onRefresh: () => void;
};

const RESET_CONFIRM = "RESET_BTC_DROP_WITH_OPEN_CYCLES";

export function BtcDropStrategyPanel({ snapshot, quoteCcy, onRefresh }: Props) {
  const { show } = useToast();
  const [resetting, setResetting] = useState(false);

  const resetLevels = useCallback(async () => {
    if (!snapshot?.enabled) return;
    const ok1 = window.confirm(
      "Reiniciar níveis da estratégia BTC Drop? O anchor passa ao preço atual e a próxima compra fica anchor − passo USDT.",
    );
    if (!ok1) return;
    const force = window.confirm(
      "Se houver ciclos abertos, confirme de novo para forçar o reset (pode causar sobreposição de níveis).",
    );
    setResetting(true);
    try {
      const res = (await apiPost("/strategy/btc-drop/reset", force ? { confirm: RESET_CONFIRM } : {})) as {
        bootstrap?: { ok?: boolean; attempted?: boolean; message?: string };
      };
      const boot = res.bootstrap;
      if (boot?.ok) {
        show("Níveis reiniciados e compra inicial a mercado enviada.", "ok");
      } else if (boot?.attempted && !boot.ok) {
        show(`Níveis reiniciados. Compra inicial: ${boot.message ?? "falhou"}`, "err");
      } else {
        show("Níveis BTC Drop reiniciados.", "ok");
      }
      onRefresh();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setResetting(false);
    }
  }, [snapshot?.enabled, onRefresh, show]);

  if (!snapshot) {
    return (
      <div className="panel overview-strategy-panel" style={{ marginBottom: 16 }}>
        <p className="muted small">A carregar estratégia BTC Drop…</p>
      </div>
    );
  }

  if (!snapshot.enabled) {
    return null;
  }

  const q = quoteCcy || "USDT";
  const pctLabel = (() => {
    const n = Number(String(snapshot.targetProfitPct).replace(",", "."));
    if (!Number.isFinite(n)) return "2%";
    return n <= 1 ? `${(n * 100).toLocaleString("pt-BR")}%` : `${n}%`;
  })();

  return (
    <div className="panel overview-strategy-panel" style={{ marginBottom: 16 }}>
      <h2 className="panel-title">Estratégia BTC Drop 2K</h2>
      <p className="panel-lead muted small">
        Compra <strong>{snapshot.baseAmount} BTC</strong> cada vez que o preço atinge o próximo nível (queda de{" "}
        <strong>
          {snapshot.stepUsdt} {q}
        </strong>{" "}
        por degrau). Cada compra abre um <strong>ciclo isolado</strong>; a venda alvo é <strong>+{pctLabel}</strong> sobre
        o preço médio real de entrada. O valor em {q} de {snapshot.baseAmount} BTC varia com o preço do BTC.
      </p>
      <div className="kv-grid">
        <KvNum label="Estratégia ativa" value="BTC_DROP_2000" mono={false} />
        <KvNum label="Mercado" value={snapshot.market} mono={false} />
        <KvNum
          label="Modo execução"
          value={
            snapshot.liveTradingEnabled && snapshot.executionLayer === "LIVE"
              ? "LIVE (ordens reais)"
              : snapshot.executionLayer === "LIVE"
                ? "LIVE bloqueado (travas .env/runtime)"
                : "Motor desligado / sem LIVE"
          }
          mono={false}
        />
        <KvNum label="Anchor price (pico)" value={snapshot.anchorPrice ?? "—"} mono />
        <KvNum label="Próxima compra (≤)" value={snapshot.nextBuyPrice ?? "—"} mono />
        <KvNum label="Queda por nível" value={`${snapshot.stepUsdt} ${q}`} mono={false} />
        <KvNum label="Quantidade por compra" value={`${snapshot.baseAmount} BTC`} mono={false} />
        {snapshot.estimatedQuoteValueAtNextBuy ? (
          <KvNum label={`Valor estimado da próxima compra (${q})`} value={snapshot.estimatedQuoteValueAtNextBuy} mono />
        ) : null}
        <PctStoredRow label="Venda alvo (sobre entrada)" stored={snapshot.targetProfitPct} />
        {snapshot.updatedAt ? (
          <KvNum label="Estado atualizado" value={new Date(snapshot.updatedAt).toLocaleString("pt-BR")} mono={false} />
        ) : null}
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" disabled={resetting} onClick={() => void resetLevels()}>
          {resetting ? "A reiniciar…" : "Resetar níveis + compra inicial"}
        </button>
        <p className="muted tiny" style={{ marginTop: 8 }}>
          Reinicia anchor/níveis e envia 1 compra a mercado (se motor RUNNING e LIVE ativo).
        </p>
      </div>
    </div>
  );
}
