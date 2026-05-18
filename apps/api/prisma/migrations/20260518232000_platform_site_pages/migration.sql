CREATE TABLE "platform_site_pages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(32) NOT NULL,
  "market" VARCHAR(16) NOT NULL,
  "locale" VARCHAR(8) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "title" TEXT NOT NULL,
  "body_markdown" TEXT NOT NULL,
  "version" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "platform_site_pages_slug_market_locale_status_key"
  ON "platform_site_pages" ("slug", "market", "locale", "status");

CREATE INDEX "platform_site_pages_slug_market_locale_idx"
  ON "platform_site_pages" ("slug", "market", "locale");
