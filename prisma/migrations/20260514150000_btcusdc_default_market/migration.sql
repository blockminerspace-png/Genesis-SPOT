-- Par spot BTC/USDC (formato CoinEx: BTCUSDC)
UPDATE bot_configs SET market = 'BTCUSDC', quote_currency = 'USDC', base_currency = 'BTC';

UPDATE trade_cycles SET market = 'BTCUSDC' WHERE market = 'BTCUSDT';

UPDATE orders SET market = 'BTCUSDC' WHERE market = 'BTCUSDT';

ALTER TABLE bot_configs ALTER COLUMN market SET DEFAULT 'BTCUSDC';
ALTER TABLE bot_configs ALTER COLUMN quote_currency SET DEFAULT 'USDC';
