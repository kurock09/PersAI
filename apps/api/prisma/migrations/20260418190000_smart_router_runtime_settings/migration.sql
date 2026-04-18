ALTER TABLE "platform_runtime_provider_settings"
ADD COLUMN "routing_fast_model_key" VARCHAR(256),
ADD COLUMN "router_policy" JSONB NOT NULL DEFAULT '{}';
