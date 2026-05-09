-- ADR-089 idempotency guard
-- Unique constraint ensures each (payment_intent_id, package_catalog_item_id) pair can only
-- produce one grant row. This closes the TOCTOU window where two concurrent webhook deliveries
-- could both observe count=0 and create duplicate grants.

CREATE UNIQUE INDEX "uniq_grant_intent_item"
  ON "workspace_media_package_grants" ("payment_intent_id", "package_catalog_item_id");
