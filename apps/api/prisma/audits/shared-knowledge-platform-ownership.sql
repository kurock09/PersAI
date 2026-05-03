-- Post-migration audit for platform-owned shared Knowledge.
--
-- This script is intentionally executable as a single PostgreSQL check. It
-- raises if Skill, Product KB, or Global/Product KB vectors/jobs still carry
-- tenant workspace ownership after the global-admin Knowledge migration.

DO $$
DECLARE
  platform_job_workspace_count INTEGER;
  platform_vector_workspace_count INTEGER;
  duplicate_baseline_group_count INTEGER;
BEGIN
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
    RAISE EXCEPTION 'shared Knowledge indexing jobs with workspace_id remain: %',
      platform_job_workspace_count;
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
    RAISE EXCEPTION 'shared Knowledge vector chunks with workspace_id remain: %',
      platform_vector_workspace_count;
  END IF;

  SELECT COUNT(*)
  INTO duplicate_baseline_group_count
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

  IF duplicate_baseline_group_count > 0 THEN
    RAISE EXCEPTION 'duplicate Product KB baseline rows remain';
  END IF;
END $$;
