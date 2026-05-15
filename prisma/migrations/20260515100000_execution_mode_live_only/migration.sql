-- Só execução real (LIVE); remover DRY_RUN do enum PostgreSQL.
UPDATE "bot_configs" SET "execution_mode" = 'LIVE' WHERE "execution_mode" = 'DRY_RUN';

CREATE TYPE "BotExecutionMode_new" AS ENUM ('LIVE');

ALTER TABLE "bot_configs" ALTER COLUMN "execution_mode" DROP DEFAULT;
ALTER TABLE "bot_configs" ALTER COLUMN "execution_mode" TYPE "BotExecutionMode_new" USING ('LIVE'::"BotExecutionMode_new");
ALTER TABLE "bot_configs" ALTER COLUMN "execution_mode" SET DEFAULT 'LIVE'::"BotExecutionMode_new";

DROP TYPE "BotExecutionMode";
ALTER TYPE "BotExecutionMode_new" RENAME TO "BotExecutionMode";
