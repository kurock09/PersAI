ALTER TABLE "platform_runtime_provider_settings"
  ALTER COLUMN "available_model_catalog_by_provider"
  SET DEFAULT '{"openai":{"models":[]},"anthropic":{"models":[]}}'::jsonb;
