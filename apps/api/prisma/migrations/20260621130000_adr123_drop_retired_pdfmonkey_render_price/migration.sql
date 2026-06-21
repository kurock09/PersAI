-- ADR-123 Slice 5 follow-up: drop the retired `document_render:pdfmonkey` tool-path
-- pricing row from the stored tool-path pricing catalog. The in-sandbox WeasyPrint
-- PDF renderer replaced PDFMonkey; `document_render` code defaults are now gamma-only,
-- but the catalog merge preserves stored rows, so the stale pdfmonkey row (and its
-- price) kept surfacing in Admin > Tools. This removes it. Idempotent: only updates
-- the single platform settings row when the stale element is present.
UPDATE "platform_runtime_provider_settings" AS s
SET "tool_path_pricing_catalog" = jsonb_set(
  s."tool_path_pricing_catalog",
  '{rows}',
  COALESCE(
    (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(s."tool_path_pricing_catalog" -> 'rows') AS elem
      WHERE elem ->> 'pathKey' <> 'document_render:pdfmonkey'
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(s."tool_path_pricing_catalog" -> 'rows') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(s."tool_path_pricing_catalog" -> 'rows') AS elem
    WHERE elem ->> 'pathKey' = 'document_render:pdfmonkey'
  );
