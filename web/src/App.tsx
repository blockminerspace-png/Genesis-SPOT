import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BtcDropEnvReadonly } from "./features/bot-spot/components/BtcDropEnvReadonly.js";
import { BotSpotErrorsPanel } from "./features/bot-spot/components/BotSpotErrorsPanel.js";
import { BotSpotRuntimeControls } from "./features/bot-spot/components/BotSpotRuntimeControls.js";
import { BotSpotTechnicalEvents } from "./features/bot-spot/components/BotSpotTechnicalEvents.js";
import { HyperliquidChartPanel } from "./features/bot-spot/components/HyperliquidChartPanel.js";
import { useBotSpotState } from "./features/bot-spot/hooks/useBotSpotState.js";
import { CyclesOrdersApiTables } from "./components/CyclesOrdersApiTables.js";
import { useAuth } from "./auth/AuthContext.js";
import { apiGet, apiPatch, apiPost, apiPostLogout } from "./lib/api.js";
import { useToast } from "./hooks/useToast.js";
import { formatDate, fmtNum, shortId } from "./lib/format.js";
import { trEventLevel, trEventMessage, trEventType } from "./lib/event-i18n.js";
import { trAutoDecision } from "./lib/auto-decision-i18n.js";
import {
  approximateSellTarget,
  findActiveOpenCycle,
  nextGridBuyLevels,
  orderPrice,
  parseCfgFraction,
  sellOrderPrice,
} from "./lib/overview-strategy.js";
import {
  feeRateToPct,
  fmtBalLine,
  fullAutoStatusPresentation,
  parseSpotMarketPair,
  pickAsset,
  reconcHealthSummary,
} from "./lib/balances.js";
import {
  priceSourceLabel,
  trCycleStatus,
  trExecutionLayer,
  trExecutionMode,
  trOrderSide,
  trOrderStatus,
  trOrderType,
  trRuntimeStatus,
} from "./lib/translations.js";
import { ChecksList, KvNum, PctStoredRow, cycleStatusClass } from "./components/parts.js";
import { OverviewAnalyticsBlock } from "./components/OverviewAnalyticsBlock.js";
import { StrategyGridPanel } from "./components/StrategyGridPanel.js";
import { BtcDropStrategyPanel, type BtcDropPanelSnapshot } from "./components/BtcDropStrategyPanel.js";
import { RealOnlyDashboard } from "./components/RealOnlyDashboard.js";
import { OperationalChecksPanel } from "./components/OperationalChecksPanel.js";
import { RealOnlyHeader } from "./components/RealOnlyHeader.js";
import { BrandLogo } from "./components/BrandLogo.js";

type TabId = "overview" | "operation" | "market" | "fullauto" | "params" | "cycles" | "reconc" | "events" | "grafico";

const PCT_FORM_KEYS = new Set(["targetProfitPct", "gridStepPct", "feeBufferPct"]);

function normalizeStoredFraction(raw: string): string {
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return s;
  if (Number.isInteger(n) && n >= 1 && n <= 100) return String(n / 100);
  return s;
}

function normalizeConfigPatchBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const k of PCT_FORM_KEYS) {
    if (typeof out[k] === "string") out[k] = normalizeStoredFraction(out[k] as string);
  }
  return out;
}

type BotCfg = Record<string, unknown>;
type DataBag = {
  health: Record<string, unknown> | null;
  bot: { config: BotCfg; runtime: Record<string, unknown> } | null;
  cSum: Record<string, unknown> | null;
  oSum: Record<string, unknown> | null;
  cRecent: { items?: unknown[] } | null;
  oRecent: { items?: unknown[] } | null;
  eRecent: { items?: unknown[] } | null;
  bal: Record<string, unknown> | null;
  reconc: Record<string, unknown> | null;
  liveCycle: Record<string, unknown> | null;
  operational: Record<string, unknown> | null;
  ticker: Record<string, unknown>;
  specInfo: Record<string, unknown>;
  marketTickers: Record<string, Record<string, unknown>>;
};

function LiveAutoPanel({ lc, btcStrategyEnabled }: { lc: Record<string, unknown> | null; btcStrategyEnabled?: boolean }) {
  if (!lc || typeof lc !== "object") return <p className="muted">Indisponível</p>;
  const pres = fullAutoStatusPresentation(lc);
  const checks = (lc.checks as Array<{ name: string; ok: boolean; message?: string }>) ?? [];
  const when = (v: unknown) => {
    if (v == null || v === "") return "—";
    try {
      return new Date(String(v)).toLocaleString("pt-BR");
    } catch {
      return "—";
    }
  };
  const lastErr = lc.lastError != null && String(lc.lastError).trim() !== "" ? String(lc.lastError) : "";
  const consec = Number(lc.consecutiveErrors);
  const circRaw = lc.circuitOpenUntil;
  const hasCirc = circRaw != null && String(circRaw).trim() !== "" && String(circRaw) !== "—";
  const quoteCcy = String(lc.quoteCurrency ?? "").trim();
  const dropLevels = Array.isArray(lc.dropBuyReferencePrices) ? (lc.dropBuyReferencePrices as unknown[]) : [];

  return (
    <>
      <div className="fullauto-status-badge">
        <span className={`badge ${pres.cls}`}>{pres.badge}</span>
      </div>
      <div className="kv-grid">
        <KvNum label="Mercado" value={String(lc.market ?? "—")} mono={false} />
        <KvNum label="Valor por ordem (cotação)" value={String(lc.quoteValue ?? "—")} mono={false} />
        <PctStoredRow label="Lucro-alvo por ciclo" stored={lc.targetProfitPct} />
        {!btcStrategyEnabled ? (
          <PctStoredRow label="Passo da grelha (legado — inativo com BTC Drop)" stored={lc.gridStepPct} />
        ) : null}
        {lc.referenceLastPrice != null && String(lc.referenceLastPrice).trim() !== "" ? (
          <KvNum
            label="Último (base dos alvos na queda)"
            value={`${String(lc.referenceLastPrice)} ${quoteCcy || "—"}`}
            mono
          />
        ) : null}
        {dropLevels.length > 0 ? (
          <KvNum
            label={btcStrategyEnabled ? "Alvos na queda (legado — BTC Drop usa níveis USDT)" : "Alvos na queda (legado)"}
            value={dropLevels.map((p, i) => `${i + 1}º: ${String(p)}${quoteCcy ? ` ${quoteCcy}` : ""}`).join(" · ")}
            mono={false}
          />
        ) : null}
        <KvNum label="Última atividade do motor" value={when(lc.lastTickAt)} mono={false} />
        <KvNum label="Última ordem concluída" value={when(lc.lastSuccessAt)} mono={false} />
        {lastErr ? <KvNum label="Último erro" value={lastErr} mono={false} /> : null}
        {Number.isFinite(consec) && consec > 0 ? <KvNum label="Erros seguidos" value={String(consec)} mono={false} /> : null}
        {hasCirc ? <KvNum label="Proteção ativa até" value={when(circRaw)} mono={false} /> : null}
        <KvNum label="Última decisão" value={trAutoDecision(lc.lastDecision) || String(lc.lastDecision ?? "—")} mono={false} />
      </div>
      {checks.length > 0 ? (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>
            Condições
          </div>
          <ChecksList checks={checks} />
        </>
      ) : null}
    </>
  );
}

function BotParamsView({
  cfg,
  rt,
  btcStrategyEnabled,
}: {
  cfg: BotCfg;
  rt: Record<string, unknown>;
  btcStrategyEnabled: boolean;
}) {
  return (
    <div className="params-sections">
      <div className="param-block">
        <h3>Estratégia</h3>
        {btcStrategyEnabled ? (
          <p className="muted small" style={{ marginBottom: 8 }}>
            <strong>BTC Drop 2K</strong> ativa via <code>BTC_STRATEGY_ENABLED</code> no <code>.env</code>. Ordem (quote), passo da grelha e lucro-alvo abaixo são{" "}
            <strong>legado/inativos</strong> para o Auto LIVE (ver variáveis <code>BTC_*</code> no servidor).
          </p>
        ) : null}
        <div className="kv-grid">
          <KvNum label="Mercado" value={cfg.market} mono={false} />
          <KvNum label="Ordem (quote)" value={cfg.orderQuoteSize} mono={false} />
          <PctStoredRow label="Lucro-alvo por ciclo (compra → venda)" stored={cfg.targetProfitPct} />
          <PctStoredRow label="Passo da grelha (ilustrativo no resumo)" stored={cfg.gridStepPct} />
          <PctStoredRow label="Margem de taxas" stored={cfg.feeBufferPct} />
        </div>
      </div>
      <div className="param-block">
        <h3>Risco</h3>
        <div className="kv-grid">
          <KvNum label="Máx. ciclos abertos" value={cfg.maxOpenCycles} mono={false} />
          <KvNum label="Alocação máx. (quote)" value={cfg.maxQuoteAllocation} mono={false} />
          <KvNum label="Saldo mín. (quote)" value={cfg.minQuoteBalance} mono={false} />
        </div>
      </div>
      <div className="param-block">
        <h3>Estado na base de dados</h3>
        <div className="kv-grid">
          <KvNum label="Estado do motor" value={trRuntimeStatus(cfg.runtimeStatus)} mono={false} />
          <KvNum label="Modo de execução" value={trExecutionMode(cfg.executionMode)} mono={false} />
        </div>
      </div>
      <div className="param-block">
        <h3>Ambiente REAL ONLY (só leitura)</h3>
        <div className="kv-grid">
          <KvNum label="Modo Genesis" value={String(rt.genesisMode ?? "REAL_ONLY")} mono={false} />
          <KvNum label="Dados" value="CoinEx (MARKET_DATA_SOURCE=COINEX)" mono={false} />
          <KvNum label="Saldo" value="CoinEx (PORTFOLIO_BALANCE_SOURCE=COINEX)" mono={false} />
          <KvNum label="ENABLE_LIVE_TRADING" value={String(rt.enableLiveTrading)} mono={false} />
          <KvNum label="ENABLE_AUTO_LIVE_WORKER" value={String(rt.enableAutoLiveWorker)} mono={false} />
          <KvNum label="BTC Drop 2K" value={rt.btcStrategyEnabled ? `ativo (${rt.btcStrategyMarket})` : "inativo"} mono={false} />
          <KvNum label="Allowlist LIVE" value={String(rt.liveMarketAllowlist ?? "—")} mono={false} />
        </div>
      </div>
    </div>
  );
}

const CONFIG_FIELDS: { name: string; label: string }[] = [
  { name: "market", label: "Mercado" },
  { name: "orderQuoteSize", label: "Ordem (quote)" },
  { name: "targetProfitPct", label: "Lucro-alvo por ciclo (0,02 ou 2 = 2% sobre o preço de entrada)" },
  {
    name: "gridStepPct",
    label:
      "Passo da grelha (fração; ex. 0,02 ou 2 = 2% abaixo do último — usado só no resumo visual do painel; o Auto LIVE compra ao mercado)",
  },
  { name: "maxOpenCycles", label: "Máx. ciclos abertos" },
  { name: "maxQuoteAllocation", label: "Alocação máx. (quote)" },
  { name: "minQuoteBalance", label: "Saldo mín. (quote)" },
  { name: "feeBufferPct", label: "Margem de taxas (fração; ex. 0,002 = 0,2%)" },
];

export default function DashboardApp() {
  const { loading, authRequired, session, invalidateSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state: botSpotState, refresh: refreshBotSpot } = useBotSpotState(5000);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [data, setData] = useState<DataBag | null>(null);
  const [healthOk, setHealthOk] = useState<"good" | "warn" | "danger">("good");
  const [editingConfig, setEditingConfig] = useState(false);
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [eventFilter, setEventFilter] = useState("all");
  const { toast, show } = useToast();

  useEffect(() => {
    const p = location.pathname;
    if (
      p === "/legacy" ||
      p.startsWith("/legacy/") ||
      p === "/bot-spot" ||
      p.startsWith("/bot-spot/")
    ) {
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  const loadAll = useCallback(async () => {
    const paths: [string, keyof Omit<DataBag, "ticker" | "specInfo">][] = [
      ["/health", "health"],
      ["/bot/config", "bot"],
      ["/cycles/summary", "cSum"],
      ["/orders/summary", "oSum"],
      ["/cycles/recent", "cRecent"],
      ["/orders/recent", "oRecent"],
      ["/events/recent", "eRecent"],
      ["/portfolio/balance", "bal"],
      ["/reconciliation/live-summary", "reconc"],
      ["/live-cycle/summary", "liveCycle"],
      ["/bot/operational-status", "operational"],
    ];
    const settled = await Promise.allSettled(paths.map(([p]) => apiGet(p)));
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === "fulfilled" && res.value.status === 401) {
        await apiPostLogout();
        invalidateSession();
        show("Sessão expirada ou sem permissão. Inicia sessão de novo.", "err");
        return;
      }
    }
    const bag = {} as Omit<DataBag, "ticker" | "specInfo">;
    settled.forEach((res, i) => {
      const key = paths[i][1];
      if (res.status === "fulfilled" && res.value.ok) (bag as Record<string, unknown>)[key] = res.value.data;
      else (bag as Record<string, unknown>)[key] = null;
    });

    const health = bag.health as Record<string, unknown> | null;
    if (health && health.status === "ok" && health.database === "up") setHealthOk("good");
    else if (health) setHealthOk("warn");
    else {
      setHealthOk("danger");
      show("Falha ao contactar /health", "err");
    }

    const botWrap = bag.bot as DataBag["bot"];
    if (!botWrap?.config || !botWrap.runtime) {
      show("Falha ao carregar /bot/config", "err");
      return;
    }
    const cfg = botWrap.config as BotCfg;
    const rtRow = botWrap.runtime as Record<string, unknown>;
    const primaryMarket = String(cfg.market ?? "BTCUSDC").toUpperCase();
    const lcBag = bag.liveCycle as Record<string, unknown> | null;
    const activeFromWorker = Array.isArray(lcBag?.activeMarkets)
      ? (lcBag!.activeMarkets as unknown[]).map((m) => String(m).trim().toUpperCase()).filter(Boolean)
      : [];
    const markets =
      activeFromWorker.length > 0
        ? [...new Set([primaryMarket, ...activeFromWorker])]
        : [primaryMarket];

    const tickerRes = await apiGet(`/market/ticker/${encodeURIComponent(primaryMarket)}`);
    const specRes = await apiGet(`/market/info/${encodeURIComponent(primaryMarket)}`);
    const extraTickerSettled = await Promise.allSettled(
      markets.filter((m) => m !== primaryMarket).map((m) => apiGet(`/market/ticker/${encodeURIComponent(m)}`)),
    );
    if (tickerRes.status === 401 || specRes.status === 401) {
      await apiPostLogout();
      invalidateSession();
      show("Sessão expirada ou sem permissão. Inicia sessão de novo.", "err");
      return;
    }
    const marketTickers: Record<string, Record<string, unknown>> = {};
    if (tickerRes.ok) marketTickers[primaryMarket] = tickerRes.data as Record<string, unknown>;
    let extraIdx = 0;
    for (const m of markets) {
      if (m === primaryMarket) continue;
      const res = extraTickerSettled[extraIdx++];
      if (res.status === "fulfilled" && res.value.ok) {
        marketTickers[m] = res.value.data as Record<string, unknown>;
      }
    }
    setData({
      ...bag,
      ticker: tickerRes.ok ? (tickerRes.data as Record<string, unknown>) : {},
      specInfo: specRes.ok ? (specRes.data as Record<string, unknown>) : {},
      marketTickers,
    } as DataBag);
  }, [show, invalidateSession]);

  useEffect(() => {
    if (loading) return;
    if (authRequired && !session) {
      navigate("/login", { replace: true });
    }
  }, [loading, authRequired, session, navigate]);

  useEffect(() => {
    if (loading) return;
    if (authRequired && !session) return;
    void loadAll();
    const id = window.setInterval(() => void loadAll(), 5000);
    return () => window.clearInterval(id);
  }, [loading, authRequired, session, loadAll]);

  const logout = async () => {
    await apiPostLogout();
    invalidateSession();
    setData(null);
    show("Sessão terminada.", "muted");
    navigate("/login", { replace: true });
  };

  const cfg = data?.bot?.config as BotCfg | undefined;
  const rt = data?.bot?.runtime as Record<string, unknown> | undefined;

  const openOrders = useMemo(() => {
    const o = data?.oSum as { byStatus?: Record<string, number> } | null;
    if (!o?.byStatus) return 0;
    return (
      (o.byStatus.OPEN ?? 0) +
      (o.byStatus.PARTIALLY_FILLED ?? 0) +
      (o.byStatus.PENDING ?? 0)
    );
  }, [data?.oSum]);

  const rh = useMemo(() => reconcHealthSummary(data?.reconc ?? null), [data?.reconc]);
  const faPres = useMemo(() => fullAutoStatusPresentation(data?.liveCycle ?? null), [data?.liveCycle]);
  const overviewStrategy = useMemo(() => {
    if (!cfg || !data) return null;
    const mkt = String(cfg.market ?? "BTCUSDC");
    const lastRaw = data.ticker?.last;
    const lastN =
      lastRaw === null || lastRaw === undefined || String(lastRaw).trim() === ""
        ? null
        : Number(String(lastRaw).replace(",", "."));
    const last = lastN != null && Number.isFinite(lastN) ? lastN : null;
    const grid = parseCfgFraction(cfg.gridStepPct);
    const tp = parseCfgFraction(cfg.targetProfitPct);
    const fee = parseCfgFraction(cfg.feeBufferPct) ?? 0;
    const qDec = Math.min(18, Math.max(0, Math.floor(Number(data.specInfo?.quotePrecision ?? 2))));
    const active = findActiveOpenCycle(data.cRecent?.items as unknown[] | undefined, mkt);
    let entry: number | null = null;
    let target: number | null = null;
    if (active) {
      const er = active.entryPrice;
      const trg = active.targetPrice;
      if (er !== null && er !== undefined && String(er).trim() !== "") {
        const x = Number(String(er).replace(",", "."));
        entry = Number.isFinite(x) ? x : null;
      }
      if (trg !== null && trg !== undefined && String(trg).trim() !== "") {
        const y = Number(String(trg).replace(",", "."));
        target = Number.isFinite(y) ? y : null;
      }
    }
    const buyPx = active ? orderPrice(active) : null;
    const sellPx = active ? sellOrderPrice(active) : null;
    const levels = last != null && grid != null ? nextGridBuyLevels(last, grid, qDec, 4) : [];
    const lc = data.liveCycle as Record<string, unknown> | undefined;
    const lcMkt = String(lc?.market ?? "").toUpperCase();
    const rawDrops = lc?.dropBuyReferencePrices;
    const apiDropLevels = Array.isArray(rawDrops) ? (rawDrops as unknown[]).map((x) => String(x)) : [];
    const apiDropQuote = String(lc?.quoteCurrency ?? "");
    const useApiDrops = lcMkt === mkt.toUpperCase() && apiDropLevels.length > 0;
    const next1FromApi =
      useApiDrops && apiDropLevels[0] ? Number(String(apiDropLevels[0]).replace(",", ".")) : null;
    const next1Client = levels[0] ?? null;
    const next1 =
      next1FromApi != null && Number.isFinite(next1FromApi) ? next1FromApi : next1Client != null ? next1Client : null;
    const sellAfterNext = next1 != null && tp != null ? approximateSellTarget(next1, tp, fee, qDec) : null;
    const quoteSym = parseSpotMarketPair(mkt).quote;
    return {
      quoteSym,
      last,
      grid,
      tp,
      active,
      buyPx,
      sellPx,
      entry,
      target,
      levels,
      apiDropLevels: useApiDrops ? apiDropLevels : [],
      apiDropQuote,
      sellAfterNext,
      cycleStatus: active ? String(active.status ?? "") : "",
      qDec,
    };
  }, [cfg, data]);

  const btcStrategyEnabled = Boolean(data?.liveCycle && (data.liveCycle as Record<string, unknown>).btcStrategyEnabled);

  const btcDropSnapshot = useMemo((): BtcDropPanelSnapshot | null => {
    const lc = data?.liveCycle as Record<string, unknown> | undefined;
    const rtLayer = String(data?.bot?.runtime?.executionLayer ?? "");
    if (!lc) return null;
    const drop = lc.btcDropState as Record<string, unknown> | null | undefined;
    return {
      enabled: Boolean(lc.btcStrategyEnabled),
      market: String(lc.market ?? "BTCUSDT"),
      anchorPrice: drop?.anchorPrice != null ? String(drop.anchorPrice) : null,
      nextBuyPrice: drop?.nextBuyPrice != null ? String(drop.nextBuyPrice) : null,
      stepUsdt: String(drop?.stepUsdt ?? "2000"),
      baseAmount: String(drop?.baseAmount ?? "0.0001"),
      targetProfitPct: String(drop?.targetProfitPct ?? lc.targetProfitPct ?? "0.02"),
      estimatedQuoteValueAtNextBuy:
        drop?.estimatedQuoteValueAtNextBuy != null ? String(drop.estimatedQuoteValueAtNextBuy) : null,
      updatedAt: drop?.updatedAt != null ? String(drop.updatedAt) : null,
      executionLayer: rtLayer,
      liveTradingEnabled: Boolean(lc.liveTradingEnabled),
    };
  }, [data?.liveCycle, data?.bot?.runtime]);

  const filteredEvents = useMemo(() => {
    const items = (data?.eRecent?.items ?? []) as Array<Record<string, unknown>>;
    if (eventFilter === "error") return items.filter((e) => String(e.level).toUpperCase() === "ERROR");
    if (eventFilter === "live")
      return items.filter((e) => {
        const t = String(e.type ?? "").toUpperCase();
        return (
          t.includes("LIVE") ||
          t.includes("BTC_DROP") ||
          t.includes("BALANCE") ||
          t.includes("MARKET_SPEC") ||
          t.includes("RECONCIL")
        );
      });
    if (eventFilter === "cycle")
      return items.filter((e) =>
        String(e.type ?? "")
          .toUpperCase()
          .includes("CYCLE"),
      );
    return items;
  }, [data?.eRecent, eventFilter]);

  const startEditConfig = async () => {
    const res = await apiGet("/bot/config");
    if (!res.ok) {
      show(String(res.error ?? "bot/config"), "err");
      return;
    }
    const c = (res.data as { config: BotCfg }).config;
    const draft: Record<string, string> = {};
    for (const { name } of CONFIG_FIELDS) {
      const v = c[name];
      draft[name] = v === null || v === undefined ? "" : String(v);
    }
    setFormDraft(draft);
    setEditingConfig(true);
  };

  const saveConfig = async () => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(formDraft)) {
      const s = v.trim();
      if (s === "") continue;
      body[k] = k === "maxOpenCycles" ? Number(s) : s;
    }
    const normalized = normalizeConfigPatchBody(body);
    if (Object.keys(normalized).length === 0) {
      show("Nada para salvar.", "err");
      return;
    }
    try {
      await apiPatch("/bot/config", normalized);
      show("Configuração gravada na base de dados.", "ok");
      setEditingConfig(false);
      await loadAll();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const opAction = async (action: string) => {
    try {
      if (action === "mode-live") {
        if (
          !window.confirm(
            "Ativar execução na conta real na base de dados? É preciso trading real ativo no ambiente (.env) e confirmação na API.",
          )
        )
          return;
        await apiPost("/bot/mode/live", { confirm: "ENABLE_LIVE_TRADING" });
      }
      if (action === "pause-buys") await apiPost("/bot/pause-buys", {});
      if (action === "sell-only") await apiPost("/bot/sell-only", {});
      if (action === "stop") await apiPost("/bot/stop", {});
      if (action === "kill") await apiPost("/bot/kill-switch", {});
      show("Comando aplicado.", "ok");
      await loadAll();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const resetCircuit = async () => {
    try {
      await apiPost("/live-cycle/reset-circuit-breaker", {});
      show("Proteção reposta (memória do processo).", "ok");
      await loadAll();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const resetTradingData = async () => {
    if (
      !window.confirm(
        "Apagar TODO o histórico local: ciclos, ordens, negócios, eventos e âncoras? Em seguida o bot tenta 1 compra inicial a MERCADO (se o motor estiver RUNNING e LIVE ativo). Isto NÃO cancela ordens já abertas na CoinEx.",
      )
    ) {
      return;
    }
    const typed = window.prompt(
      'Para confirmar, escreva exatamente: RESET_ALL_TRADING_DATA',
      "",
    );
    if (typed !== "RESET_ALL_TRADING_DATA") {
      if (typed !== null) show("Confirmação incorreta — reset cancelado.", "err");
      return;
    }
    try {
      const res = await apiPost<{
        ok?: boolean;
        message?: string;
        counts?: Record<string, number>;
        bootstrap?: { ok?: boolean; message?: string; cycleId?: string };
      }>("/bot/reset-trading-data", { confirm: "RESET_ALL_TRADING_DATA", bootstrapBuy: true, stopMotor: false });
      const n = res.counts
        ? `${res.counts.tradeCycles ?? 0} ciclos, ${res.counts.orders ?? 0} ordens`
        : "dados";
      show(res.message ?? `Reset concluído (${n}).`, "ok");
      await loadAll();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Visão geral" },
    { id: "operation", label: "Operação" },
    { id: "market", label: "Mercado e saldo" },
    { id: "fullauto", label: "Automático" },
    { id: "params", label: "Parâmetros" },
    { id: "cycles", label: "Ciclos & ordens" },
    { id: "reconc", label: "Conciliação" },
    { id: "events", label: "Eventos" },
    { id: "grafico", label: "Gráfico" },
  ];

  const fullCardClass = data?.liveCycle
    ? `panel panel-fullauto ${faPres.card}`.trim() + (data.liveCycle.liveTradingEnabled ? " fullauto--live-edge" : "")
    : "panel panel-fullauto";

  const market = String(cfg?.market ?? "BTCUSDC");
  const { quote, base } = parseSpotMarketPair(market);
  const cx = data?.bal?.coinex as
    | { available?: boolean; updatedAt?: string; balances?: Array<{ asset: string; available: string; frozen: string; total: string }>; error?: string; authFailed?: boolean }
    | undefined;

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="muted">A carregar…</p>
      </div>
    );
  }

  if (authRequired && !session) {
    return (
      <div className="auth-screen">
        <p className="muted">A redirecionar para o login…</p>
      </div>
    );
  }

  return (
    <>
      {!authRequired ? (
        <div className="banner-stack">
          <div className="banner banner-auth-off" role="status">
            <strong>Dashboard sem login.</strong> No servidor está <code className="mono">DASHBOARD_AUTH_ENABLED=false</code>{" "}
            (omissão). Quem abrir este URL (incluindo guia anónima) vê o painel. Para exigir email + código 2FA: liga{" "}
            <code className="mono">DASHBOARD_AUTH_ENABLED=true</code> e configura JWT, utilizadores e SMTP no{" "}
            <code className="mono">.env</code>.
          </div>
        </div>
      ) : null}
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <BrandLogo size={56} />
            </span>
            <div className="brand-text">
              <h1 className="brand-title">Genesis SPOT</h1>
              <p className="tagline">Real CoinEx Mode · BTC Drop 2K · ciclos isolados</p>
            </div>
          </div>
          <div className="header-toolbar">
            <div
              className="header-toolbar-cluster"
              style={{ display: "inline-flex", alignItems: "center", gap: "18px", flexWrap: "nowrap" }}
            >
              <span className={`badge ${healthOk === "good" ? "badge-good" : healthOk === "warn" ? "badge-warn" : "badge-danger"}`}>
                {healthOk === "good" ? "API operacional" : healthOk === "warn" ? "API degradada" : "API com erro"}
              </span>
              <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
                Atualizar
              </button>
              {authRequired ? (
                <button type="button" className="btn ghost" onClick={() => void logout()}>
                  Sair
                </button>
              ) : null}
            </div>
            <span className="header-meta">
              <span className="muted">Última atualização</span>
              <time className="mono">{new Date().toLocaleString("pt-BR")}</time>
            </span>
          </div>
          {cfg && rt ? (
            <RealOnlyHeader
              runtimeStatus={rt.runtimeStatus}
              executionLayer={rt.executionLayer}
              liveTradingEnabled={Boolean(rt.enableLiveTrading)}
              autoWorkerOn={Boolean(rt.enableAutoLiveWorker)}
              killSwitch={String(rt.runtimeStatus) === "KILL_SWITCH"}
            />
          ) : null}
        </div>
      </header>

      <main className="site-main">
        <nav className="tabs" role="tablist" aria-label="Secções do painel">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn ${activeTab === t.id ? "tab-btn-active" : ""}`}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && data && cfg && rt && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <BotSpotErrorsPanel errors={botSpotState?.errors ?? []} />
            <RealOnlyDashboard
              cfg={cfg}
              rt={rt}
              ticker={data.ticker}
              specInfo={data.specInfo}
              bal={data.bal}
              reconc={data.reconc}
              liveCycle={data.liveCycle}
              operational={data.operational}
              btcDrop={btcDropSnapshot}
              openOrders={openOrders}
              openCycles={Number((data.cSum as { openCycles?: number })?.openCycles ?? 0)}
              marketTickers={data.marketTickers ?? {}}
              cSum={data.cSum}
              cyclesRecent={data.cRecent?.items as unknown[] | undefined}
            />
            {cfg && overviewStrategy ? (
              <OverviewAnalyticsBlock
                cycles={data.cRecent?.items as unknown[] | undefined}
                quoteSym={quote}
                strategy={overviewStrategy}
                baseBalanceLine={fmtBalLine(pickAsset(cx?.balances, base))}
                baseSymbol={base}
              />
            ) : null}
            {btcStrategyEnabled && btcDropSnapshot ? (
              <BtcDropStrategyPanel
                snapshot={btcDropSnapshot}
                quoteCcy={btcDropSnapshot.market ? parseSpotMarketPair(btcDropSnapshot.market).quote : quote}
                onRefresh={() => void loadAll()}
              />
            ) : null}
          </section>
        )}

        {activeTab === "operation" && data && cfg && rt && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <div className="panel panel-controls">
              <h2 className="panel-title">Controlo operacional</h2>
              <p className="panel-lead panel-lead-op">
                <strong>REAL ONLY:</strong> ON/OFF do motor no Postgres. Não existe modo observação — motor <code>OFF</code> = sem ordens;{" "}
                <code>RUNNING</code> + travas OK = ordens reais CoinEx.
              </p>
              <div className="alert alert-warn">
                <strong>ENABLE_AUTO_LIVE_WORKER</strong> é controlado pelo <code>.env</code> do servidor (
                <strong>{rt.enableAutoLiveWorker ? "true" : "false"}</strong>). Não há botão na API para ligar o worker automático.
              </div>
              <div className="alert alert-warn">
                <strong>Paragem de emergência</strong> não cancela por si só as ordens já abertas na CoinEx.
              </div>
              <div className="mode-line">
                <span className="muted">Motor</span>
                <span className="mono">{trRuntimeStatus(rt.runtimeStatus)}</span>
                <span className="muted">Execução</span>
                <span className="mono">{trExecutionMode(rt.executionMode)}</span>
                <span className={`badge ${cfg.enabled ? "badge-good" : "badge-neutral"}`}>{cfg.enabled ? "Ativado" : "Desativado"}</span>
              </div>
              <div className="btn-grid btn-grid-op">
                <button type="button" className="btn btn-live" onClick={() => void opAction("mode-live")}>
                  Conta real (LIVE)
                </button>
                <button type="button" className="btn" onClick={() => void opAction("pause-buys")}>
                  Pausar compras
                </button>
                <button type="button" className="btn" onClick={() => void opAction("sell-only")}>
                  Só vendas
                </button>
                <button type="button" className="btn" onClick={() => void opAction("stop")}>
                  Desligar motor
                </button>
                <button type="button" className="btn btn-kill" onClick={() => void opAction("kill")}>
                  Paragem de emergência
                </button>
                <button type="button" className="btn" onClick={() => void resetCircuit()}>
                  Reset circuit breaker
                </button>
                <button type="button" className="btn btn-kill" onClick={() => void resetTradingData()}>
                  Apagar histórico (ciclos/estatísticas)
                </button>
              </div>
              <p className="muted small" style={{ marginTop: 12 }}>
                Reset dos níveis BTC Drop: aba Automático ou Ciclos. «Apagar histórico» limpa a base local; não cancela ordens na CoinEx.
              </p>
            </div>
            <OperationalChecksPanel
              operational={
                data.operational as {
                  checks?: Array<{ id: string; ok: boolean; label: string; detail?: string }>;
                  readyForAutoLive?: boolean;
                  blockingSummary?: string[];
                } | null
              }
              liveCycle={data.liveCycle}
              enableAutoLiveWorker={Boolean(rt.enableAutoLiveWorker)}
            />
          </section>
        )}

        {activeTab === "market" && data && cfg && rt && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <div className="two-col two-col-market">
              <div className="panel panel-market">
                <h2 className="panel-title">Mercado</h2>
                <div className="market-block" aria-live="polite">
                  <header className="market-hero">
                    <p className="market-hero-pair">
                      Par <strong className="mono">{market}</strong>
                    </p>
                    <p className="market-hero-price">
                      <span className="market-hero-price-label">Último preço</span>
                      <span className="market-hero-price-value mono">
                        {data.ticker?.last != null ? fmtNum(data.ticker.last) : "—"}{" "}
                        <span className="market-hero-quote">{quote}</span>
                      </span>
                    </p>
                  </header>
                  <dl className="market-meta">
                    <div className="market-meta-row">
                      <dt>Fonte do preço</dt>
                      <dd>{priceSourceLabel(data.ticker?.priceSource)}</dd>
                    </div>
                    <div className="market-meta-row">
                      <dt>Modo gravado</dt>
                      <dd>{trExecutionMode(rt.executionMode)}</dd>
                    </div>
                    <div className="market-meta-row">
                      <dt>Conta usada pelo motor</dt>
                      <dd>{trExecutionLayer(rt.executionLayer)}</dd>
                    </div>
                  </dl>
                  <p className="market-updated">
                    {data.ticker?.updatedAt
                      ? `Preço atualizado em ${new Date(String(data.ticker.updatedAt)).toLocaleString("pt-BR")}`
                      : "A aguardar preço…"}
                  </p>
                  <h3 className="market-spec-heading">Limites e taxas do par (corretora)</h3>
                  <div className={`market-spec-block ${data.specInfo?.market ? "" : "market-spec-block--empty"}`}>
                    {!data.specInfo?.market ? (
                      <p className="market-spec-empty">Dados do par ainda não chegaram.</p>
                    ) : (
                      <>
                        <div className="spec-line">
                          <span className="spec-line-label">Origem destes dados</span>
                          <strong className="spec-line-value mono">{String(data.specInfo.source ?? "—")}</strong>
                        </div>
                        <div className="spec-line">
                          <span className="spec-line-label">Casas decimais (base · cotação)</span>
                          <strong className="spec-line-value mono">
                            {String(data.specInfo.basePrecision)} · {String(data.specInfo.quotePrecision)}
                          </strong>
                        </div>
                        <div className="spec-line">
                          <span className="spec-line-label">Quantidade mínima por ordem (base)</span>
                          <strong className="spec-line-value mono">
                            {String(data.specInfo.minAmount)} {String(data.specInfo.baseCurrency)}
                          </strong>
                        </div>
                        <div className="spec-line">
                          <span className="spec-line-label">Valor mínimo por ordem (cotação)</span>
                          <strong className="spec-line-value mono">
                            {data.specInfo.minValue != null && data.specInfo.minValue !== ""
                              ? `${data.specInfo.minValue} ${data.specInfo.quoteCurrency}`
                              : "—"}
                          </strong>
                        </div>
                        <div className="spec-line">
                          <span className="spec-line-label">Taxa passiva · taxa imediata</span>
                          <strong className="spec-line-value mono">
                            {feeRateToPct(data.specInfo.makerFeeRate)} · {feeRateToPct(data.specInfo.takerFeeRate)}
                          </strong>
                        </div>
                        <div className="spec-line spec-line-wide">
                          <span className="spec-line-label">Estado na CoinEx</span>
                          <strong className="spec-line-value">
                            API de negociação {data.specInfo.apiTradingEnabled ? "ativa" : "inativa"}
                            {" · "}
                            Livro {data.specInfo.tradingEnabled ? "aberto" : "fechado"}
                          </strong>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="panel panel-balances">
                <h2 className="panel-title">Saldos</h2>
                <p className="alert balance-motor-notice alert-warn">
                  Saldos da última consulta read-only à CoinEx; a corretora é a fonte de verdade. Com motor em execução na
                  conta real, ordens podem ser enviadas.
                </p>
                <div className="balance-grid balance-grid-single">
                  {cx ? (
                    <div className="balance-card balance-card-coinex">
                      <h3 className="balance-title">Conta CoinEx</h3>
                      <p className={cx.available ? "tiny ok" : `tiny ${cx.authFailed ? "err" : "warn"}`}>
                        {cx.available
                          ? cx.updatedAt
                            ? `Ligação OK · ${new Date(cx.updatedAt).toLocaleString("pt-BR")}`
                            : "Ligação OK"
                          : cx.authFailed
                            ? `Autenticação: ${cx.error ?? "—"}`
                            : (cx.error ?? "Indisponível")}
                      </p>
                      <dl className="bal-dl">
                        <dt>{quote}</dt>
                        <dd className="mono">{fmtBalLine(pickAsset(cx.balances, quote))}</dd>
                        <dt>{base}</dt>
                        <dd className="mono">{fmtBalLine(pickAsset(cx.balances, base) ?? pickAsset(cx.balances, "BTC"))}</dd>
                      </dl>
                    </div>
                  ) : (
                    <p className="balance-empty muted">Sem dados de saldo da CoinEx neste momento.</p>
                  )}
                </div>
                <p className="balance-footnote">
                  A corretora pode mudar saldos antes disto refrescar; usa sempre a CoinEx para decisões críticas.
                </p>
              </div>
            </div>
          </section>
        )}

        {activeTab === "fullauto" && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <BtcDropStrategyPanel
              snapshot={btcDropSnapshot}
              quoteCcy={btcDropSnapshot?.market ? parseSpotMarketPair(btcDropSnapshot.market).quote : quote}
              onRefresh={() => void loadAll()}
            />
            <div id="full-auto-card" className={fullCardClass}>
              <h2 className="panel-title">Operação automática na CoinEx</h2>
              <div className="alert alert-danger">
                Pode enviar <strong>ordens limite reais</strong>. O arranque depende da configuração do servidor (variável no arquivo de ambiente).
              </div>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => void resetCircuit()}>
                  Repor proteção (circuito)
                </button>
              </div>
              <div className="fullauto-body" aria-live="polite">
                <LiveAutoPanel lc={data?.liveCycle ?? null} btcStrategyEnabled={btcStrategyEnabled} />
              </div>
            </div>
          </section>
        )}

        {activeTab === "params" && data && cfg && rt && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <BtcDropEnvReadonly state={botSpotState} />
            <div className="panel panel-nested">
              <h3 className="ov-subtitle">Worker automático (.env do servidor)</h3>
              <div className="kv-grid">
                <KvNum label="ENABLE_AUTO_LIVE_WORKER" value={rt.enableAutoLiveWorker ? "true" : "false"} mono />
                <KvNum
                  label="AUTO_LIVE_CONFIRM_ENV"
                  value={
                    (data.operational as { autoLive?: { autoLiveConfirmOk?: boolean } } | null)?.autoLive?.autoLiveConfirmOk
                      ? "confirmado"
                      : "não confirmado"
                  }
                  mono
                />
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Parâmetros do bot</h2>
                <div className="btn-row">
                  <button type="button" className="btn" hidden={editingConfig} onClick={() => void startEditConfig()}>
                    Editar configuração
                  </button>
                  <button type="button" className="btn btn-primary" hidden={!editingConfig} onClick={() => void saveConfig()}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="btn"
                    hidden={!editingConfig}
                    onClick={() => {
                      setEditingConfig(false);
                      void loadAll();
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
              <p className="muted small">
                Base de dados: estratégia e risco; o <strong>modo automático</strong> lê daqui. Percentagens são <strong>frações</strong>:{" "}
                <code>0.02</code> = 2% (também podes gravar <code>2</code> ao salvar). <strong>Passo da grelha</strong> alimenta só o resumo visual no painel (degraus
                hipotéticos abaixo do último); a <strong>entrada do Auto LIVE</strong> é <strong>compra ao mercado</strong>. <strong>Lucro-alvo</strong> = bump de preço na
                venda (limite) sobre a média da compra (mais margem de taxas).
              </p>
              {!editingConfig ? (
                <div className={`params-sections ${!cfg ? "muted" : ""}`}>{cfg ? <BotParamsView cfg={cfg} rt={rt} btcStrategyEnabled={btcStrategyEnabled} /> : <p className="muted">Carregando…</p>}</div>
              ) : (
                <form
                  className="config-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveConfig();
                  }}
                >
                  {CONFIG_FIELDS.map(({ name, label }) => (
                    <label key={name}>
                      {label}
                      <input
                        name={name}
                        type={name === "maxOpenCycles" ? "number" : "text"}
                        value={formDraft[name] ?? ""}
                        autoComplete="off"
                        onChange={(e) => setFormDraft((d) => ({ ...d, [name]: e.target.value }))}
                      />
                    </label>
                  ))}
                </form>
              )}
            </div>
          </section>
        )}

        {activeTab === "cycles" && data && cfg && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <BtcDropStrategyPanel
              snapshot={btcDropSnapshot}
              quoteCcy={btcDropSnapshot?.market ? parseSpotMarketPair(btcDropSnapshot.market).quote : quote}
              onRefresh={() => void loadAll()}
            />
            {!btcStrategyEnabled ? <StrategyGridPanel strategy={overviewStrategy} /> : null}
            <div className="panel panel-cycles-orders">
              <h2 className="panel-title">Ciclos e ordens recentes</h2>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Lista vinda da API: ciclos e ordens são entidades separadas; aqui ficam juntos para consulta rápida.
              </p>
              <div className="cycles-orders-block">
                <h3 className="ov-subtitle">Últimos ciclos</h3>
                <div className="table-responsive">
                  <table className="data-table data-table-cycles">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Mercado</th>
                        <th>Entrada</th>
                        <th>Alvo</th>
                        <th>Quote</th>
                        <th>Base</th>
                        <th>Aberto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.cRecent?.items?.length ?? 0) > 0 ? (
                        (data!.cRecent!.items as Array<Record<string, unknown>>).map((c) => (
                          <tr key={String(c.id ?? c.openedAt)}>
                            <td data-label="Status">
                              <span className={`status-badge ${cycleStatusClass(c.status)}`}>{trCycleStatus(c.status)}</span>
                            </td>
                            <td data-label="Mercado">{String(c.market ?? "—")}</td>
                            <td data-label="Entrada" dangerouslySetInnerHTML={{ __html: fmtNum(c.entryPrice) }} />
                            <td data-label="Alvo" dangerouslySetInnerHTML={{ __html: fmtNum(c.targetPrice) }} />
                            <td data-label="Quote">
                              <span dangerouslySetInnerHTML={{ __html: fmtNum(c.quoteSpent) }} /> /{" "}
                              <span dangerouslySetInnerHTML={{ __html: fmtNum(c.quoteBudget) }} />
                            </td>
                            <td data-label="Base" dangerouslySetInnerHTML={{ __html: fmtNum(c.baseFilled) }} />
                            <td data-label="Aberto">{formatDate(c.openedAt)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="muted empty-state">
                            Nenhum ciclo ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="cycles-orders-block">
                <h3 className="ov-subtitle">Últimas ordens</h3>
                <div className="table-responsive">
                  <table className="data-table data-table-orders">
                    <thead>
                      <tr>
                        <th>Lado</th>
                        <th>Tipo</th>
                        <th>Status</th>
                        <th>Preço</th>
                        <th>Qtd</th>
                        <th>Preenchido</th>
                        <th>Client ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.oRecent?.items?.length ?? 0) > 0 ? (
                        (data!.oRecent!.items as Array<Record<string, unknown>>).map((o) => (
                          <tr key={String(o.clientId ?? o.id)}>
                            <td data-label="Lado">{trOrderSide(o.side)}</td>
                            <td data-label="Tipo">{trOrderType(o.type)}</td>
                            <td data-label="Status">
                              <span className={`status-badge ${cycleStatusClass(o.status)}`}>{trOrderStatus(o.status)}</span>
                            </td>
                            <td data-label="Preço" dangerouslySetInnerHTML={{ __html: fmtNum(o.price) }} />
                            <td data-label="Qtd" dangerouslySetInnerHTML={{ __html: fmtNum(o.amount) }} />
                            <td data-label="Preenchido" dangerouslySetInnerHTML={{ __html: fmtNum(o.filledAmount) }} />
                            <td data-label="Client ID" title={String(o.clientId ?? "")}>
                              {shortId(o.clientId as string)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="muted empty-state">
                            Nenhuma ordem ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="panel panel-nested" style={{ marginTop: 16 }}>
              <h3 className="ov-subtitle">Listagem consolidada (API)</h3>
              <CyclesOrdersApiTables />
            </div>
          </section>
        )}

        {activeTab === "reconc" && data && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <BotSpotRuntimeControls state={botSpotState} onRefresh={refreshBotSpot} />
            <div className="panel">
              <h2 className="panel-title">Conciliação com a CoinEx</h2>
              <p className="muted small">
                Compara o estado das ordens com a corretora (estado da ordem e histórico de negócios). O intervalo entre conferências vem do tempo
                configurado no servidor em milissegundos.
              </p>
              <div className="alert alert-warn" hidden={!rh.stale && Boolean(data?.reconc)}>
                O processo de conciliação ainda não está estável — aguarda novas conferências ou verifica chaves e rede.
              </div>
              <div className={`reconc-grid ${data?.reconc ? "" : "muted"}`}>
                {!data?.reconc ? (
                  <p className="muted">Indisponível</p>
                ) : (
                  <div className="kv-grid">
                    <KvNum
                      label="Última conferência"
                      value={
                        typeof data.reconc.lastTickAtMs === "number" && data.reconc.lastTickAtMs > 0
                          ? new Date(data.reconc.lastTickAtMs as number).toLocaleString("pt-BR")
                          : "—"
                      }
                      mono={false}
                    />
                    <KvNum
                      label="Última conferência sem erros"
                      value={
                        typeof data.reconc.lastHealthyTickCompletedAtMs === "number" && data.reconc.lastHealthyTickCompletedAtMs > 0
                          ? new Date(data.reconc.lastHealthyTickCompletedAtMs as number).toLocaleString("pt-BR")
                          : "—"
                      }
                      mono={false}
                    />
                    <KvNum label="Ordens analisadas" value={data.reconc.ordersScanned} mono={false} />
                    <KvNum label="Ordens sincronizadas" value={data.reconc.ordersSynced} mono={false} />
                    <KvNum label="Negócios importados (última conferência)" value={data.reconc.fillsImported} mono={false} />
                    <KvNum label="Desvio na soma das execuções" value={data.reconc.fillSumDriftDetected ? "sim" : "não"} mono={false} />
                    <KvNum label="Detalhe do desvio" value={String(data.reconc.fillSumDriftDetail ?? "—")} mono={false} />
                    <KvNum label="Último erro" value={String(data.reconc.lastError ?? "—")} mono={false} />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "grafico" && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <HyperliquidChartPanel />
          </section>
        )}

        {activeTab === "events" && data && (
          <section className="tab-panel tab-panel-active" role="tabpanel">
            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Eventos operacionais</h2>
                <label className="filter-label muted small">
                  Filtrar
                  <select className="select-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
                    <option value="all">Todos</option>
                    <option value="error">Erros</option>
                    <option value="live">Conta real</option>
                    <option value="cycle">Ciclos</option>
                  </select>
                </label>
              </div>
              <ul className="events-list muted">
                {filteredEvents.length === 0 ? (
                  <li className="muted">Nenhum evento neste filtro.</li>
                ) : (
                  filteredEvents.map((e, i) => {
                    const lvl = String(e.level ?? "").toUpperCase();
                    const lvlPt = trEventLevel(e.level);
                    const bcls = lvl === "ERROR" ? "badge-danger" : lvl === "WARN" ? "badge-warn" : "badge-good";
                    const typePt = trEventType(e.type);
                    const msgPt = trEventMessage(e.message);
                    return (
                      <li key={String(e.id ?? i)} title={String(e.type ?? "")}>
                        <div className="event-head">
                          <span className={`badge ${bcls}`}>{lvlPt}</span>
                          <strong>{typePt}</strong>
                        </div>
                        <div className="event-msg">{msgPt}</div>
                        <div className="event-meta" dangerouslySetInnerHTML={{ __html: formatDate(e.createdAt) }} />
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
            <div className="panel panel-nested" style={{ marginTop: 16 }}>
              <h3 className="ov-subtitle">Eventos técnicos (API consolidada)</h3>
              <BotSpotTechnicalEvents />
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span className="footer-note">
          API local: <code className="mono">{window.location.origin}</code>
        </span>
        <span className={`toast ${toast?.kind === "err" ? "err" : toast?.kind === "ok" ? "ok" : "muted"}`} aria-live="polite">
          {toast?.msg ?? ""}
        </span>
        <span className="footer-note">Não constitui recomendação financeira.</span>
      </footer>
    </>
  );
}
