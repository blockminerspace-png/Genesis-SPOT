-- CreateEnum
CREATE TYPE "BotRuntimeMode" AS ENUM ('OFF', 'DRY_RUN', 'LIVE', 'PAUSED_BUYS', 'SELL_ONLY', 'KILL_SWITCH');

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN     "runtime_mode" "BotRuntimeMode" NOT NULL DEFAULT 'OFF';
