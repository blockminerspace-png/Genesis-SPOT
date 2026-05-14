-- Alinha runtime_mode com o flag enabled legado após introdução do enum.
UPDATE "bot_configs"
SET "runtime_mode" = CASE
  WHEN "enabled" THEN 'DRY_RUN'::"BotRuntimeMode"
  ELSE 'OFF'::"BotRuntimeMode"
END;
