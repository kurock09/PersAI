-- User-level locale truth for production localization rollout (Phase 1).
ALTER TABLE "app_users"
ADD COLUMN "preferred_locale" VARCHAR(8),
ADD COLUMN "country_code" VARCHAR(2);
