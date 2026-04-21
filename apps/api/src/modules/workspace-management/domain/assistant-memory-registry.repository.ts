import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryItem,
  AssistantMemoryRegistryKind
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
  markForgottenById(id: string, assistantId: string): Promise<boolean>;
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
}
