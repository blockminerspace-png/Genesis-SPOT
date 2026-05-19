-- BTC Drop strategy state + optional TradeCycle audit fields
CREATE TABLE "btc_drop_strategy_state" (
    "market" TEXT NOT NULL,
    "anchor_price" DECIMAL(30,12) NOT NULL,
    "next_buy_price" DECIMAL(30,12) NOT NULL,
    "step_usdt" DECIMAL(30,12) NOT NULL,
    "base_amount" DECIMAL(30,12) NOT NULL,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "btc_drop_strategy_state_pkey" PRIMARY KEY ("market")
);

ALTER TABLE "trade_cycles" ADD COLUMN "strategy_name" TEXT;
ALTER TABLE "trade_cycles" ADD COLUMN "strategy_level_price" DECIMAL(30,12);
ALTER TABLE "trade_cycles" ADD COLUMN "base_order_amount" DECIMAL(30,12);
