-- ADR-089: Media package add-ons
-- Adds: MediaPackageType enum, MediaPackageGrantStatus enum,
--        media_package_catalog_items table, workspace_media_package_grants table

CREATE TYPE "MediaPackageType" AS ENUM ('image_generate', 'image_edit', 'video_generate');
CREATE TYPE "MediaPackageGrantStatus" AS ENUM ('active', 'expired_period', 'reversed');

CREATE TABLE "media_package_catalog_items" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_type"   "MediaPackageType" NOT NULL,
    "units"          INTEGER NOT NULL,
    "amount_minor"   INTEGER NOT NULL,
    "currency"       VARCHAR(3) NOT NULL,
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "display_order"  INTEGER NOT NULL DEFAULT 0,
    "title_ru"       VARCHAR(120) NOT NULL,
    "title_en"       VARCHAR(120) NOT NULL,
    "subtitle_ru"    VARCHAR(240) NOT NULL DEFAULT '',
    "subtitle_en"    VARCHAR(240) NOT NULL DEFAULT '',
    "badge_ru"       VARCHAR(64) NOT NULL DEFAULT '',
    "badge_en"       VARCHAR(64) NOT NULL DEFAULT '',
    "cta_label_ru"   VARCHAR(64) NOT NULL DEFAULT '',
    "cta_label_en"   VARCHAR(64) NOT NULL DEFAULT '',
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "media_package_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_package_catalog_items_package_type_is_active_display_order_idx"
    ON "media_package_catalog_items"("package_type", "is_active", "display_order");

CREATE TABLE "workspace_media_package_grants" (
    "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"            UUID NOT NULL,
    "package_catalog_item_id" UUID NOT NULL,
    "tool_code"               VARCHAR(64) NOT NULL,
    "granted_units"           INTEGER NOT NULL,
    "amount_minor_snapshot"   INTEGER NOT NULL,
    "currency_snapshot"       VARCHAR(3) NOT NULL,
    "payment_intent_id"       UUID NOT NULL,
    "period_started_at"       TIMESTAMPTZ(6) NOT NULL,
    "period_ends_at"          TIMESTAMPTZ(6) NOT NULL,
    "status"                  "MediaPackageGrantStatus" NOT NULL DEFAULT 'active',
    "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_media_package_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workspace_media_package_grants_wid_tool_status_ends_idx"
    ON "workspace_media_package_grants"("workspace_id", "tool_code", "status", "period_ends_at");

CREATE INDEX "workspace_media_package_grants_wid_ends_idx"
    ON "workspace_media_package_grants"("workspace_id", "period_ends_at");

CREATE INDEX "workspace_media_package_grants_payment_intent_id_idx"
    ON "workspace_media_package_grants"("payment_intent_id");

ALTER TABLE "workspace_media_package_grants"
    ADD CONSTRAINT "workspace_media_package_grants_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_media_package_grants"
    ADD CONSTRAINT "workspace_media_package_grants_package_catalog_item_id_fkey"
    FOREIGN KEY ("package_catalog_item_id") REFERENCES "media_package_catalog_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_media_package_grants"
    ADD CONSTRAINT "workspace_media_package_grants_payment_intent_id_fkey"
    FOREIGN KEY ("payment_intent_id") REFERENCES "workspace_payment_intents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
