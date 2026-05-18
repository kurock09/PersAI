CREATE TABLE "platform_gamma_theme_catalog_cache" (
    "cache_key" VARCHAR(64) NOT NULL,
    "themes_json" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_gamma_theme_catalog_cache_pkey" PRIMARY KEY ("cache_key")
);
