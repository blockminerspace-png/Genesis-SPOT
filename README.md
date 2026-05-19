# Genesis SPOT — REAL ONLY

Monólito modular em **Node.js + TypeScript + Fastify + Prisma + PostgreSQL** para um bot **spot** com **ciclos isolados** (desenho técnico; não é recomendação financeira).

**Genesis SPOT é REAL ONLY:** sem DRY_RUN, sem SIMULATED, sem saldo fake, sem ticker fake. Ticker, market spec e saldo vêm **só da CoinEx**; ordens são **LIVE** na CoinEx quando as travas estão OK. O motor (`runtime_status`) é apenas **ON/OFF operacional** — `OFF` não é “observação”, é motor parado.

## Requisitos

- Node.js 20+
- Docker (Postgres local via `docker compose`)

## Configuração

```bash
cd "Genesis SPOT"
cp .env.example .env
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate   # ou: npx prisma migrate deploy
npm run dev
```

Por omissão: **`HOST=127.0.0.1`**, **`PORT=3000`**.

## Runtime (Fase 1.2)

O Postgres define o operacional com **dois campos** em `bot_configs`:

| Campo | Valores | Função |
|--------|---------|--------|
| `runtime_status` | `OFF`, `RUNNING`, `PAUSED_BUYS`, `SELL_ONLY`, `KILL_SWITCH` | O que o bot pode fazer (abrir ciclos, só vendas, etc.) |
| `execution_mode` | `LIVE` | Conta real CoinEx (único valor) |

O **`.env`** define **capacidades** (ex.: `ENABLE_LIVE_TRADING`, chaves CoinEx). Se o motor está `RUNNING` mas faltam chaves, a camada efetiva fica **`DISABLED`** (sem ordens reais) e o painel pode registar `LIVE_BLOCKED_MISSING_KEYS`.

**`RuntimeStateService`** (`src/modules/runtime/runtime-state.service.ts`) expõe `getPermissions()` e helpers (`canOpenBuyCycle`, `mustUseLiveExecution`, etc.).

O **modo de execução** fica na **base de dados** (`execution_mode` em `bot_configs`), não numa variável `BOT_EXECUTION_MODE` no `.env`.

## Market data (Fase 1.3)

Variáveis no `.env`:

| Variável | Valores | Efeito |
|----------|---------|--------|
| `MARKET_DATA_SOURCE` | `COINEX` | Ticker público CoinEx (`GET /v2/spot/ticker`) |
| `MARKET_DATA_CACHE_TTL_MS` | ms (ex.: `2000`) | Cache do último preço entre pedidos |
| `MARKET_SPEC_CACHE_TTL_MS` | ms (ex.: `120000`) | Cache do **market spec** (precisão, mínimos, fees) |

- Se o pedido CoinEx falhar, o ticker devolve erro (sem fallback simulado).
- Eventos (com throttle): `MARKET_DATA_UPDATED`, `MARKET_DATA_ERROR`.

Módulo: `src/modules/market-data/` (`MarketDataService`, `CoinexMarketDataProvider`).

## Market spec (Fase 1.4)

`MarketSpecService` (`market-spec.service.ts`) normaliza `GET /v2/spot/market` para **`MarketSpec`** (precisões, `min_amount`, `min_value` se existir, fees, `tradingEnabled`, `apiTradingEnabled`). Utilitários **`floorBaseAmount`**, **`floorQuoteValue`**, **`floorPrice`**, **`assertValidOrderAmount`** em `market-spec.rounding.ts` — **sempre floor**, nunca arredondar para cima em quantidade.

| Origem `source` | Quando |
|-----------------|--------|
| `COINEX` | Pedido HTTP OK à API CoinEx |
| `STATIC_FALLBACK` | CoinEx indisponível (cache curto) |

Integração: **`grid.strategy`**, **`RiskManager.validateOrderAgainstMarketSpec`**, **`CoinexOrderExecutor`**.

Eventos (throttle onde aplicável): `MARKET_SPEC_UPDATED`, `MARKET_SPEC_ERROR`, `MARKET_API_TRADING_DISABLED`, `ORDER_AMOUNT_FLOORED`, `ORDER_REJECTED_MIN_AMOUNT`, `ORDER_REJECTED_MIN_VALUE`.

## Portfolio read-only (Fase 1.5)

| Variável | Valores | Efeito |
|----------|---------|--------|
| `PORTFOLIO_BALANCE_SOURCE` | `COINEX` | `GET /portfolio/balance` expõe snapshot CoinEx (assinado) |
| `PORTFOLIO_BALANCE_CACHE_TTL_MS` | ms (ex.: `5000`) | Cache em memória do snapshot entre pedidos à API |

- **Sem chaves** ou erro HTTP: `coinex` com `available: false` e mensagem; o painel não quebra.
- Eventos (throttle): `BALANCE_UPDATED`, `BALANCE_ERROR`, `BALANCE_SOURCE_UNAVAILABLE`, `COINEX_BALANCE_AUTH_FAILED`.

Módulo: `src/modules/portfolio/` + assinatura v2 em `src/infrastructure/coinex/coinex-v2-sign.ts` (`GET /v2/assets/spot/balance`).

## LIVE / ordens reais (Fase 1.6)

Dupla autorização:

| Camada | Significado |
|--------|-------------|
| `execution_mode = LIVE` (Postgres) | O operador quer rota LIVE. |
| `ENABLE_LIVE_TRADING=true` (`.env`) | Esta instalação autoriza envio real. |

Variáveis principais: `ENABLE_LIVE_TRADING`, `LIVE_MARKET_ALLOWLIST` (CSV), `LIVE_MAX_ORDER_QUOTE_VALUE`, `LIVE_MAX_DAILY_QUOTE_VOLUME`, `LIVE_REQUIRE_MAKER_ONLY`, `LIVE_BALANCE_MAX_AGE_MS`, `LIVE_MARKET_DATA_MAX_AGE_MS`, `LIVE_MARKET_SPEC_MAX_AGE_MS`, `LIVE_TEST_MAX_QUOTE_VALUE`, `LIVE_PRACTICE_QUOTE_VALUE`, `LIVE_PRACTICE_MARKET`, `LIVE_PRACTICE_CONFIRM_PHRASE`, `AUTO_LIVE_ORDER_QUOTE_VALUE`, `AUTO_LIVE_TARGET_PROFIT_PCT`, `AUTO_LIVE_CONFIRM_ENV`, `AUTO_LIVE_MARKET`.

**`LiveSafetyGuard`** (`runLivePlacePrecheck` em `src/modules/orders/live-safety/live-safety.guard.ts`): chaves, `RUNNING`, allowlist, `MARKET_DATA_SOURCE=COINEX`, ticker/spec **CoinEx** frescos (idade máx. por env), saldo spot fresco (snapshot dedicado), mínimos/precisão, teto por ordem, volume diário em memória, `api_trading_enabled`, hint maker (`LIVE_REQUIRE_MAKER_ONLY`).

**`CoinexOrderExecutor`**: `POST /v2/spot/order` (JSON assinado), grava `exchange_order_id` + `raw_response`, cancel `POST /v2/spot/cancel-order`, eventos `LIVE_ORDER_*`.

- **`POST /bot/mode/live`** — corpo `{ "confirm": "ENABLE_LIVE_TRADING" }` + `ENABLE_LIVE_TRADING=true` + chaves.
- **`POST /bot/start`** — corpo `{ "confirm": "ENABLE_LIVE_TRADING" }` + `ENABLE_LIVE_TRADING=true` + chaves.
- **`POST /orders/preview`** — validação sem enviar ordem.
- **`POST /orders/live-test`** — ordem real manual com teto `min(LIVE_MAX_ORDER_QUOTE_VALUE, LIVE_TEST_MAX_QUOTE_VALUE)` e `"confirm":"LIVE_TEST_ORDER"`.

O painel **não** expõe fluxos de simulação nem “modo observação”. Para testar sem o worker automático: `ENABLE_AUTO_LIVE_WORKER=false` e motor `OFF` ou `PAUSED_BUYS`; para operar: `RUNNING` + travas OK + `ENABLE_AUTO_LIVE_WORKER=true`.

## Reconciliação LIVE (Fase 1.6.6)

CoinEx como **fonte de verdade** para ordens com `exchange_order_id` numérico (exclui `sim-*`):

- Worker `startLiveOrderReconciliationWorker` (`src/modules/reconciliation/live-order-reconciliation.worker.ts`), intervalo **`BOT_RECONCILIATION_INTERVAL_MS`**.
- Ordens locais `OPEN` / `PARTIALLY_FILLED` → `GET /v2/spot/order-status` → atualiza `status`, `filled_amount`, `filled_value`, `fee`, `raw_response.lastCoinexReconciliation`.
- Com volume preenchido → `GET /v2/spot/user-deals` (paginação) → `order_fills` com **`exchange_deal_id` único** (migração `order_fills_exchange_deal_id_key`) — reexecução não duplica fills (`P2002` ignorado).
- Ciclo ligado (`cycle_id`): atualização conservadora (`BUY_*`, `SELL_*`, `CLOSED_PROFIT`, `CANCELLED`, `MANUAL_REVIEW` + evento `CYCLE_RECONCILIATION_REQUIRED`).
- Eventos: `LIVE_ORDER_SYNC_STARTED`, `LIVE_ORDER_SYNCED`, `LIVE_ORDER_STATUS_CHANGED`, `LIVE_ORDER_FILL_IMPORTED`, `LIVE_ORDER_PARTIALLY_FILLED`, `LIVE_ORDER_FILLED`, `LIVE_ORDER_CANCELLED_EXTERNALLY`, `LIVE_ORDER_SYNC_ERROR`, `BALANCE_DRIFT_DETECTED` (heurística USDT entre ticks), `CYCLE_RECONCILIATION_REQUIRED`.
- **`GET /reconciliation/live-summary`** — último tick (duração, contagens, drift Σ fills vs `filled_value`, último erro, `lastHealthyTickCompletedAtMs` para travas Auto LIVE).

## FULL Auto LIVE Worker (Fase 1.7)

**Isto opera dinheiro real na CoinEx** (ordens **LIMIT** automáticas de compra e venda, sem `MARKET`). O worker corre em `startLiveCycleWorker` (`src/server.ts` → `src/modules/workers/live-cycle.worker.ts`). Por omissão **`ENABLE_AUTO_LIVE_WORKER=false`**: o intervalo corre, mas o estado fica `DISABLED` e **não** envia ordens.

### Chaves e conta

- Crie uma API key **sem permissão de saque (withdraw)** e, se possível, **whitelist de IP**.
- **Nunca** commite `COINEX_ACCESS_ID` / `COINEX_SECRET_KEY`; use só `.env`. Se uma chave vazar, **revogue** na CoinEx.

### Variáveis `.env` (principais)

| Variável | Notas |
|----------|--------|
| `ENABLE_AUTO_LIVE_WORKER` | `true` para permitir ticks operacionais |
| `ENABLE_LIVE_TRADING` | `true` |
| `AUTO_LIVE_CONFIRM_ENV` | Deve ser **exatamente** `I_UNDERSTAND_THIS_BOT_CAN_TRADE_REAL_MONEY` (vazio = worker bloqueado) |
| `AUTO_LIVE_ORDER_QUOTE_VALUE` | Teto em quote por compra; `min(…, LIVE_MAX_ORDER_QUOTE_VALUE)` |
| `AUTO_LIVE_TARGET_PROFIT_PCT` | Legado no schema; **a venda Auto LIVE usa `target_profit_pct` em `bot_configs` (Parâmetros)** + `fee_buffer_pct` |
| `AUTO_LIVE_MARKET` | Opcional; vazio = `market` em `bot_configs` (deve estar em `LIVE_MARKET_ALLOWLIST`) |
| `MARKET_DATA_SOURCE` | `COINEX` |
| `PORTFOLIO_BALANCE_SOURCE` | **`COINEX` ou `BOTH`** (obrigatório para o Auto LIVE) |
| `AUTO_LIVE_WORKER_INTERVAL_MS`, `AUTO_LIVE_MIN_RECONCILIATION_SUCCESS_AGE_MS`, `AUTO_LIVE_MAX_OPEN_CYCLES`, `AUTO_LIVE_COOLDOWN_MS`, … | Ver `.env.example` |

Com **`BTC_STRATEGY_ENABLED=true`**, o Auto LIVE usa a **estratégia BTC Drop 2K** (ver secção abaixo) em vez da grelha percentual + compra a mercado. Os campos `grid_step_pct` / `order_quote_size` no Postgres ficam **legado/inativos** para compras automáticas.

No **Postgres** (`bot_configs`, painel Parâmetros): sem BTC Drop, `grid_step_pct` alimenta o resumo visual; `target_profit_pct` + `fee_buffer_pct` definem o alvo de venda. Com BTC Drop, o lucro-alvo de venda vem de **`BTC_TARGET_PROFIT_PCT`** no `.env`.

**`AUTO_LIVE_ORDER_QUOTE_VALUE=1`** e **`LIVE_MAX_ORDER_QUOTE_VALUE=1`** bloqueiam a BTC Drop 2K: **0,0001 BTC** a ~100 000 USDT ≈ **10 USDT** por ordem. Use algo como `LIVE_MAX_ORDER_QUOTE_VALUE=15` e `AUTO_LIVE_ORDER_QUOTE_VALUE=15` (e `LIVE_MAX_DAILY_QUOTE_VOLUME` proporcional).

## Estratégia BTC Drop 2K

Mercado único (**`BTCUSDT`** por omissão). Cada vez que o preço atinge o **próximo nível** (anchor − N×2000 USDT), o bot abre um **ciclo isolado** com **compra LIMIT** de **0,0001 BTC** e, após fill real (reconciliador), **venda LIMIT** em **+2%** sobre o preço médio de entrada (+ `fee_buffer_pct`).

| Variável | Função |
|----------|--------|
| `BTC_STRATEGY_ENABLED` | `true` ativa a estratégia |
| `BTC_STRATEGY_MARKET` | Par (ex. `BTCUSDT`) — deve estar em `LIVE_MARKET_ALLOWLIST` |
| `BTC_DROP_BUY_STEP_USDT` | Queda entre níveis (ex. `2000`) |
| `BTC_ORDER_BASE_AMOUNT` | Lote fixo em BTC (ex. `0.0001`) |
| `BTC_TARGET_PROFIT_PCT` | Lucro-alvo na venda (ex. `0.02` = 2%) |
| `BTC_STRATEGY_ANCHOR_MODE` | `LAST_HIGH` — sobe o anchor quando não há ciclos abertos |

**Exemplo** (BTC ≈ 100 000 USDT): 1.º nível de compra ≈ 98 000 → compra 0,0001 BTC → venda alvo ≈ 99 960 (+2% sobre 98 000). Próximo nível ≈ 96 000, etc. Cada compra é um ciclo **separado** (saldo não se mistura).

- Estado persistido: tabela `btc_drop_strategy_state` (anchor, próximo nível, passo, lote).
- **Primeiro tick** após arranque: só inicializa níveis (sem comprar).
- API: **`GET /strategy/btc-drop/state`**, **`POST /strategy/btc-drop/reset`** (corpo `{ "confirm": "RESET_BTC_DROP_WITH_OPEN_CYCLES" }` se houver ciclos abertos).
- Painel: card **«Estratégia BTC Drop 2K»** (Ciclos / Automático) + reset de níveis.

**Antes de LIVE:** motor `OFF` ou `ENABLE_AUTO_LIVE_WORKER=false`, validar spec/mínimos CoinEx para 0,0001 BTC, ajustar tetos `.env`, observar eventos `BTC_DROP_*` e `/live-cycle/summary`.

Antes do Auto LIVE em produção, valida o checklist em **`GET /bot/operational-status`** e no painel (Visão geral).

### Travas (resumo)

| Área | Conteúdo |
|------|-----------|
| `.env` | `ENABLE_AUTO_LIVE_WORKER`, `ENABLE_LIVE_TRADING`, `AUTO_LIVE_CONFIRM_ENV`, chaves CoinEx, `PORTFOLIO_BALANCE_SOURCE` ∈ {`COINEX`,`BOTH`} |
| Postgres | `runtime_status=RUNNING` (e **não** `KILL_SWITCH`), `execution_mode=LIVE`, `executionLayer=LIVE` |
| Mercado | `MARKET_DATA_SOURCE=COINEX`, ticker/spec **COINEX** frescos (nada de `STATIC_FALLBACK`), `api_trading_enabled` / `trading_enabled`, `LiveSafetyGuard`, `LIVE_MARKET_ALLOWLIST` |
| Reconciliador | `reconciliation_healthy` (tick saudável recente, sem `lastError`, sem fill drift), ordens LIVE não “stale”, sem `BALANCE_DRIFT_DETECTED` recente |
| Ciclo | Sem `MANUAL_REVIEW` aberto; sem duplicar BUY/SELL (`client_id` determinístico `LIVE_AUTO_BUY_<cycle_id>`, `LIVE_AUTO_SELL_<cycle_id>`); `Prisma` transação ao criar ciclo antes do BUY |
| Risco | `AUTO_LIVE_MAX_OPEN_CYCLES`, cooldown após terminal, `AUTO_LIVE_ALLOW_NEW_BUY_WITH_OPEN_SELL`, `LIVE_MAX_*`, saldo USDT mínimo (`min_quote_balance` no Postgres) |

### Arranque sugerido (BTC Drop 2K)

```env
ENABLE_LIVE_TRADING=true
ENABLE_AUTO_LIVE_WORKER=true
AUTO_LIVE_CONFIRM_ENV=I_UNDERSTAND_THIS_BOT_CAN_TRADE_REAL_MONEY
BTC_STRATEGY_ENABLED=true
BTC_STRATEGY_MARKET=BTCUSDT
BTC_DROP_BUY_STEP_USDT=2000
BTC_ORDER_BASE_AMOUNT=0.0001
BTC_TARGET_PROFIT_PCT=0.02
LIVE_MARKET_ALLOWLIST=BTCUSDT
LIVE_MAX_ORDER_QUOTE_VALUE=15
AUTO_LIVE_ORDER_QUOTE_VALUE=15
LIVE_MAX_DAILY_QUOTE_VOLUME=45
MARKET_DATA_SOURCE=COINEX
PORTFOLIO_BALANCE_SOURCE=COINEX
```

```sql
UPDATE bot_configs
SET runtime_status='RUNNING',
    execution_mode='LIVE',
    enabled=true,
    updated_at=now();
```

### API e ficheiros

- **`GET /live-cycle/summary`** — estado do worker + `liveTradingEnabled`, `runtimeStatus`, `executionMode`, `market`, `quoteValue`, `targetProfitPct`, `checks` (incl. `reconciliation_healthy`).
- **`POST /live-cycle/reset-circuit-breaker`** — repõe circuit breaker em memória + `LIVE_CYCLE_CIRCUIT_RESET`.
- Módulo: `src/modules/live-cycle/` (`live-cycle.service.ts`, `live-cycle-state.ts`, `live-cycle.types.ts`, `live-cycle.constants.ts`), worker `src/modules/workers/live-cycle.worker.ts`.

### Circuit breaker

Erros **inesperados** no tick incrementam `consecutiveErrors`; ao atingir `AUTO_LIVE_MAX_CONSECUTIVE_ERRORS`, abre-se circuito por `AUTO_LIVE_CIRCUIT_BREAKER_COOLDOWN_MS` (`LIVE_CYCLE_CIRCUIT_OPENED`). Bloqueios esperados (precheck, reconciliação, etc.) **não** incrementam o contador.

### Eventos

`LIVE_CYCLE_WORKER_DISABLED`, `LIVE_CYCLE_WORKER_BLOCKED`, `LIVE_CYCLE_TICK_STARTED`, `LIVE_CYCLE_TICK_FINISHED`, `LIVE_CYCLE_PRECHECK_FAILED`, `LIVE_CYCLE_RECONCILIATION_STALE`, `LIVE_CYCLE_SIGNAL_CREATED`, `LIVE_CYCLE_SIGNAL_REJECTED`, `LIVE_CYCLE_CREATED`, `LIVE_CYCLE_BUY_PLACING`, `LIVE_CYCLE_BUY_PLACED`, `LIVE_CYCLE_BUY_FILLED_DETECTED`, `LIVE_CYCLE_SELL_PLACING`, `LIVE_CYCLE_SELL_PLACED`, `LIVE_CYCLE_SELL_FILLED_DETECTED`, `LIVE_CYCLE_CLOSED_PROFIT`, `LIVE_CYCLE_MANUAL_REVIEW`, `LIVE_CYCLE_ERROR`, `LIVE_CYCLE_CIRCUIT_OPENED`, `LIVE_CYCLE_CIRCUIT_RESET`.

**Checklist produção:** todas as travas acima, limites `.env` revistos, conta de testes, monitorizar `/live-cycle/summary` e eventos; **não** ativar Auto LIVE sem reconciliador estável.

## Interface

**http://localhost:3000** — painel **REAL ONLY**: badges Real CoinEx Mode, saldo CoinEx, BTC Drop 2K, checklist operacional, Full Auto LIVE central, reconciliador, eventos `LIVE_*` / `BTC_DROP_*`.

## API (resumo)

### Bot

| Método | Rota | Efeito |
|--------|------|--------|
| GET | `/bot/config` | Config + camada efetiva (`executionLayer`) |
| PATCH | `/bot/config` | Parâmetros |
| POST | `/bot/start` | `{ "confirm": "ENABLE_LIVE_TRADING" }` — exige `ENABLE_LIVE_TRADING` no `.env` + chaves |
| POST | `/bot/stop` | `OFF` |
| POST | `/bot/kill-switch` | `KILL_SWITCH` |
| POST | `/bot/mode/live` | `{ "confirm": "ENABLE_LIVE_TRADING" }` + `ENABLE_LIVE_TRADING` + chaves |
| POST | `/bot/pause-buys` | `PAUSED_BUYS` |
| POST | `/bot/sell-only` | `SELL_ONLY` |

### Outros

- `GET /bot/operational-status` — checklist REAL ONLY (env + Postgres + worker).
- `GET /live-cycle/summary` — FULL Auto LIVE: `status`, `checks` (incl. `reconciliation_healthy`), `liveTradingEnabled`, `runtimeStatus`, `executionMode`, `market`, `quoteValue`, `targetProfitPct`, últimos ticks/erros/circuito.
- `POST /live-cycle/reset-circuit-breaker` — repõe circuit breaker em memória (não altera Postgres).
- `GET /reconciliation/live-summary` — estado do último tick do worker de reconciliação LIVE.
- `POST /orders/preview` — pré-validação LIVE (sem ordem): `checks`, `flooredAmount`, `quoteValue`, etc.
- `POST /orders/live-test` — ordem **limit** real manual (teto quote + `confirm: "LIVE_TEST_ORDER"`).
- `GET /portfolio/balance` — JSON com `executionMode`, `portfolioBalanceSource` e `coinex`: saldos `available` / `frozen` / `total` por ativo (com chaves).
- `GET /market/ticker/:market` — último preço CoinEx + cache; inclui `priceSource`, `updatedAt`.
- `GET /market/info/:market` — **`MarketSpec`** normalizado (sem campo `raw`): `basePrecision`, `quotePrecision`, `minAmount`, `minValue`, fees, flags; `source` = `COINEX` ou `STATIC_FALLBACK`.

## Ordens (Fase 1.2 + 1.6)

- **`OrderManager`** delega a **`CoinexOrderExecutor`** quando a camada efetiva é LIVE.
- **CoinEx LIVE**: `CoinexOrderExecutor` com **`runLivePlacePrecheck`** antes de cada envio; cancelamento via **`POST /spot/cancel-order`** (atualiza ordem local para `CANCELLED` em sucesso).

## Workers

- **Reconciliação LIVE** — intervalo **`BOT_RECONCILIATION_INTERVAL_MS`**: só processa ordens com `exchange_order_id` numérico e estado `OPEN` / `PARTIALLY_FILLED`; requer chaves CoinEx; não envia novas ordens.
- **FULL Auto LIVE Worker** — intervalo **`AUTO_LIVE_WORKER_INTERVAL_MS`**: só com `ENABLE_AUTO_LIVE_WORKER=true`, `AUTO_LIVE_CONFIRM_ENV`, e todas as travas; ciclos `is_live_auto_worker`.

## Scripts

- `npm run dev`, `npm run typecheck`, `npm run build`, `npm start` (na raiz do projeto).

## Postgres

`docker-compose.yml`: host **`5433`** → container `5432`.

## Segurança

- Painel sem auth no MVP — não expor na internet.
- Nunca commitar `.env`.
