ALTER TABLE "knowledge_retrieval_events"
  ADD COLUMN "decision_mode" VARCHAR(32) NOT NULL DEFAULT 'refresh_search_only',
  ADD COLUMN "cache_reuse_hit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "helper_changed_order" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "candidate_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "top_score_margin" DOUBLE PRECISION,
  ADD COLUMN "query_similarity" DOUBLE PRECISION,
  ADD COLUMN "cached_reference_coverage" DOUBLE PRECISION,
  ADD COLUMN "candidate_ambiguity" DOUBLE PRECISION;

ALTER TABLE "knowledge_retrieval_rollups"
  ADD COLUMN "reuse_cached_refs_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refresh_search_only_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refresh_with_helper_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cache_reuse_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "helper_changed_order_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "candidate_count_total" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "top_score_margin_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "query_similarity_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "cached_reference_coverage_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "candidate_ambiguity_total" DOUBLE PRECISION NOT NULL DEFAULT 0;
