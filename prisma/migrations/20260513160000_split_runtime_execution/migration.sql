-- CreateEnum
CREATE TYPE "BotRuntimeStatus" AS ENUM ('OFF', 'RUNNING', 'PAUSED_BUYS', 'SELL_ONLY', 'KILL_SWITCH');

-- CreateEnum
CREATE TYPE "BotExecutionMode" AS ENUM ('DRY_RUN', 'LIVE');

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN "runtime_status" "BotRuntimeStatus" NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN "execution_mode" "BotExecutionMode" NOT NULL DEFAULT 'DRY_RUN';

-- Migrate from legacy runtime_mode
UPDATE "bot_configs"
SET
  "runtime_status" = CASE "runtime_mode"::text
    WHEN 'OFF' THEN 'OFF'::"BotRuntimeStatus"
    WHEN 'KILL_SWITCH' THEN 'KILL_SWITCH'::"BotRuntimeStatus"
    WHEN 'PAUSED_BUYS' THEN 'PAUSED_BUYS'::"BotRuntimeStatus"
    WHEN 'SELL_ONLY' THEN 'SELL_ONLY'::"BotRuntimeStatus"
    WHEN 'DRY_RUN' THEN 'RUNNING'::"BotRuntimeStatus"
    WHEN 'LIVE' THEN 'RUNNING'::"BotRuntimeStatus"
    ELSE 'RUNNING'::"BotRuntimeStatus"
  END,
  "execution_mode" = CASE "runtime_mode"::text
    WHEN 'LIVE' THEN 'LIVE'::"BotExecutionMode"
    ELSE 'DRY_RUN'::"BotExecutionMode"
  END;

-- AlterTable
ALTER TABLE "bot_configs" DROP COLUMN "runtime_mode";

-- DropEnum
DROP TYPE "BotRuntimeMode";
