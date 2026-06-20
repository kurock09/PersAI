-- ADR-120 Closure II — vector store hardening + legacy embedding column retirement.
--
-- Part A — retire the unused legacy JSONB embedding columns.
--   The three per-source *_chunks tables remain the canonical TEXT store
--   (lexical search, snippets, and knowledge_fetch all read content/locator
--   from them). Their JSONB embedding columns are now dead: every retrieval
--   path reads vectors solely from the unified "knowledge_vector_chunks"
--   store. The one-time parity backfill is complete, so we drop them.
--   NON-REVERSIBLE: dropping these columns is data loss. There is no down
--   migration — the data lived only as a rollback copy of the unified store
--   and the unified store is now authoritative.
--
-- Part B — add the missing ANN index on the unified store.
--   pgvector 0.8.1 caps the bare "vector" type at 2000 dims for HNSW, but our
--   embeddings are text-embedding-3-large at vector(3072), so we index via a
--   halfvec(3072) expression (halfvec_cosine_ops), which HNSW supports up to
--   4000 dims. The unified store is uniform 3072 across all rows, so the cast
--   is always valid. The search query orders by the same halfvec cast so the
--   planner can use this index, then re-scores the top-K at full precision.
--   Plain (non-CONCURRENT) CREATE INDEX is fine: the table is tiny (~1k rows)
--   and migrations run inside a transaction.
--   To revert Part B:
--     DROP INDEX IF EXISTS "knowledge_vector_chunks_embedding_hnsw_idx";

ALTER TABLE "assistant_knowledge_source_chunks" DROP COLUMN IF EXISTS "embedding_vector", DROP COLUMN IF EXISTS "embedding_generated_at";
ALTER TABLE "global_knowledge_source_chunks" DROP COLUMN IF EXISTS "embedding_vector", DROP COLUMN IF EXISTS "embedding_generated_at";
ALTER TABLE "product_knowledge_text_entry_chunks" DROP COLUMN IF EXISTS "embedding_vector", DROP COLUMN IF EXISTS "embedding_generated_at";

CREATE INDEX IF NOT EXISTS "knowledge_vector_chunks_embedding_hnsw_idx"
  ON "knowledge_vector_chunks"
  USING hnsw (("embedding_vector"::halfvec(3072)) halfvec_cosine_ops);
