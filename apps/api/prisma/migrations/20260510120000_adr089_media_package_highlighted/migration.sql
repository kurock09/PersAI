-- ADR-089 follow-up: replace per-locale Badge text on media package presets
-- with a single boolean `highlighted` flag. The previous bilingual badge fields
-- were operator-facing only and unused on the user surface; the new flag drives
-- the gold premium-card highlight on /app/packages.

ALTER TABLE "media_package_catalog_items"
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "media_package_catalog_items"
  DROP COLUMN "badge_ru",
  DROP COLUMN "badge_en";
