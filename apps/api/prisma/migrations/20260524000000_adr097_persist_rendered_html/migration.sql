-- ADR-097 Slice 1: persist the exact post-repairHtmlDocument HTML on every new
-- AssistantDocumentVersion. The field is nullable because existing rows have no
-- stored HTML and backfill is intentionally out of scope (Slice 2 will reject
-- patch-revise of versions without renderedHtml with an honest error).
ALTER TABLE "assistant_document_versions"
  ADD COLUMN IF NOT EXISTS "rendered_html" TEXT;
