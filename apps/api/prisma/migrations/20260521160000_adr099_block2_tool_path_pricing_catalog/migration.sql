ALTER TABLE "platform_runtime_provider_settings"
ADD COLUMN "tool_path_pricing_catalog" JSONB NOT NULL DEFAULT '{"schema":"persai.toolPathPricingCatalog.v1","rows":[]}';
