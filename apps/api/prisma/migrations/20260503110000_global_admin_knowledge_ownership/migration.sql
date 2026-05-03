-- Global admin Knowledge ownership cut.
--
-- Skill, Product KB, and Global/Product document sources are platform-managed
-- knowledge bases. Tenant workspace ids remain only on private assistant
-- knowledge and consuming-workspace telemetry.

WITH baseline_entries AS (
  SELECT
    id,
    COALESCE(
      provenance_metadata ->> 'seedKey',
      CASE
        WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
          THEN 'persai-product-overview'
        WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
          THEN 'persai-product-principles'
        ELSE NULL
      END
    ) AS seed_key,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        provenance_metadata ->> 'seedKey',
        CASE
          WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
            THEN 'persai-product-overview'
          WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
            THEN 'persai-product-principles'
          ELSE NULL
        END
      )
      ORDER BY
        CASE WHEN lifecycle_status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN status = 'ready' THEN 0 ELSE 1 END,
        updated_at DESC,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM product_knowledge_text_entries
  WHERE COALESCE(
    provenance_metadata ->> 'seedKey',
    CASE
      WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
        THEN 'persai-product-overview'
      WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
        THEN 'persai-product-principles'
      ELSE NULL
    END
  ) IN ('persai-product-overview', 'persai-product-principles')
),
duplicate_baseline_entries AS (
  SELECT id
  FROM baseline_entries
  WHERE seed_key IS NOT NULL
    AND row_rank > 1
)
DELETE FROM knowledge_vector_chunks
WHERE source_type = 'product_knowledge_text_entry'
  AND source_id IN (SELECT id FROM duplicate_baseline_entries);

WITH baseline_entries AS (
  SELECT
    id,
    COALESCE(
      provenance_metadata ->> 'seedKey',
      CASE
        WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
          THEN 'persai-product-overview'
        WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
          THEN 'persai-product-principles'
        ELSE NULL
      END
    ) AS seed_key,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        provenance_metadata ->> 'seedKey',
        CASE
          WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
            THEN 'persai-product-overview'
          WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
            THEN 'persai-product-principles'
          ELSE NULL
        END
      )
      ORDER BY
        CASE WHEN lifecycle_status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN status = 'ready' THEN 0 ELSE 1 END,
        updated_at DESC,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM product_knowledge_text_entries
  WHERE COALESCE(
    provenance_metadata ->> 'seedKey',
    CASE
      WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
        THEN 'persai-product-overview'
      WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
        THEN 'persai-product-principles'
      ELSE NULL
    END
  ) IN ('persai-product-overview', 'persai-product-principles')
),
duplicate_baseline_entries AS (
  SELECT id
  FROM baseline_entries
  WHERE seed_key IS NOT NULL
    AND row_rank > 1
)
DELETE FROM knowledge_indexing_jobs
WHERE source_type = 'product_knowledge_text_entry'
  AND source_id IN (SELECT id FROM duplicate_baseline_entries);

WITH baseline_entries AS (
  SELECT
    id,
    COALESCE(
      provenance_metadata ->> 'seedKey',
      CASE
        WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
          THEN 'persai-product-overview'
        WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
          THEN 'persai-product-principles'
        ELSE NULL
      END
    ) AS seed_key,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        provenance_metadata ->> 'seedKey',
        CASE
          WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
            THEN 'persai-product-overview'
          WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
            THEN 'persai-product-principles'
          ELSE NULL
        END
      )
      ORDER BY
        CASE WHEN lifecycle_status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN status = 'ready' THEN 0 ELSE 1 END,
        updated_at DESC,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM product_knowledge_text_entries
  WHERE COALESCE(
    provenance_metadata ->> 'seedKey',
    CASE
      WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
        THEN 'persai-product-overview'
      WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
        THEN 'persai-product-principles'
      ELSE NULL
    END
  ) IN ('persai-product-overview', 'persai-product-principles')
),
duplicate_baseline_entries AS (
  SELECT id
  FROM baseline_entries
  WHERE seed_key IS NOT NULL
    AND row_rank > 1
)
DELETE FROM product_knowledge_text_entries
WHERE id IN (SELECT id FROM duplicate_baseline_entries);

ALTER TABLE "knowledge_indexing_jobs"
  ALTER COLUMN "workspace_id" DROP NOT NULL;

ALTER TABLE "knowledge_vector_chunks"
  ALTER COLUMN "workspace_id" DROP NOT NULL;

UPDATE knowledge_indexing_jobs
SET workspace_id = NULL
WHERE source_type IN (
  'global_knowledge_source',
  'skill_document',
  'skill_knowledge_card',
  'product_knowledge_text_entry'
);

UPDATE knowledge_vector_chunks
SET workspace_id = NULL
WHERE source_type IN (
  'global_knowledge_source',
  'skill_document',
  'skill_knowledge_card',
  'product_knowledge_text_entry'
);

DO $$
DECLARE
  duplicate_baseline_count INTEGER;
  platform_job_workspace_count INTEGER;
  platform_vector_workspace_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_baseline_count
  FROM (
    SELECT seed_key
    FROM (
      SELECT COALESCE(
        provenance_metadata ->> 'seedKey',
        CASE
          WHEN title = 'PersAI Product Overview' AND category = 'product_baseline'
            THEN 'persai-product-overview'
          WHEN title = 'PersAI Product Principles' AND category = 'product_baseline'
            THEN 'persai-product-principles'
          ELSE NULL
        END
      ) AS seed_key
      FROM product_knowledge_text_entries
    ) rows
    WHERE seed_key IN ('persai-product-overview', 'persai-product-principles')
    GROUP BY seed_key
    HAVING COUNT(*) > 1
  ) duplicate_seed_groups;

  IF duplicate_baseline_count > 0 THEN
    RAISE EXCEPTION 'Product KB baseline dedupe failed: duplicate baseline seed rows remain.';
  END IF;

  SELECT COUNT(*)
  INTO platform_job_workspace_count
  FROM knowledge_indexing_jobs
  WHERE source_type IN (
    'global_knowledge_source',
    'skill_document',
    'skill_knowledge_card',
    'product_knowledge_text_entry'
  )
    AND workspace_id IS NOT NULL;

  IF platform_job_workspace_count > 0 THEN
    RAISE EXCEPTION 'Shared KB indexing jobs still have tenant workspace ownership rows: %', platform_job_workspace_count;
  END IF;

  SELECT COUNT(*)
  INTO platform_vector_workspace_count
  FROM knowledge_vector_chunks
  WHERE source_type IN (
    'global_knowledge_source',
    'skill_document',
    'skill_knowledge_card',
    'product_knowledge_text_entry'
  )
    AND workspace_id IS NOT NULL;

  IF platform_vector_workspace_count > 0 THEN
    RAISE EXCEPTION 'Shared KB vector chunks still have tenant workspace ownership rows: %', platform_vector_workspace_count;
  END IF;
END $$;

DROP INDEX IF EXISTS "global_knowledge_sources_workspace_id_scope_created_at_idx";
DROP INDEX IF EXISTS "global_knowledge_source_chunks_workspace_id_scope_created_at_idx";
DROP INDEX IF EXISTS "product_knowledge_text_entries_workspace_id_lifecycle_created_idx";
DROP INDEX IF EXISTS "product_knowledge_text_entries_workspace_id_status_created_idx";
DROP INDEX IF EXISTS "product_knowledge_text_entry_chunks_workspace_id_created_at_idx";
DROP INDEX IF EXISTS "skills_workspace_status_order_idx";
DROP INDEX IF EXISTS "skills_workspace_category_status_idx";
DROP INDEX IF EXISTS "skill_documents_workspace_status_created_idx";
DROP INDEX IF EXISTS "skill_document_chunks_workspace_skill_created_idx";
DROP INDEX IF EXISTS "skill_knowledge_cards_workspace_id_lifecycle_created_at_idx";
DROP INDEX IF EXISTS "skill_knowledge_cards_workspace_id_status_created_at_idx";
DROP INDEX IF EXISTS "skill_knowledge_card_chunks_workspace_id_skill_id_created_at_idx";

ALTER TABLE "global_knowledge_sources"
  DROP CONSTRAINT IF EXISTS "global_knowledge_sources_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "global_knowledge_source_chunks"
  DROP CONSTRAINT IF EXISTS "global_knowledge_source_chunks_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "product_knowledge_text_entries"
  DROP CONSTRAINT IF EXISTS "product_knowledge_text_entries_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "product_knowledge_text_entry_chunks"
  DROP CONSTRAINT IF EXISTS "product_knowledge_text_entry_chunks_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "skills"
  DROP CONSTRAINT IF EXISTS "skills_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "skill_documents"
  DROP CONSTRAINT IF EXISTS "skill_documents_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "skill_document_chunks"
  DROP CONSTRAINT IF EXISTS "skill_document_chunks_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "skill_knowledge_cards"
  DROP CONSTRAINT IF EXISTS "skill_knowledge_cards_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "skill_knowledge_card_chunks"
  DROP CONSTRAINT IF EXISTS "skill_knowledge_card_chunks_workspace_id_fkey",
  DROP COLUMN IF EXISTS "workspace_id";

CREATE INDEX "product_knowledge_text_entries_lifecycle_created_idx"
  ON "product_knowledge_text_entries"("lifecycle_status", "created_at" DESC);

CREATE INDEX "product_knowledge_text_entries_status_created_idx"
  ON "product_knowledge_text_entries"("status", "created_at" DESC);

CREATE INDEX "skills_status_order_idx"
  ON "skills"("status", "display_order");

CREATE INDEX "skills_category_status_idx"
  ON "skills"("category", "status");

CREATE INDEX "skill_knowledge_cards_status_created_idx"
  ON "skill_knowledge_cards"("status", "created_at" DESC);

ALTER TABLE "knowledge_indexing_jobs"
  ADD CONSTRAINT "knowledge_indexing_jobs_source_ownership_check"
  CHECK (
    (
      "source_type" = 'assistant_knowledge_source'
      AND "workspace_id" IS NOT NULL
      AND "assistant_id" IS NOT NULL
    )
    OR (
      "source_type" <> 'assistant_knowledge_source'
      AND "workspace_id" IS NULL
    )
  );

ALTER TABLE "knowledge_vector_chunks"
  ADD CONSTRAINT "knowledge_vector_chunks_source_ownership_check"
  CHECK (
    (
      "source_type" = 'assistant_knowledge_source'
      AND "workspace_id" IS NOT NULL
      AND "assistant_id" IS NOT NULL
    )
    OR (
      "source_type" <> 'assistant_knowledge_source'
      AND "workspace_id" IS NULL
    )
  );
