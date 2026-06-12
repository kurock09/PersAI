CREATE TABLE "platform_heygen_voice_curation" (
    "provider_voice_id" VARCHAR(128) PRIMARY KEY,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model_shortlist" BOOLEAN NOT NULL DEFAULT false,
    "language_bucket" VARCHAR(16) NOT NULL,
    "gender" VARCHAR(16) NOT NULL,
    "updated_by_user_id" VARCHAR(64),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
