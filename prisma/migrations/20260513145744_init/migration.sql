-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('WAITING_BUY_SIGNAL', 'BUY_PLACED', 'BUY_PARTIALLY_FILLED', 'BUY_FILLED', 'SELL_PLACED', 'SELL_PARTIALLY_FILLED', 'CLOSED_PROFIT', 'CANCELLED', 'ERROR', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LIMIT', 'MARKET', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "bot_configs" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'BTCUSDT',
    "quote_currency" TEXT NOT NULL DEFAULT 'USDT',
    "base_currency" TEXT NOT NULL DEFAULT 'BTC',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "order_quote_size" DECIMAL(30,12) NOT NULL,
    "target_profit_pct" DECIMAL(18,10) NOT NULL,
    "grid_step_pct" DECIMAL(18,10) NOT NULL,
    "max_open_cycles" INTEGER NOT NULL,
    "max_quote_allocation" DECIMAL(30,12) NOT NULL,
    "min_quote_balance" DECIMAL(30,12) NOT NULL,
    "fee_buffer_pct" DECIMAL(18,10) NOT NULL DEFAULT 0.002,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_cycles" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL,
    "entry_price" DECIMAL(30,12),
    "target_price" DECIMAL(30,12),
    "quote_budget" DECIMAL(30,12) NOT NULL,
    "quote_spent" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "base_filled" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "buy_fee" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "sell_fee" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "realized_profit_quote" DECIMAL(30,12),
    "realized_profit_pct" DECIMAL(18,10),
    "buy_order_id" UUID,
    "sell_order_id" UUID,
    "opened_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trade_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "cycle_id" UUID,
    "exchange_order_id" TEXT,
    "client_id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "price" DECIMAL(30,12),
    "amount" DECIMAL(30,12) NOT NULL,
    "filled_amount" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "filled_value" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "fee" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "fee_currency" TEXT,
    "raw_response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fills" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "exchange_deal_id" TEXT,
    "price" DECIMAL(30,12) NOT NULL,
    "amount" DECIMAL(30,12) NOT NULL,
    "value" DECIMAL(30,12) NOT NULL,
    "fee" DECIMAL(30,12) NOT NULL,
    "fee_currency" TEXT NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_events" (
    "id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_cycles_buy_order_id_key" ON "trade_cycles"("buy_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_cycles_sell_order_id_key" ON "trade_cycles"("sell_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_client_id_key" ON "orders"("client_id");

-- CreateIndex
CREATE INDEX "orders_cycle_id_idx" ON "orders"("cycle_id");

-- CreateIndex
CREATE INDEX "orders_exchange_order_id_idx" ON "orders"("exchange_order_id");

-- CreateIndex
CREATE INDEX "order_fills_order_id_idx" ON "order_fills"("order_id");

-- CreateIndex
CREATE INDEX "bot_events_created_at_idx" ON "bot_events"("created_at");

-- AddForeignKey
ALTER TABLE "trade_cycles" ADD CONSTRAINT "trade_cycles_buy_order_id_fkey" FOREIGN KEY ("buy_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_cycles" ADD CONSTRAINT "trade_cycles_sell_order_id_fkey" FOREIGN KEY ("sell_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "trade_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fills" ADD CONSTRAINT "order_fills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
