/** Rótulos em português para tipos de evento (código interno → UI). */
const EVENT_TYPE_PT: Record<string, string> = {
  BALANCE_DRIFT_DETECTED: "Saldo alterou com ordens abertas",
  BALANCE_ERROR: "Erro ao ler saldo",
  BALANCE_SOURCE_UNAVAILABLE: "Fonte de saldo indisponível",
  BALANCE_UPDATED: "Saldo CoinEx atualizado",
  BUY_SIGNAL_REJECTED: "Sinal de compra rejeitado",
  CONFIG_UPDATED: "Configuração alterada",
  TRADING_DATA_RESET: "Histórico de trading apagado",
  BTC_DROP_INITIAL_MARKET_BUY: "Compra inicial a mercado (BTC Drop)",
  LIVE_CYCLE_BOOTSTRAP_MARKET_BUY: "Compra inicial a mercado (bootstrap)",
  BOT_RUNTIME_CHANGED: "Estado do motor ou modo alterado",
  COINEX_BALANCE_AUTH_FAILED: "Falha de autenticação na CoinEx",
  CYCLE_CLOSED_PROFIT: "Ciclo fechado com lucro",
  CYCLE_CREATED: "Ciclo criado",
  CYCLE_RECONCILIATION_REQUIRED: "Ciclo precisa de conciliação",
  LIVE_BLOCKED_ENV: "Conta real bloqueada pelo ambiente",
  LIVE_BLOCKED_MISSING_KEYS: "Conta real bloqueada — faltam chaves CoinEx",
  LIVE_CYCLE_BUY_BUMPED_TO_MIN_LOT: "Compra no mínimo CoinEx (min_amount / min_value)",
  LIVE_CYCLE_BUY_FILLED_DETECTED: "Compra executada — preparar venda",
  LIVE_CYCLE_BUY_PLACED: "Compra a mercado registada na CoinEx",
  LIVE_CYCLE_BUY_PLACING: "A colocar compra a mercado",
  LIVE_CYCLE_BUY_SIGNAL: "Sinal de compra",
  LIVE_CYCLE_CIRCUIT_OPENED: "Proteção por erros ativada",
  LIVE_CYCLE_CIRCUIT_RESET: "Proteção reposta",
  LIVE_CYCLE_CLOSED_PROFIT: "Ciclo fechado com lucro",
  LIVE_CYCLE_CREATED: "Ciclo automático criado",
  LIVE_CYCLE_ERROR: "Erro no ciclo automático",
  LIVE_CYCLE_MANUAL_REVIEW: "Ciclo precisa de revisão manual",
  LIVE_CYCLE_PRECHECK_FAILED: "Verificação prévia falhou",
  LIVE_CYCLE_RECONCILIATION_STALE: "Conciliação desatualizada",
  LIVE_CYCLE_SELL_FILLED_DETECTED: "Venda executada — ciclo fechado",
  LIVE_CYCLE_SELL_PLACED: "Venda limite registrada na CoinEx",
  LIVE_CYCLE_SELL_PLACING: "A colocar venda limite",
  LIVE_CYCLE_SIGNAL_CREATED: "Sinal de compra automático aceite",
  LIVE_CYCLE_SIGNAL_REJECTED: "Sinal rejeitado pelo motor",
  LIVE_CYCLE_TICK_FINISHED: "Fim da corrida do automático",
  LIVE_CYCLE_TICK_STARTED: "Início da corrida do automático",
  LIVE_CYCLE_WORKER_BLOCKED: "Automático bloqueado",
  LIVE_CYCLE_WORKER_DISABLED: "Automático desligado no servidor",
  LIVE_ORDER_CANCELLED: "Ordem cancelada na CoinEx",
  LIVE_ORDER_CANCELLED_EXTERNALLY: "Ordem ausente na CoinEx",
  LIVE_ORDER_CANCEL_REQUESTED: "Pedido de cancelamento enviado",
  LIVE_ORDER_ERROR: "Erro na ordem",
  LIVE_ORDER_FILL_IMPORTED: "Negócios importados da CoinEx",
  LIVE_ORDER_FILLED: "Ordem executada por completo",
  LIVE_ORDER_PARTIALLY_FILLED: "Ordem parcialmente executada",
  LIVE_ORDER_PLACED: "Ordem registrada na CoinEx",
  LIVE_ORDER_PLACING: "A enviar ordem",
  LIVE_ORDER_PRECHECK_FAILED: "Verificação da ordem falhou",
  LIVE_ORDER_REJECTED: "Ordem rejeitada pela CoinEx",
  LIVE_ORDER_STATUS_CHANGED: "Estado da ordem alterado",
  LIVE_ORDER_SYNCED: "Ordem alinhada com a CoinEx",
  LIVE_ORDER_SYNC_ERROR: "Erro ao alinhar ordem",
  LIVE_ORDER_SYNC_STARTED: "Início da sincronização da ordem",
  MARKET_DATA_ERROR: "Erro na cotação",
  MARKET_DATA_UPDATED: "Cotação atualizada",
  MARKET_SPEC_ERROR: "Erro nas regras do par",
  MARKET_SPEC_UPDATED: "Regras do par atualizadas",
  ORDER_AMOUNT_FLOORED: "Quantidade ou preço ajustados",
  STARTUP_PENDING_ORDERS_IMPORTED: "Ordens pendentes CoinEx sincronizadas com a base ao arranque",
  STARTUP_BUY_MONITORING: "Compras abertas ao arranque",
  STARTUP_LIVE_REVIEW_SKIPPED: "Revisão ao arranque ignorada",
  STARTUP_SELL_MONITORING: "Venda aberta ao arranque",
  STARTUP_SELL_REPLACED: "Venda substituída ao arranque",
  STARTUP_SELL_REPRICE: "Venda reprecificada ao arranque",
  STARTUP_SELL_REPRICE_FAILED: "Falha ao reprecificar venda",
  STARTUP_SELL_REPRICE_INVALID: "Reprecificação inválida",
  STARTUP_SELL_REPRICE_PRECHECK: "Verificação de reprecificação",
  STARTUP_SELL_REPRICE_SKIPPED: "Reprecificação ignorada",
};

function humanizeUnknownType(type: string): string {
  return `Evento interno (${type})`;
}

export function trEventType(type: unknown): string {
  const key = String(type ?? "").trim();
  if (!key) return "—";
  return EVENT_TYPE_PT[key] ?? humanizeUnknownType(key);
}

export function trEventLevel(level: unknown): string {
  const u = String(level ?? "").toUpperCase();
  if (u === "ERROR") return "Erro";
  if (u === "WARN" || u === "WARNING") return "Aviso";
  if (u === "INFO") return "Informação";
  if (u === "DEBUG") return "Detalhe";
  return u || "—";
}

/** Normaliza mensagens vindas do servidor (mistura PT/EN). */
export function trEventMessage(message: unknown): string {
  let s = String(message ?? "").trim();
  if (!s) return "";

  const exact: Record<string, string> = {
    "tick auto LIVE": "Início da corrida do modo automático (conta real).",
    "fim do tick": "Fim da corrida do motor automático.",
    "travas runtime/env": "Bloqueado por estado do motor ou ambiente.",
    reconciliador: "Bloqueado — conciliação.",
    "reconciliador LIVE não saudável": "Conciliação com a CoinEx indisponível ou instável.",
    "ordens LIVE abertas sem sync recente": "Ordens na conta real sem sincronização recente.",
    "drift de saldo recente": "Saldo alterou de forma inesperada.",
    manual_review_required: "Revisão manual necessária.",
    "spec/ticker/saldo": "Problema em regras do par, cotação ou saldo.",
    "mercado/saldo/spec": "Problema em mercado, saldo ou regras do par.",
    "runtime não permite venda": "O motor não permite venda agora.",
    "runtime não permite compra": "O motor não permite compra agora.",
    "precheck BUY falhou": "Verificação pré-compra falhou.",
    "race ou ciclo bloqueado ao criar BUY": "Concorrência ou ciclo impediu a compra.",
    "Quantidade e/ou preço ajustados (floor)": "Quantidade ou preço ajustados (arredondamento).",
    "resposta sem order_id": "Resposta da corretora sem identificador de ordem.",
    "Saldo spot CoinEx lido (read-only)": "Saldo spot na CoinEx lido (só consulta).",
  };
  if (exact[s]) return exact[s];

  // Padrões frequentes
  s = s.replace(/^Ticker CoinEx OK \(([^)]+)\)$/i, "Cotação CoinEx recebida com sucesso ($1).");

  const rtMsg = s.match(/^runtime_status=(\S+)\s+execution_mode=(\S+)$/);
  if (rtMsg) {
    const rs: Record<string, string> = {
      OFF: "Desligado",
      RUNNING: "Em execução",
      PAUSED_BUYS: "Compras pausadas",
      SELL_ONLY: "Só vendas",
      KILL_SWITCH: "Paragem de emergência",
    };
    const em: Record<string, string> = { LIVE: "Conta real" };
    const a = rs[rtMsg[1]] ?? rtMsg[1];
    const b = em[rtMsg[2]] ?? rtMsg[2];
    return `Estado do motor: ${a} · Modo: ${b}`;
  }

  s = s.replace(/\bTicker\b/gi, "Cotação");
  s = s.replace(/\bOK\b/g, "bem-sucedida");
  s = s.replace(/\bfilled\b/gi, "executada");
  s = s.replace(/\bfill\(s\)\b/gi, "negócio(s)");
  s = s.replace(/\bfills\b/gi, "negócios");
  s = s.replace(/\bcancelled\b/gi, "cancelada");
  s = s.replace(/\bcancel\b/gi, "cancelar");
  s = s.replace(/\bsync\b/gi, "sincronização");
  s = s.replace(/\bBUY\b/g, "Compra");
  s = s.replace(/\bSELL\b/g, "Venda");
  s = s.replace(/\bLIVE\b/g, "conta real");
  s = s.replace(/\bWorker\b/gi, "processo");
  s = s.replace(/\bAuto LIVE\b/gi, "modo automático");
  s = s.replace(/\bCircuit breaker\b/gi, "Proteção do circuito");
  s = s.replace(/\bMarket spec\b/gi, "Regras do par");
  s = s.replace(/\bticker\b/gi, "cotação");
  s = s.replace(/\bwait\b/gi, "aguardar");
  s = s.replace(/\bprecheck\b/gi, "verificação prévia");
  s = s.replace(/\breconciliad[oa]\b/gi, "alinhada");
  s = s.replace(/\bOFF\b/g, "desligado");
  s = s.replace(/\bRUNNING\b/g, "em execução");
  s = s.replace(/\bDISABLED\b/g, "desativado");

  return s;
}
