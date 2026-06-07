CREATE TABLE "platform_elevenlabs_voice_catalog_cache" (
    "cache_key" VARCHAR(64) NOT NULL,
    "voices_json" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_elevenlabs_voice_catalog_cache_pkey" PRIMARY KEY ("cache_key")
);
