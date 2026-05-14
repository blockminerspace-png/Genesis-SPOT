/** @param {string} sel */
function qs(sel, root = document) {
  return root.querySelector(sel);
}

/** @param {string} elId */
function byId(elId) {
  return document.getElementById(elId);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function formatNumber(value, decimals = 8) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return escapeHtml(String(value));
  return escapeHtml(n.toLocaleString("pt-BR", { maximumFractionDigits: decimals }));
}

function formatMoney(value) {
  return formatNumber(value, 6);
}

function formatPct(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return escapeHtml(String(value));
  return escapeHtml(`${(n * 100).toFixed(2)}%`);
}

/** Valor em Postgres/API é fração (0.02 = 2%). */
const PCT_FORM_KEYS = new Set(["targetProfitPct", "gridStepPct", "feeBufferPct"]);

/** Percentagem inteira 1–100 → fração (1 → 0,01; 2 → 0,02). Valores não inteiros mantêm-se. */
function normalizeStoredFraction(raw) {
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return s;
  if (Number.isInteger(n) && n >= 1 && n <= 100) return String(n / 100);
  return s;
}

/** @param {Record<string, unknown>} body */
function normalizeConfigPatchBody(body) {
  const out = { ...body };
  for (const k of PCT_FORM_KEYS) {
    if (typeof out[k] === "string") out[k] = normalizeStoredFraction(out[k]);
  }
  return out;
}

function pctStoredRow(label, stored) {
  const s0 = stored === null || stored === undefined ? "" : String(stored).trim();
  const n = Number(s0.replace(",", "."));
  let right;
  if (!s0 || !Number.isFinite(n)) right = escapeHtml(s0 || "—");
  else {
    const pct = (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    right = `${escapeHtml(pct)}% <span class="muted">(fração ${escapeHtml(s0)})</span>`;
  }
  return `<div class="kv-row"><span>${escapeHtml(label)}</span><span class="mono" style="text-align:right">${right}</span></div>`;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return escapeHtml(new Date(value).toLocaleString("pt-BR"));
  } catch {
    return escapeHtml(String(value));
  }
}

/** Estados do motor (Postgres) */
function trRuntimeStatus(v) {
  const s = String(v ?? "").toUpperCase();
  const m = {
    OFF: "Desligado",
    RUNNING: "Em execução",
    PAUSED_BUYS: "Compras pausadas",
    SELL_ONLY: "Só vendas",
    KILL_SWITCH: "Kill switch",
  };
  return m[s] ?? safeText(v, "—");
}

function trExecutionMode(v) {
  const s = String(v ?? "").toUpperCase();
  if (s === "LIVE") return "Real (LIVE)";
  if (s === "DRY_RUN") return "Simulação (DRY_RUN)";
  return safeText(v, "—");
}

function trExecutionLayer(v) {
  const s = String(v ?? "").toUpperCase();
  const m = { LIVE: "Conta real", SIMULATED: "Simulado", DISABLED: "Desativada" };
  return m[s] ?? safeText(v, "—");
}

function trMarketDataSource(v) {
  const s = String(v ?? "").toUpperCase();
  const m = {
    COINEX: "CoinEx",
    SIMULATED: "Simulado",
    BOTH: "Ambos",
    COINEX_FALLBACK: "CoinEx (fallback)",
    FORCED: "Forçado (simulação)",
  };
  return m[s] ?? safeText(v, "—");
}

function trOrderSide(v) {
  const s = String(v ?? "").toUpperCase();
  if (s === "BUY") return "Compra";
  if (s === "SELL") return "Venda";
  return safeText(v, "—");
}

function trOrderStatus(v) {
  const s = String(v ?? "").toUpperCase();
  const m = {
    PENDING: "Pendente",
    OPEN: "Aberta",
    PARTIALLY_FILLED: "Parcial",
    FILLED: "Preenchida",
    CANCELLED: "Cancelada",
    REJECTED: "Rejeitada",
    EXPIRED: "Expirada",
    UNKNOWN: "Desconhecido",
  };
  return m[s] ?? safeText(v, "—");
}

function trCycleStatus(v) {
  const s = String(v ?? "").toUpperCase();
  const m = {
    WAITING_BUY_SIGNAL: "Aguardando compra",
    BUY_PLACED: "Compra colocada",
    BUY_PARTIALLY_FILLED: "Compra parcial",
    BUY_FILLED: "Compra preenchida",
    SELL_PLACED: "Venda colocada",
    SELL_PARTIALLY_FILLED: "Venda parcial",
    CLOSED_PROFIT: "Fechado com lucro",
    CANCELLED: "Cancelado",
    ERROR: "Erro",
    MANUAL_REVIEW: "Revisão manual",
  };
  return m[s] ?? safeText(v, "—");
}

function trFullAutoBadge(s) {
  const u = String(s ?? "").toUpperCase();
  const m = {
    DISABLED: "Desativado",
    BLOCKED: "Bloqueado",
    RUNNING: "Em execução",
    CIRCUIT_OPEN: "Circuito aberto",
    ERROR: "Erro",
  };
  return m[u] ?? safeText(s, "—");
}

/** @param {string} label @param {'good'|'warn'|'danger'|'neutral'} kind */
function badge(label, kind) {
  const cls = kind === "good" ? "badge-good" : kind === "warn" ? "badge-warn" : kind === "danger" ? "badge-danger" : "badge-neutral";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function kv(label, value, mono = true) {
  const v = mono ? `<span class="mono">${fmtNum(value)}</span>` : `<span>${escapeHtml(String(value ?? "—"))}</span>`;
  return `<div class="kv-row"><span>${escapeHtml(label)}</span><span>${v}</span></div>`;
}

function kvText(label, value) {
  return `<div class="kv-row"><span>${escapeHtml(label)}</span><span class="mono" style="text-align:right">${escapeHtml(String(value ?? "—"))}</span></div>`;
}

function fmtNum(v) {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  if (s.length > 18) return `${escapeHtml(s.slice(0, 16))}…`;
  return escapeHtml(s);
}

/** @param {Array<{name:string, ok:boolean, message?:string}>|undefined} checks */
function renderChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return '<p class="muted">Sem checks.</p>';
  return `<ul class="checks-list">${checks
    .map((c) => {
      const icon = c.ok ? '<span class="check-ok" aria-hidden="true">✅</span>' : '<span class="check-err" aria-hidden="true">❌</span>';
      const msg = c.message ? ` <span class="muted">(${escapeHtml(String(c.message))})</span>` : "";
      return `<li>${icon}<span><code>${escapeHtml(c.name)}</code>${msg}</span></li>`;
    })
    .join("")}</ul>`;
}

/** @param {string[]|undefined} reasons */
function renderBlockingReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return '<p class="muted small">Nenhum bloqueio listado pelo servidor.</p>';
  }
  return `<ul class="blocking-list">${reasons.map((r) => `<li>${escapeHtml(String(r))}</li>`).join("")}</ul>`;
}

async function apiGet(path) {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : (data.error || r.statusText) };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

async function apiPost(path, body = {}) {
  const r = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error || r.statusText;
    throw new Error(`${path}: ${msg}`);
  }
  return j;
}

async function apiPatch(path, body) {
  const r = await fetch(path, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error || r.statusText;
    throw new Error(`${path}: ${msg}`);
  }
  return j;
}

function toast(msg, type = "muted") {
  const el = byId("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type === "err" ? "err" : type === "ok" ? "ok" : "muted"}`;
  if (msg) {
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => {
      el.textContent = "";
      el.className = "toast muted";
    }, 5000);
  }
}

function setHealthPill(text, kind) {
  const el = byId("health-pill");
  if (!el) return;
  el.textContent = text;
  el.className = `badge ${kind === "good" ? "badge-good" : kind === "warn" ? "badge-warn" : kind === "danger" ? "badge-danger" : "badge-neutral"}`;
}

function setEnabledBadge(cfg) {
  const en = byId("enabled-label");
  if (!en) return;
  const on = cfg?.enabled;
  en.textContent = on ? "Ativado: sim" : "Ativado: não";
  en.className = `badge ${on ? "badge-good" : "badge-neutral"}`;
}

let editingConfig = false;
let lastEventItems = [];

function shortId(cid) {
  if (!cid) return "—";
  const str = String(cid);
  return str.length > 10 ? `${str.slice(0, 6)}…${str.slice(-4)}` : str;
}

function statCard(label, value, hint = "", tone = "default") {
  const toneClass = tone === "danger" ? " stat-card--danger" : tone === "warn" ? " stat-card--warn" : "";
  const hintHtml = hint ? `<div class="stat-card-hint muted">${hint}</div>` : "";
  return `<div class="stat-card${toneClass}">
    <div class="stat-card-label">${escapeHtml(label)}</div>
    <div class="stat-card-value">${escapeHtml(String(value))}</div>
    ${hintHtml}
  </div>`;
}

function priceSourceLabel(ps) {
  switch (ps) {
    case "COINEX":
      return "Preço real (CoinEx)";
    case "COINEX_FALLBACK":
      return "CoinEx falhou — simulado";
    case "FORCED":
      return "Preço forçado (simulação)";
    case "SIMULATED":
      return "Simulado (worker interno)";
    default:
      return String(ps);
  }
}

function buildMarketLiveSummary(cfg, ticker2, rt) {
  const price = ticker2.last != null ? fmtNum(ticker2.last) : "—";
  const ps = ticker2.priceSource ?? "—";
  const psHint = priceSourceLabel(ps);
  const m = cfg.market ?? "—";
  const ex = rt.executionMode ?? "—";
  const layer = rt.executionLayer ?? "—";
  return [
    `<div class="ctx-line"><span class="muted">Mercado</span> <strong class="mono">${escapeHtml(m)}</strong></div>`,
    `<div class="ctx-line ctx-price"><span class="muted">Preço</span> <strong>${price}</strong></div>`,
    `<div class="ctx-line"><span class="muted">Fonte do preço</span> <strong>${escapeHtml(psHint)}</strong></div>`,
    `<div class="ctx-line"><span class="muted">Modo (BD)</span> <strong>${escapeHtml(trExecutionMode(ex))}</strong></div>`,
    `<div class="ctx-line"><span class="muted">Camada</span> <strong>${escapeHtml(trExecutionLayer(layer))}</strong></div>`,
  ].join("");
}

function feeRateToPct(rate) {
  try {
    const n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    return `${(n * 100).toFixed(2)}%`;
  } catch {
    return "—";
  }
}

function renderMarketSpecCard(info) {
  const el = byId("market-spec-card");
  if (!el) return;
  if (!info || !info.market) {
    el.innerHTML = `<span class="muted">Spec indisponível</span>`;
    return;
  }
  const minQ =
    info.minValue != null && info.minValue !== ""
      ? `${escapeHtml(String(info.minValue))} ${escapeHtml(info.quoteCurrency)}`
      : "—";
  const apiOk = info.apiTradingEnabled ? "ligada" : "desligada";
  const mk = feeRateToPct(info.makerFeeRate);
  const tk = feeRateToPct(info.takerFeeRate);
  const src = escapeHtml(info.source ?? "—");
  el.classList.remove("muted");
  el.innerHTML = [
    `<div class="spec-line"><span class="muted">Spec fonte</span> <strong>${src}</strong></div>`,
    `<div class="spec-line"><span class="muted">Precisão base/quote</span> <strong>${escapeHtml(String(info.basePrecision))}</strong> / <strong>${escapeHtml(String(info.quotePrecision))}</strong></div>`,
    `<div class="spec-line"><span class="muted">min_amount</span> <strong>${escapeHtml(String(info.minAmount))} ${escapeHtml(info.baseCurrency)}</strong></div>`,
    `<div class="spec-line"><span class="muted">min_value</span> <strong>${minQ}</strong></div>`,
    `<div class="spec-line"><span class="muted">Maker / Taker</span> <strong>${escapeHtml(mk)} / ${escapeHtml(tk)}</strong></div>`,
    `<div class="spec-line"><span class="muted">Negociação via API</span> <strong>${escapeHtml(apiOk)}</strong> · mercado <strong>${info.tradingEnabled ? "ativo" : "inativo"}</strong></div>`,
  ].join("");
}

function fmtBalLine(b) {
  if (!b) return "—";
  return `livre ${b.available} · bloq. ${b.frozen} · total ${b.total}`;
}

function pickAsset(balances, asset) {
  if (!Array.isArray(balances)) return null;
  return balances.find((x) => x.asset === asset) ?? null;
}

/** Par spot CoinEx (ex.: BTCUSDC → BTC + USDC). */
function parseSpotMarketPair(market) {
  const m = String(market ?? "BTCUSDC").toUpperCase();
  if (m.endsWith("USDT")) return { base: m.slice(0, -4) || "BTC", quote: "USDT" };
  if (m.endsWith("USDC")) return { base: m.slice(0, -4) || "BTC", quote: "USDC" };
  if (m.endsWith("USD")) return { base: m.slice(0, -3) || "BTC", quote: "USD" };
  return { base: "BTC", quote: "USDC" };
}

function simulatedFromPortfolioOrState(bal, simState) {
  if (bal.simulated?.balances) {
    return {
      usdt: pickAsset(bal.simulated.balances, "USDT"),
      btc: pickAsset(bal.simulated.balances, "BTC"),
    };
  }
  const s = simState?.simulation;
  if (!s) return { usdt: null, btc: null };
  return {
    usdt: { available: String(s.usdt ?? "0"), frozen: "0", total: String(s.usdt ?? "0") },
    btc: { available: String(s.btc ?? "0"), frozen: "0", total: String(s.btc ?? "0") },
  };
}

function renderPortfolioBalances(bal, simState, market) {
  const { quote, base } = parseSpotMarketPair(market);
  const lSq = byId("bal-sim-quote-lbl");
  const lSb = byId("bal-sim-base-lbl");
  const lEq = byId("bal-ex-quote-lbl");
  const lEb = byId("bal-ex-base-lbl");
  if (lSq) lSq.textContent = "USDT (sim.)";
  if (lSb) lSb.textContent = base;
  if (lEq) lEq.textContent = quote;
  if (lEb) lEb.textContent = base;

  const n = byId("portfolio-balance-notice");
  if (n) {
    const ex = bal.executionMode ?? "—";
    const motor = bal.motorUsesSimulatedBalance;
    const live = String(ex).toUpperCase() === "LIVE" && !motor;
    n.textContent = live
      ? `Execução LIVE: o motor usa saldo real na CoinEx para ordens reais quando a layer for LIVE. Saldo CoinEx abaixo é referência read-only na API.`
      : `Execução ${ex}: o motor usa saldo simulado em DRY_RUN. Saldo CoinEx (se visível) é apenas leitura.`;
    n.className = `alert ${motor || !live ? "alert-info" : "alert-warn"} balance-motor-notice`;
  }

  const { usdt: su, btc: sb } = simulatedFromPortfolioOrState(bal, simState);
  const bsu = byId("bal-sim-usdt");
  const bsb = byId("bal-sim-btc");
  if (bsu) bsu.textContent = fmtBalLine(su);
  if (bsb) bsb.textContent = fmtBalLine(sb);

  const block = byId("coinex-balance-block");
  const st = byId("bal-ex-status");
  const eu = byId("bal-ex-usdt");
  const eb = byId("bal-ex-btc");
  if (!block || !st || !eu || !eb) return;

  const cx = bal.coinex;
  if (!cx) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  if (cx.available) {
    st.textContent = cx.updatedAt ? `OK · ${new Date(cx.updatedAt).toLocaleString("pt-BR")}` : "OK";
    st.className = "tiny ok";
    eu.textContent = fmtBalLine(pickAsset(cx.balances, quote) ?? pickAsset(cx.balances, "USDT"));
    eb.textContent = fmtBalLine(pickAsset(cx.balances, base) ?? pickAsset(cx.balances, "BTC"));
  } else {
    const msg = cx.error || "indisponível";
    st.textContent = cx.authFailed ? `Auth: ${msg}` : msg;
    st.className = `tiny ${cx.authFailed ? "err" : "warn"}`;
    eu.textContent = "—";
    eb.textContent = "—";
  }
}

function reconcHealthSummary(r) {
  if (!r || typeof r !== "object") return { label: "indisponível", kind: "warn", stale: true };
  const healthyMs = r.lastHealthyTickCompletedAtMs;
  const hasHealthy = typeof healthyMs === "number" && healthyMs > 0;
  const drift = r.fillSumDriftDetected;
  const err = r.lastError;
  if (!hasHealthy) return { label: "sem tick saudável", kind: "danger", stale: true };
  if (err) return { label: "Erro", kind: "danger", stale: true };
  if (drift) return { label: "Desvio na soma dos fills", kind: "danger", stale: true };
  return { label: "saudável", kind: "good", stale: false };
}

function buildReconcLiveSummary(r) {
  if (!r || typeof r !== "object") return '<p class="muted">Indisponível</p>';
  const last =
    typeof r.lastTickAtMs === "number" && r.lastTickAtMs > 0
      ? new Date(r.lastTickAtMs).toLocaleString("pt-BR")
      : "—";
  const healthy =
    typeof r.lastHealthyTickCompletedAtMs === "number" && r.lastHealthyTickCompletedAtMs > 0
      ? new Date(r.lastHealthyTickCompletedAtMs).toLocaleString("pt-BR")
      : "—";
  const drift = r.fillSumDriftDetected ? "sim" : "não";
  const err = r.lastError ? String(r.lastError) : "—";
  const detail = r.fillSumDriftDetail ? String(r.fillSumDriftDetail) : "—";
  return `<div class="kv-grid">
    ${kvText("Último tick", last)}
    ${kvText("Último tick saudável", healthy)}
    ${kv("Ordens analisadas", r.ordersScanned, false)}
    ${kv("Ordens sincronizadas", r.ordersSynced, false)}
    ${kv("Fills importados (tick)", r.fillsImported, false)}
    ${kvText("Desvio soma fills", drift)}
    ${kvText("Detalhe do desvio", detail)}
    ${kvText("Último erro", err)}
  </div>`;
}

function fullAutoStatusPresentation(lc) {
  const s = (lc && lc.status) || "DISABLED";
  if (s === "DISABLED") return { badge: trFullAutoBadge("DISABLED"), cls: "badge-neutral", card: "fullauto--disabled" };
  if (s === "BLOCKED") return { badge: trFullAutoBadge("BLOCKED"), cls: "badge-warn", card: "" };
  if (s === "RUNNING") return { badge: trFullAutoBadge("RUNNING"), cls: "badge-good", card: "fullauto--live-edge" };
  if (s === "CIRCUIT_OPEN" || s === "ERROR")
    return { badge: trFullAutoBadge(s === "CIRCUIT_OPEN" ? "CIRCUIT_OPEN" : "ERROR"), cls: "badge-danger", card: "fullauto--live-edge" };
  return { badge: trFullAutoBadge(s), cls: "badge-warn", card: "" };
}

function buildLiveAutoWorkerPanel(lc) {
  if (!lc || typeof lc !== "object") return '<p class="muted">Indisponível</p>';
  const pres = fullAutoStatusPresentation(lc);
  const chk = Array.isArray(lc.checks)
    ? lc.checks
        .map((c) => {
          const icon = c.ok ? "✅" : "❌";
          const cls = c.ok ? "check-ok" : "check-err";
          const msg = c.message ? ` <span class="muted">(${escapeHtml(String(c.message))})</span>` : "";
          return `<li><span class="${cls}" aria-hidden="true">${icon}</span><span><code>${escapeHtml(c.name)}</code>${msg}</span></li>`;
        })
        .join("")
    : "";
  return `
    <div class="fullauto-status-badge"><span class="badge ${pres.cls}">${escapeHtml(pres.badge)}</span></div>
    <div class="kv-grid">
      ${kv("Auto LIVE no .env", lc.enabledByEnv, false)}
      ${kv("Trading real autorizado", lc.liveTradingEnabled, false)}
      ${kvText("Estado do motor", trRuntimeStatus(lc.runtimeStatus))}
      ${kvText("Modo de execução", trExecutionMode(lc.executionMode))}
      ${kvText("Mercado", lc.market ?? "—")}
      ${kvText("Valor em quote", lc.quoteValue ?? "—")}
      ${pctStoredRow("Lucro-alvo por ciclo (Parâmetros)", lc.targetProfitPct)}
      ${pctStoredRow("Passo da grelha na compra (Parâmetros)", lc.gridStepPct)}
      ${kvText("Último tick", lc.lastTickAt ?? "—")}
      ${kvText("Último sucesso", lc.lastSuccessAt ?? "—")}
      ${kvText("Último erro", lc.lastError ?? "—")}
      ${kv("Erros consecutivos", lc.consecutiveErrors ?? "—", false)}
      ${kvText("Circuito aberto até", lc.circuitOpenUntil ?? "—")}
      ${kvText("Última decisão", lc.lastDecision ?? "—")}
    </div>
    <div class="muted small" style="margin-top:8px">Verificações</div>
    <ul class="checks-list">${chk || '<li class="muted">—</li>'}</ul>`;
}

function buildConfigForm(cfg) {
  const fields = [
    ["market", "Mercado", cfg.market],
    ["orderQuoteSize", "Ordem (quote)", cfg.orderQuoteSize],
    [
      "targetProfitPct",
      "Lucro-alvo por ciclo (0,02 ou 2 = 2% sobre o preço de entrada)",
      cfg.targetProfitPct,
    ],
    ["gridStepPct", "Passo da grelha na compra (fração; ex. 0,02 ou 2 = 2% abaixo do último)", cfg.gridStepPct],
    ["maxOpenCycles", "Máx. ciclos abertos", cfg.maxOpenCycles],
    ["maxQuoteAllocation", "Alocação máx. (quote)", cfg.maxQuoteAllocation],
    ["minQuoteBalance", "Saldo mín. (quote)", cfg.minQuoteBalance],
    ["feeBufferPct", "Margem de taxas (fração; ex. 0,002 = 0,2%)", cfg.feeBufferPct],
  ];
  return fields
    .map(([name, label, val]) => {
      const type = name === "maxOpenCycles" ? "number" : "text";
      const v = val === null || val === undefined ? "" : String(val);
      return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(v)}" autocomplete="off" /></label>`;
    })
    .join("");
}

function readConfigForm() {
  const form = byId("bot-params-form");
  if (!form) return {};
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) {
    const s = String(v).trim();
    if (s !== "") out[k] = k === "maxOpenCycles" ? Number(s) : s;
  }
  return out;
}

function setConfigEditing(on) {
  editingConfig = on;
  const view = byId("bot-params-view");
  const form = byId("bot-params-form");
  if (view) view.hidden = on;
  if (form) form.hidden = !on;
  const be = byId("btn-edit-config");
  const bs = byId("btn-save-config");
  const bc = byId("btn-cancel-config");
  if (be) be.hidden = on;
  if (bs) bs.hidden = !on;
  if (bc) bc.hidden = !on;
}

function renderBotParamsView(cfg, rt) {
  const strat = [
    kvText("Mercado", cfg.market),
    kvText("Ordem (quote)", cfg.orderQuoteSize),
    pctStoredRow("Lucro-alvo por ciclo (compra → venda)", cfg.targetProfitPct),
    pctStoredRow("Passo da grelha", cfg.gridStepPct),
    pctStoredRow("Margem de taxas", cfg.feeBufferPct),
  ].join("");
  const risk = [
    kv("Máx. ciclos abertos", cfg.maxOpenCycles, false),
    kvText("Alocação máx. (quote)", cfg.maxQuoteAllocation),
    kvText("Saldo mín. (quote)", cfg.minQuoteBalance),
  ].join("");
  const runtime = [
    kvText("Estado do motor", trRuntimeStatus(cfg.runtimeStatus)),
    kvText("Modo de execução", trExecutionMode(cfg.executionMode)),
  ].join("");
  const envro = [
    kvText("Fonte de preço", trMarketDataSource(rt.marketDataSource)),
    kv("Cache preço (ms)", rt.marketDataCacheTtlMs, false),
    kv("Cache spec (ms)", rt.marketSpecCacheTtlMs, false),
    kvText("Fonte de saldo", trMarketDataSource(rt.portfolioBalanceSource)),
    kv("Trading real (.env)", rt.enableLiveTrading, false),
    kvText("Mercados permitidos (LIVE)", rt.liveMarketAllowlist),
    kv("Cache saldo (ms)", rt.portfolioBalanceCacheTtlMs, false),
    kv("Sondagem preço (ms)", rt.pricePollIntervalMs, false),
    kv("Reconciliação (ms)", rt.reconciliationIntervalMs, false),
    kv("Simulação no .env (DRY_RUN)", rt.envDryRun, false),
  ].join("");
  return `<div class="params-sections">
    <div class="param-block"><h3>Estratégia</h3><div class="kv-grid">${strat}</div></div>
    <div class="param-block"><h3>Risco</h3><div class="kv-grid">${risk}</div></div>
    <div class="param-block"><h3>Runtime (Postgres)</h3><div class="kv-grid">${runtime}</div></div>
    <div class="param-block"><h3>Ambiente (.env, só leitura)</h3><div class="kv-grid">${envro}</div></div>
  </div>`;
}

function cycleStatusClass(status) {
  const s = String(status || "").toUpperCase();
  if (s.includes("ERROR") || s.includes("MANUAL")) return "status-badge-err";
  if (s.includes("CLOSED") || s.includes("FILLED")) return "status-badge-ok";
  if (s.includes("OPEN") || s.includes("PARTIAL")) return "status-badge-warn";
  return "";
}

function renderBanners(rt, liveCycle) {
  const stack = byId("banner-stack");
  if (!stack) return;
  const parts = [];
  if (rt.runtimeStatus === "KILL_SWITCH") {
    parts.push(`<div class="banner banner-kill" role="alert"><strong>Kill switch</strong> ativo na base de dados.</div>`);
  }
  if (liveCycle && liveCycle.enabledByEnv === true) {
    parts.push(
      `<div class="banner banner-auto" role="alert"><strong>Full Auto LIVE</strong> ligado no <code>.env</code> — o worker pode enviar ordens reais se as travas permitirem.</div>`,
    );
  }
  if (rt.executionMode === "LIVE" && rt.executionLayer === "LIVE") {
    parts.push(
      `<div class="banner banner-live" role="status"><strong>Modo real (LIVE)</strong> — podem ser enviadas operações para a CoinEx.</div>`,
    );
  }
  if (rt.envDryRun === true && rt.executionMode !== "LIVE") {
    parts.push(`<div class="banner banner-dry" role="status"><strong>Simulação no .env (DRY_RUN)</strong> — ordens simuladas quando a camada for simulada.</div>`);
  }
  stack.innerHTML = parts.join("");
}

function renderEventsList(filter) {
  const ul = byId("events-list");
  if (!ul) return;
  let items = lastEventItems;
  if (filter === "error") items = items.filter((e) => String(e.level).toUpperCase() === "ERROR");
  else if (filter === "live")
    items = items.filter(
      (e) =>
        String(e.type || "")
          .toUpperCase()
          .includes("LIVE") || String(e.message || "").toUpperCase().includes("LIVE"),
    );
  else if (filter === "cycle")
    items = items.filter(
      (e) =>
        String(e.type || "")
          .toUpperCase()
          .includes("CYCLE") || String(e.type || "").includes("SIMULATED"),
    );

  if (items.length === 0) {
    ul.innerHTML = '<li class="muted">Nenhum evento neste filtro.</li>';
    return;
  }
  ul.innerHTML = items
    .map((e) => {
      const lvl = String(e.level || "").toUpperCase();
      const lvlPt = lvl === "ERROR" ? "Erro" : lvl === "WARN" ? "Aviso" : lvl === "INFO" ? "Info" : lvl;
      const bcls = lvl === "ERROR" ? "badge-danger" : lvl === "WARN" ? "badge-warn" : "badge-good";
      return `<li>
        <div class="event-head">
          <span class="badge ${bcls}">${escapeHtml(lvlPt)}</span>
          <strong class="mono">${escapeHtml(e.type || "—")}</strong>
        </div>
        <div class="event-msg">${escapeHtml(e.message || "")}</div>
        <div class="event-meta">${formatDate(e.createdAt)}</div>
      </li>`;
    })
    .join("");
}

function initTabs() {
  const tabs = qs(".tabs", document);
  if (!tabs) return;
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn || !btn.dataset.tab) return;
    const name = btn.dataset.tab;
    tabs.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("tab-btn-active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      const show = p.id === `tab-${name}`;
      p.hidden = !show;
      p.classList.toggle("tab-panel-active", show);
    });
  });
}

async function loadAll() {
  const apiBase = byId("api-base");
  if (apiBase) apiBase.textContent = window.location.origin;

  const tLast = byId("last-updated-at");
  if (tLast) tLast.textContent = new Date().toLocaleString("pt-BR");

  const paths = [
    ["/health", "health"],
    ["/bot/config", "bot"],
    ["/cycles/summary", "cSum"],
    ["/orders/summary", "oSum"],
    ["/cycles/recent", "cRecent"],
    ["/orders/recent", "oRecent"],
    ["/events/recent", "eRecent"],
    ["/portfolio/balance", "bal"],
    ["/simulation/state", "simState"],
    ["/reconciliation/live-summary", "reconc"],
    ["/live-cycle/summary", "liveCycle"],
  ];

  const settled = await Promise.allSettled(paths.map(([p]) => apiGet(p)));
  /** @type {Record<string, any>} */
  const bag = {};
  settled.forEach((res, i) => {
    const key = paths[i][1];
    if (res.status === "fulfilled" && res.value.ok) bag[key] = res.value.data;
    else bag[key] = null;
  });

  const health = bag.health;
  const botWrap = bag.bot;
  const cSum = bag.cSum;
  const oSum = bag.oSum;
  const cRecent = bag.cRecent;
  const oRecent = bag.oRecent;
  const eRecent = bag.eRecent;
  const bal = bag.bal;
  const simState = bag.simState;
  const reconc = bag.reconc;
  const liveCycle = bag.liveCycle;

  if (health && health.status === "ok" && health.database === "up") {
    setHealthPill("API operacional", "good");
  } else if (health) {
    setHealthPill("API degradada", "warn");
  } else {
    setHealthPill("API com erro", "danger");
    toast("Falha ao contactar /health", "err");
  }

  if (!botWrap || !botWrap.config || !botWrap.runtime) {
    toast("Falha ao carregar /bot/config", "err");
    return;
  }

  const cfg = botWrap.config;
  const rt = botWrap.runtime;

  byId("runtime-status-label").textContent = trRuntimeStatus(rt.runtimeStatus);
  byId("execution-mode-label").textContent = trExecutionMode(rt.executionMode);
  const layerEl = byId("execution-layer-label");
  if (layerEl) layerEl.textContent = trExecutionLayer(rt.executionLayer);
  const mdsEl = byId("market-data-source-label");
  if (mdsEl) mdsEl.textContent = trMarketDataSource(rt.marketDataSource);

  const orun = byId("op-runtime-label");
  const oex = byId("op-exec-label");
  if (orun) orun.textContent = trRuntimeStatus(rt.runtimeStatus);
  if (oex) oex.textContent = trExecutionMode(rt.executionMode);
  setEnabledBadge(cfg);
  const opEn = byId("op-enabled-badge");
  if (opEn) {
    opEn.textContent = cfg.enabled ? "Ativado" : "Desativado";
    opEn.className = `badge ${cfg.enabled ? "badge-good" : "badge-neutral"}`;
  }

  renderBanners(rt, liveCycle);

  const tickerRes = await apiGet(`/market/ticker/${encodeURIComponent(cfg.market)}`);
  const specRes = await apiGet(`/market/info/${encodeURIComponent(cfg.market)}`);
  const ticker2 = tickerRes.ok ? tickerRes.data : {};
  const specInfo = specRes.ok ? specRes.data : {};

  const sumEl = byId("market-live-summary");
  if (sumEl) sumEl.innerHTML = buildMarketLiveSummary(cfg, ticker2, rt);
  renderMarketSpecCard(specInfo);
  const tu = byId("ticker-updated");
  if (tu) tu.textContent = ticker2.updatedAt ? `Atualizado: ${new Date(ticker2.updatedAt).toLocaleString("pt-BR")}` : "Aguardando ticker…";

  renderPortfolioBalances(bal || {}, simState || {}, cfg.market);

  const openOrders = (oSum?.byStatus?.OPEN ?? 0) + (oSum?.byStatus?.PARTIALLY_FILLED ?? 0);
  const rh = reconcHealthSummary(reconc);

  const fa = liveCycle || {};
  const faPres = fullAutoStatusPresentation(fa);

  const overview = byId("overview-cards");
  if (overview) {
    overview.innerHTML = [
      statCard("Motor (runtime)", trRuntimeStatus(rt.runtimeStatus), "Postgres", rt.runtimeStatus === "RUNNING" ? "good" : "warn"),
      statCard("Execução", trExecutionMode(rt.executionMode), "Simulação / real", rt.executionMode === "LIVE" ? "danger" : "warn"),
      statCard("Camada", trExecutionLayer(rt.executionLayer), "Simulado / conta real", rt.executionLayer === "LIVE" ? "danger" : "default"),
      statCard("Mercado", cfg.market ?? "—", "", "default"),
      statCard("Preço", ticker2.last != null ? String(ticker2.last) : "—", priceSourceLabel(ticker2.priceSource), "default"),
      statCard("Fonte do preço", trMarketDataSource(ticker2.priceSource) || "—", "", "default"),
      statCard("Ciclos abertos", String(cSum?.openCycles ?? 0), "", "default"),
      statCard("Ordens abertas", String(openOrders), "Abertas + parciais", "default"),
      statCard("Reconciliador", rh.label, "Worker LIVE", rh.kind === "good" ? "good" : "danger"),
      statCard(
        "Full Auto",
        faPres.badge,
        fa.lastDecision || "",
        fa.status === "RUNNING" ? "danger" : fa.status === "BLOCKED" ? "warn" : "default",
      ),
    ].join("");
  }

  const rEl = byId("reconc-live-summary");
  if (rEl) {
    rEl.classList.remove("muted");
    rEl.innerHTML = buildReconcLiveSummary(reconc);
  }
  const rw = byId("reconc-warning");
  if (rw) {
    const show = rh.stale || !reconc;
    rw.hidden = !show;
  }

  const fullCard = byId("full-auto-card");
  if (fullCard) {
    const pres = fullAutoStatusPresentation(liveCycle || {});
    fullCard.className = `panel panel-fullauto ${pres.card}`.trim();
    if (liveCycle?.liveTradingEnabled) fullCard.classList.add("fullauto--live-edge");
  }
  const lcEl = byId("live-cycle-auto-summary");
  if (lcEl) {
    lcEl.classList.remove("muted");
    lcEl.innerHTML = liveCycle ? buildLiveAutoWorkerPanel(liveCycle) : '<p class="muted">Sem dados (/live-cycle/summary).</p>';
  }

  if (!editingConfig) {
    const bpv = byId("bot-params-view");
    if (bpv) {
      bpv.classList.remove("muted");
      bpv.innerHTML = renderBotParamsView(cfg, rt);
    }
    const bpf = byId("bot-params-form");
    if (bpf) bpf.innerHTML = buildConfigForm(cfg);
  }

  const cyclesBody = byId("cycles-body");
  if (cyclesBody) {
    cyclesBody.innerHTML =
      cRecent?.items?.length > 0
        ? cRecent.items
            .map(
              (c) => `<tr>
          <td data-label="Status"><span class="status-badge ${cycleStatusClass(c.status)}">${escapeHtml(trCycleStatus(c.status))}</span></td>
          <td data-label="Mercado">${escapeHtml(c.market)}</td>
          <td data-label="Entrada">${fmtNum(c.entryPrice)}</td>
          <td data-label="Alvo">${fmtNum(c.targetPrice)}</td>
          <td data-label="Quote">${fmtNum(c.quoteSpent)} / ${fmtNum(c.quoteBudget)}</td>
          <td data-label="Base">${fmtNum(c.baseFilled)}</td>
          <td data-label="Aberto">${formatDate(c.openedAt)}</td>
        </tr>`,
            )
            .join("")
        : `<tr><td colspan="7" class="muted empty-state">Nenhum ciclo ainda.</td></tr>`;
  }

  const ordersBody = byId("orders-body");
  if (ordersBody) {
    ordersBody.innerHTML =
      oRecent?.items?.length > 0
        ? oRecent.items
            .map(
              (o) => `<tr>
          <td data-label="Lado">${escapeHtml(trOrderSide(o.side))}</td>
          <td data-label="Status"><span class="status-badge ${cycleStatusClass(o.status)}">${escapeHtml(trOrderStatus(o.status))}</span></td>
          <td data-label="Preço">${fmtNum(o.price)}</td>
          <td data-label="Qtd">${fmtNum(o.amount)}</td>
          <td data-label="Preenchido">${fmtNum(o.filledAmount)}</td>
          <td data-label="Client ID" title="${escapeHtml(o.clientId)}">${escapeHtml(shortId(o.clientId))}</td>
        </tr>`,
            )
            .join("")
        : `<tr><td colspan="6" class="muted empty-state">Nenhuma ordem ainda.</td></tr>`;
  }

  lastEventItems = eRecent?.items ?? [];
  const filt = byId("events-filter")?.value || "all";
  renderEventsList(filt);
}

function initEventFilter() {
  const sel = byId("events-filter");
  if (!sel) return;
  sel.addEventListener("change", () => renderEventsList(sel.value));
}

qs(".panel-controls", document)?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  try {
    if (action === "start-dry") await apiPost("/bot/start", { mode: "DRY_RUN" });
    if (action === "mode-live") {
      if (
        !window.confirm(
          "Ativar modo LIVE na base de dados? Exige ENABLE_LIVE_TRADING=true no .env e confirmação na API.",
        )
      ) {
        return;
      }
      await apiPost("/bot/mode/live", { confirm: "ENABLE_LIVE_TRADING" });
    }
    if (action === "pause-buys") await apiPost("/bot/pause-buys");
    if (action === "sell-only") await apiPost("/bot/sell-only");
    if (action === "stop") await apiPost("/bot/stop");
    if (action === "kill") await apiPost("/bot/kill-switch");
    toast("Comando aplicado.", "ok");
    await loadAll();
  } catch (err) {
    toast(String(err.message), "err");
  }
});

byId("btn-edit-config")?.addEventListener("click", async () => {
  const res = await apiGet("/bot/config");
  if (!res.ok) {
    toast(res.error || "bot/config", "err");
    return;
  }
  byId("bot-params-form").innerHTML = buildConfigForm(res.data.config);
  setConfigEditing(true);
});

byId("btn-cancel-config")?.addEventListener("click", () => {
  setConfigEditing(false);
  void loadAll();
});

byId("btn-save-config")?.addEventListener("click", async () => {
  try {
    const body = normalizeConfigPatchBody(readConfigForm());
    if (Object.keys(body).length === 0) {
      toast("Nada para salvar.", "err");
      return;
    }
    await apiPatch("/bot/config", body);
    toast("Configuração gravada no Postgres.", "ok");
    setConfigEditing(false);
    await loadAll();
  } catch (err) {
    toast(String(err.message), "err");
  }
});

byId("btn-refresh")?.addEventListener("click", () => loadAll());

byId("btn-reset-live-circuit")?.addEventListener("click", async () => {
  try {
    await apiPost("/live-cycle/reset-circuit-breaker", {});
    toast("Circuit breaker reposto (memória).", "ok");
    await loadAll();
  } catch (err) {
    toast(String(err.message), "err");
  }
});

initTabs();
initEventFilter();
void loadAll();
setInterval(loadAll, 5000);
