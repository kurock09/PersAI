import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryDurability,
  AssistantMemoryRegistryItem,
  AssistantMemoryRegistryKind,
  AssistantMemoryRegistryStability
} from "./assistant-memory-registry-item.entity";

export const ASSISTANT_MEMORY_REGISTRY_REPOSITORY = Symbol("ASSISTANT_MEMORY_REGISTRY_REPOSITORY");

export type CreateAssistantMemoryRegistryItemInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: AssistantMemoryRegistryItem["sourceType"];
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClass;
  kind: AssistantMemoryRegistryKind | null;
  durability: AssistantMemoryRegistryDurability | null;
  stability: AssistantMemoryRegistryStability | null;
  confidence: number | null;
};

export interface AssistantMemoryRegistryRepository {
  create(input: CreateAssistantMemoryRegistryItemInput): Promise<AssistantMemoryRegistryItem>;
  listActiveByAssistantId(
    assistantId: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]>;
  searchActiveByAssistantId(
    assistantId: string,
    query: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]>;
  findActiveByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantMemoryRegistryItem | null>;
  updateSummaryById(
    id: string,
    assistantId: string,
    summary: string
  ): Promise<AssistantMemoryRegistryItem | null>;
  updateEmbeddingById(
    id: string,
    assistantId: string,
    embedding: number[],
    modelKey: string
  ): Promise<boolean>;
  markForgottenById(id: string, assistantId: string): Promise<boolean>;
  listActiveForBackfill(assistantId: string, limit: number): Promise<AssistantMemoryRegistryItem[]>;
  reclassifyMemoryClassById(
    id: string,
    assistantId: string,
    memoryClass: AssistantMemoryRegistryClass
  ): Promise<boolean>;
  markSupersededById(
    id: string,
    assistantId: string,
    supersededByMemoryId: string | null
  ): Promise<boolean>;
  listActiveForConsolidation(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]>;
  markForgottenForMessages(
    assistantId: string,
    filters: { assistantMessageId: string; userMessageId: string | null }
  ): Promise<number>;
  /**
   * ADR-074 M1 — list the always-on "core" durable memory entries for the
   * assistant, ordered most-recent-first. Used by the runtime hydration path
   * to inject the cache-stable `durable_memory_core` block.
   */
  listActiveCoreByAssistantId(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]>;
  listRecentActiveContextualByAssistantId(
    assistantId: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]>;
  /**
   * ADR-074 M1 — number of currently-active core entries. Used by the
   * write-side overflow guard so we can demote the oldest core entry when the
   * hard cap (`MEMORY_CORE_HARD_CAP`) is reached before inserting a new one.
   */
  countActiveCoreByAssistantId(assistantId: string): Promise<number>;
  /**
   * ADR-074 M1 — demote the oldest active core entries to contextual when the
   * core hard cap would otherwise be exceeded. Returns the number of rows
   * actually demoted (may be less than `count` if there are fewer eligible
   * entries).
   */
  demoteOldestCoreByAssistantId(assistantId: string, count: number): Promise<number>;
  /**
   * ADR-074 M1 — bump `last_used_at` to "now" for every memory entry that we
   * just selected for context hydration. This powers staleness scoring without
   * coupling the hydration path to repository internals.
   */
  bumpLastUsedAt(assistantId: string, ids: readonly string[]): Promise<number>;
  /**
   * ADR-074 M2 — server-side dedup lookup for the memory write path. Returns
   * the most recent active entry for `(assistantId)` whose `summary` matches
   * the supplied normalized summary text using a case-insensitive equality
   * comparison. Callers must pre-normalize whitespace exactly as
   * `WriteAssistantMemoryService.normalizeSummary` does so the equality is
   * meaningful. Returns `null` when no match exists.
   */
  findActiveByNormalizedSummaryAndAssistantId(
    assistantId: string,
    normalizedSummary: string
  ): Promise<AssistantMemoryRegistryItem | null>;
  /**
   * ADR-074 Slice M3 — list active (not-forgotten, not-resolved) durable
   * `open_loop` memories for `(assistantId, userId)` whose `created_at` is
   * still within the configured carry-over TTL window. Used by the
   * cross-session carry-over service to inject the "still open from prior
   * sessions" block into the next conversation, regardless of channel.
   */
  findActiveOpenLoopsByAssistantUser(
    assistantId: string,
    userId: string,
    sinceCreatedAt: Date,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]>;
  /**
   * Narrow runtime resolver fetch for active open-loop refs without a carry-over
   * TTL filter. Used by the runtime developer block so the model can close a
   * recently-mentioned loop on the next turn even when the visible carry-over
   * block is no longer present.
   */
  findLatestActiveOpenLoopsByAssistantUser(
    assistantId: string,
    userId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]>;
  countActiveOpenLoopsByAssistantUser(assistantId: string, userId: string): Promise<number>;
  /**
   * ADR-074 Slice M3 — stamp `resolved_at = now()` on an `open_loop` row.
   * Returns true if a row was updated, false if the row was already
   * resolved/forgotten or did not match the assistant. Safe to call when no
   * matching open-loop exists; callers are expected to short-circuit on
   * the boolean.
   */
  setResolvedAtById(id: string, assistantId: string): Promise<boolean>;
  /**
   * ADR-074 Slice M3 — opt-in close-most-similar lookup for `kind = open_loop`.
   * Performs a deterministic lexical token-overlap match against active
   * (not-forgotten, not-resolved) open-loops for the same `(assistantId,
   * userId)`. Returns the highest-scoring candidate, or `null` if none
   * share enough significant tokens with `referenceText` to be considered
   * a match. The matching policy is intentionally simple (no embedding
   * round-trip): M3.1 will replace this with a structured close action.
   */
  findMostSimilarActiveOpenLoop(
    assistantId: string,
    userId: string,
    referenceText: string
  ): Promise<AssistantMemoryRegistryItem | null>;
}
