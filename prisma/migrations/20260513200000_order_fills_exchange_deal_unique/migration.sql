-- Idempotência: mesmo deal_id da CoinEx não pode ser inserido duas vezes (reconciliação repetida).
CREATE UNIQUE INDEX "order_fills_exchange_deal_id_key" ON "order_fills" ("exchange_deal_id");
