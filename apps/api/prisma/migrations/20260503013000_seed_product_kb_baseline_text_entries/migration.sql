WITH seed_entries(seed_key, title, body, category, locale, tags, locator) AS (
  VALUES
    (
      'persai-product-overview',
      'PersAI Product Overview',
      'PersAI is a SaaS platform for personal AI assistants. Each user gets a persistent assistant that can be configured, published, updated, reset, and used across supported surfaces instead of starting every chat from zero. The assistant is treated as a governed product entity with lifecycle, memory policy, tool policy, channels, quotas, runtime state, and admin visibility. PersAI is assistant-first, multi-surface, tools-capable, memory-aware, and operationally manageable rather than a thin chat wrapper over a single model prompt.',
      'product_baseline',
      'en-US',
      '["product", "overview", "baseline"]'::jsonb,
      'product-kb:overview'
    ),
    (
      'persai-product-principles',
      'PersAI Product Principles',
      'PersAI follows a draft-and-publish lifecycle instead of uncontrolled live prompt mutation. The platform keeps backend-first governance for lifecycle, ownership, quotas, secrets, rollout, audit, and admin operations while the runtime handles behavior execution and conversational flow. The product is designed to feel human and continuous without hiding important system truth such as publish/apply status, memory controls, quota boundaries, reset semantics, and meaningful degradation. Supported product surfaces currently center on web control, web chat, and Telegram, with future channel expansion planned.',
      'product_baseline',
      'en-US',
      '["product", "principles", "baseline"]'::jsonb,
      'product-kb:principles'
    )
),
workspace_authors AS (
  SELECT DISTINCT ON (workspace_id)
    workspace_id,
    user_id
  FROM workspace_members
  ORDER BY
    workspace_id,
    CASE role WHEN 'owner' THEN 0 ELSE 1 END,
    created_at ASC
),
inserted_entries AS (
  INSERT INTO product_knowledge_text_entries (
    workspace_id,
    created_by_user_id,
    title,
    body,
    category,
    locale,
    tags,
    lifecycle_status,
    status,
    provenance_kind,
    provenance_metadata,
    current_version,
    chunk_count,
    last_indexed_at
  )
  SELECT
    wa.workspace_id,
    wa.user_id,
    se.title,
    se.body,
    se.category,
    se.locale,
    se.tags,
    'active'::"KnowledgeAuthoringLifecycleStatus",
    'ready'::"AssistantKnowledgeSourceStatus",
    'manual'::"KnowledgeAuthoringProvenanceKind",
    jsonb_build_object(
      'schema', 'persai.productKbSeed.v1',
      'seedKey', se.seed_key,
      'migratedFrom', 'persai_global_knowledge'
    ),
    1,
    1,
    NOW()
  FROM workspace_authors wa
  CROSS JOIN seed_entries se
  WHERE NOT EXISTS (
    SELECT 1
    FROM product_knowledge_text_entries existing
    WHERE existing.workspace_id = wa.workspace_id
      AND existing.title = se.title
      AND existing.category = se.category
  )
  RETURNING id, workspace_id, body, title
)
INSERT INTO product_knowledge_text_entry_chunks (
  text_entry_id,
  workspace_id,
  source_version,
  chunk_index,
  locator,
  content,
  embedding_model_key,
  embedding_vector,
  embedding_generated_at
)
SELECT
  inserted_entries.id,
  inserted_entries.workspace_id,
  1,
  0,
  CASE inserted_entries.title
    WHEN 'PersAI Product Overview' THEN 'product-kb:overview'
    ELSE 'product-kb:principles'
  END,
  inserted_entries.body,
  NULL,
  NULL,
  NULL
FROM inserted_entries;
