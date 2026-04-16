ALTER TABLE "assistant_materialized_specs"
  RENAME COLUMN "openclaw_bootstrap" TO "assistant_config";

ALTER TABLE "assistant_materialized_specs"
  RENAME COLUMN "openclaw_workspace" TO "assistant_workspace";

ALTER TABLE "assistant_materialized_specs"
  RENAME COLUMN "openclaw_bootstrap_document" TO "assistant_config_document";

ALTER TABLE "assistant_materialized_specs"
  RENAME COLUMN "openclaw_workspace_document" TO "assistant_workspace_document";
