# Genesis SPOT (até Fase 1.7)

Monólito modular em **Node.js + TypeScript + Fastify + Prisma + PostgreSQL** para um bot **spot** com **ciclos isolados** (desenho técnico; não é recomendação financeira). **Sem simulador:** ticker, spec e saldo vêm da CoinEx; `execution_mode` na base é só **LIVE**.

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

### Prática real ~1 USDT (`/live-practice`)

Fluxo **manual** para LIMIT BUY/SELL na CoinEx com teto em quote definido por `LIVE_PRACTICE_QUOTE_VALUE` (por omissão `1` USDT), **sem** ativar `ENABLE_AUTO_LIVE_WORKER`. Usa `LiveSafetyGuard` + snapshot CoinEx como as outras rotas LIVE.

| Variável | Função |
|----------|--------|
| `LIVE_PRACTICE_QUOTE_VALUE` | Teto em **quote** (ex.: `1`) para BUY e alvo aproximado para SELL |
| `LIVE_PRACTICE_MARKET` | Par (ex.: `BTCUSDT`) — tem de constar em `LIVE_MARKET_ALLOWLIST` |
| `LIVE_PRACTICE_CONFIRM_PHRASE` | Frase exata exigida no JSON (`confirm`) e no painel (prompt) |

**Chave API CoinEx (sem vazar credenciais):**

1. Na CoinEx, crie uma API key **sem permissão de levantamento (withdraw)** e restrinja a IP se disponível.
2. Preencha **apenas** `COINEX_ACCESS_ID` e `COINEX_SECRET_KEY` no `.env` local — **nunca** commite o ficheiro; se uma chave for exposta, **revogue-a** na CoinEx e crie outra.
3. Para prática: `ENABLE_LIVE_TRADING=true`, `ENABLE_AUTO_LIVE_WORKER=false`, `MARKET_DATA_SOURCE=COINEX`, `execution_mode=LIVE` e `runtime_status=RUNNING` no Postgres, chaves válidas e reconciliador saudável. **`ENABLE_AUTO_LIVE_WORKER` deve permanecer `false`** para este fluxo manual; com `true`, as rotas bloqueiam por segurança.

**Notional mínimo:** se a CoinEx exigir `min_amount` / `min_value` acima do que ~`LIVE_PRACTICE_QUOTE_VALUE` USDT permite, o preview e o envio bloqueiam com mensagem clara (não se “força” o arredondamento contra o `MarketSpec`).

| Método | Rota | Descrição |
|--------|------|------------|
| GET | `/live-practice/status` | Flags, ticker, spec, saldo CoinEx, `canPractice`, `blockingReasons`, `confirmPhraseRequired`, aviso fixo em inglês |
| POST | `/live-practice/preview-buy` | Corpo `{ "confirm": "<frase .env>" }` — plano + `runLivePlacePrecheck`, **sem** ordem |
| POST | `/live-practice/buy` | Mesmas travas que LIVE manual + reconciliação; LIMIT BUY; `client_id` prefixo `LIVE_PRACTICE_BUY_` |
| POST | `/live-practice/preview-sell` | Idem, lado venda até ~quote configurado |
| POST | `/live-practice/sell` | LIMIT SELL; `LIVE_PRACTICE_SELL_` |
| POST | `/live-practice/cancel-open` | Cancela só ordens abertas com `client_id` começado por `LIVE_PRACTICE_` |

Eventos: `LIVE_PRACTICE_STATUS_CHECKED`, `LIVE_PRACTICE_PREVIEW_BUY`, `LIVE_PRACTICE_PREVIEW_SELL`, `LIVE_PRACTICE_BUY_PLACING`, `LIVE_PRACTICE_BUY_PLACED`, `LIVE_PRACTICE_SELL_PLACING`, `LIVE_PRACTICE_SELL_PLACED`, `LIVE_PRACTICE_BLOCKED`, `LIVE_PRACTICE_CANCEL_REQUESTED`, `LIVE_PRACTICE_CANCELLED`, `LIVE_PRACTICE_ERROR`.

Exemplos `curl` (substitua a frase se alterou `LIVE_PRACTICE_CONFIRM_PHRASE` no `.env`):

```bash
curl -X POST http://localhost:3000/live-practice/preview-buy \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_IS_REAL_MONEY"}'

curl -X POST http://localhost:3000/live-practice/buy \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_IS_REAL_MONEY"}'

curl -X POST http://localhost:3000/live-practice/preview-sell \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_IS_REAL_MONEY"}'

curl -X POST http://localhost:3000/live-practice/sell \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_IS_REAL_MONEY"}'

curl -X POST http://localhost:3000/live-practice/cancel-open \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_IS_REAL_MONEY"}'
```

Não existe worker de ciclos simulado; o **Auto LIVE** (`ENABLE_AUTO_LIVE_WORKER`) é o fluxo automático de ciclos reais.

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

No **Postgres** (`bot_configs`, painel Parâmetros): `grid_step_pct` define a **compra** limite (fração abaixo do último, ex. `0.05` = 5%); `target_profit_pct` + `fee_buffer_pct` definem o **preço alvo de venda** sobre a média de compra (ex. `0.02` = +2% antes da margem de taxas).

**`AUTO_LIVE_ORDER_QUOTE_VALUE=1`** pode falhar se `min_amount` / `min_value` da CoinEx exigirem notional maior; ajuste ou aumente `LIVE_MAX_ORDER_QUOTE_VALUE` de forma coerente.

Recomenda-se correr primeiro **`/live-practice`** (prática manual ~1 USDT) antes do FULL Auto LIVE.

### Travas (resumo)

| Área | Conteúdo |
|------|-----------|
| `.env` | `ENABLE_AUTO_LIVE_WORKER`, `ENABLE_LIVE_TRADING`, `AUTO_LIVE_CONFIRM_ENV`, chaves CoinEx, `PORTFOLIO_BALANCE_SOURCE` ∈ {`COINEX`,`BOTH`} |
| Postgres | `runtime_status=RUNNING` (e **não** `KILL_SWITCH`), `execution_mode=LIVE`, `executionLayer=LIVE` |
| Mercado | `MARKET_DATA_SOURCE=COINEX`, ticker/spec **COINEX** frescos (nada de `STATIC_FALLBACK`), `api_trading_enabled` / `trading_enabled`, `LiveSafetyGuard`, `LIVE_MARKET_ALLOWLIST` |
| Reconciliador | `reconciliation_healthy` (tick saudável recente, sem `lastError`, sem fill drift), ordens LIVE não “stale”, sem `BALANCE_DRIFT_DETECTED` recente |
| Ciclo | Sem `MANUAL_REVIEW` aberto; sem duplicar BUY/SELL (`client_id` determinístico `LIVE_AUTO_BUY_<cycle_id>`, `LIVE_AUTO_SELL_<cycle_id>`); `Prisma` transação ao criar ciclo antes do BUY |
| Risco | `AUTO_LIVE_MAX_OPEN_CYCLES`, cooldown após terminal, `AUTO_LIVE_ALLOW_NEW_BUY_WITH_OPEN_SELL`, `LIVE_MAX_*`, saldo USDT mínimo (`min_quote_balance` no Postgres) |

### Arranque sugerido (exemplo)

```env
ENABLE_LIVE_TRADING=true
ENABLE_AUTO_LIVE_WORKER=true
AUTO_LIVE_CONFIRM_ENV=I_UNDERSTAND_THIS_BOT_CAN_TRADE_REAL_MONEY
AUTO_LIVE_ORDER_QUOTE_VALUE=1
LIVE_MAX_ORDER_QUOTE_VALUE=1
LIVE_MAX_DAILY_QUOTE_VOLUME=3
MARKET_DATA_SOURCE=COINEX
PORTFOLIO_BALANCE_SOURCE=BOTH
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

**http://localhost:3000** — painel com **Mercado / Preço / Fonte / Execution / Layer**, **card de spec**, **saldo CoinEx read-only**, **Prática real 1 USDT** (`/live-practice/status` + ações com confirmação), **Reconciliação LIVE (1.6.6)**, **FULL AUTO LIVE (1.7)** (`/live-cycle/summary` + reset de circuito), `runtime_status`, reconciliador + Auto LIVE em paralelo.

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

- `GET /live-practice/status` — estado da prática manual LIVE (~1 USDT): flags, ticker, spec, saldo CoinEx, bloqueios, frase de confirmação esperada.
- `POST /live-practice/preview-buy` | `preview-sell` | `buy` | `sell` | `cancel-open` — ver secção **Prática real ~1 USDT**; corpo JSON com `confirm` igual a `LIVE_PRACTICE_CONFIRM_PHRASE`.
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
