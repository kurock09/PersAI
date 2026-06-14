-- ADR-116 Slice 116.0 — plan-owned file preview byte/edge limits on files tool activation.
ALTER TABLE "plan_catalog_tool_activations"
ADD COLUMN "max_file_preview_bytes" INTEGER,
ADD COLUMN "max_file_preview_edge_px" INTEGER;
