-- CreateTable
CREATE TABLE "platform_runtime_provider_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "primary_provider" VARCHAR(32) NOT NULL,
    "primary_model" VARCHAR(256) NOT NULL,
    "fallback_provider" VARCHAR(32),
    "fallback_model" VARCHAR(256),
    "available_models_by_provider" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_runtime_provider_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_runtime_provider_secrets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settings_id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "provider_key" VARCHAR(32) NOT NULL,
    "encryption_schema_version" INTEGER NOT NULL DEFAULT 1,
    "ciphertext" TEXT NOT NULL,
    "iv" VARCHAR(128) NOT NULL,
    "auth_tag" VARCHAR(128) NOT NULL,
    "last_four" VARCHAR(8),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_runtime_provider_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_runtime_provider_secrets_provider_key_key" ON "platform_runtime_provider_secrets"("provider_key");

-- CreateIndex
CREATE INDEX "platform_runtime_provider_secrets_settings_id_idx" ON "platform_runtime_provider_secrets"("settings_id");

-- AddForeignKey
ALTER TABLE "platform_runtime_provider_settings" ADD CONSTRAINT "platform_runtime_provider_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_runtime_provider_secrets" ADD CONSTRAINT "platform_runtime_provider_secrets_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "platform_runtime_provider_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_runtime_provider_secrets" ADD CONSTRAINT "platform_runtime_provider_secrets_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
