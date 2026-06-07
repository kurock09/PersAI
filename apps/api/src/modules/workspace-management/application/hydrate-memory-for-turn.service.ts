import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { MEMORY_CORE_HARD_CAP } from "../domain/memory-class-policy";
import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryKind
} from "../domain/assistant-memory-registry-item.entity";
import { ReadAssistantKnowledgeService } from "./read-assistant-knowledge.service";
import { isObviouslyNonDurableMemorySummary, normalizeMemoryText } from "./memory-summary.util";

/**
 * ADR-074 M1 — runtime-facing hydration of durable memory for one turn.
 *
 * The runtime no longer reads `assistant_memory_registry_items` directly to
 * build the durable_memory prompt block. Instead it asks this service for two
 * disjoint slices:
 *   * `core` — the always-on identity/preference memories. Capped at
 *     {@link MEMORY_CORE_HARD_CAP}, ordered most-recent-first. Goes into the
 *     cache-stable `durable_memory_core` block.
 *   * `contextual` — turn-relevance hits ranked by the existing knowledge
 *     retrieval scorer, restricted to `memory_class = contextual` so we never
 *     double-render a core entry. Goes into the non-stable
 *     `durable_memory_contextual` block.
 *
 * After selection we bump `last_used_at` for every returned entry so future
 * staleness scoring works.
 */
const DEFAULT_CONTEXTUAL_LIMIT = 6;
const MAX_CONTEXTUAL_LIMIT = 12;
const MAX_USER_QUERY_CHARS = 2_000;

export type HydratedDurableMemoryItem = {
  id: string;
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClass;
  kind: AssistantMemoryRegistryKind | null;
  createdAt: string;
  score: number | null;
};

export type HydrateMemoryForTurnInput = {
  assistantId: string;
  userQuery: string;
  contextualLimit: number | null;
};

export type HydrateMemoryForTurnResult = {
  core: HydratedDurableMemoryItem[];
  contextual: HydratedDurableMemoryItem[];
};

@Injectable()
export class HydrateMemoryForTurnService {
  constructor(
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository,
    private readonly readAssistantKnowledgeService: ReadAssistantKnowledgeService
  ) {}

  parseInput(payload: unknown): HydrateMemoryForTurnInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Memory hydration payload must be an object.");
    }
    const row = payload as Record<string, unknown>;

    const assistantId =
      typeof row.assistantId === "string" && row.assistantId.trim().length > 0
        ? row.assistantId.trim()
        : null;
    const userQueryRaw = typeof row.userQuery === "string" ? row.userQuery : "";
    const contextualLimitRaw = row.contextualLimit;

    let contextualLimit: number | null;
    if (contextualLimitRaw === undefined || contextualLimitRaw === null) {
      contextualLimit = null;
    } else if (
      typeof contextualLimitRaw === "number" &&
      Number.isInteger(contextualLimitRaw) &&
      contextualLimitRaw >= 0
    ) {
      contextualLimit = contextualLimitRaw;
    } else {
      throw new BadRequestException("contextualLimit must be a non-negative integer.");
    }

    if (assistantId === null) {
      throw new BadRequestException("assistantId is required.");
    }

    return {
      assistantId,
      userQuery: userQueryRaw.slice(0, MAX_USER_QUERY_CHARS),
      contextualLimit
    };
  }

  async execute(input: HydrateMemoryForTurnInput): Promise<HydrateMemoryForTurnResult> {
    const coreEntries = await this.memoryRegistryRepository.listActiveCoreByAssistantId(
      input.assistantId,
      MEMORY_CORE_HARD_CAP
    );
    const coreItems: HydratedDurableMemoryItem[] = coreEntries.map((row) => ({
      id: row.id,
      summary: row.summary,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
      memoryClass: row.memoryClass,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
      score: null
    }));

    const trimmedQuery = input.userQuery.trim();
    const contextualLimit = this.resolveContextualLimit(input.contextualLimit);
    let contextualItems: HydratedDurableMemoryItem[] = [];
    if (trimmedQuery.length > 0 && contextualLimit > 0) {
      const hits = await this.readAssistantKnowledgeService.searchMemory({
        assistantId: input.assistantId,
        query: trimmedQuery,
        maxResults: contextualLimit,
        memoryClass: "contextual"
      });
      const coreIds = new Set(coreItems.map((item) => item.id));
      const coreNormalizedSummaries = new Set(
        coreItems
          .map((item) => normalizeMemoryText(item.summary))
          .filter((summary) => summary.length > 0)
      );
      contextualItems = hits
        .map((hit) => this.toHydratedItem(hit))
        .filter((item): item is HydratedDurableMemoryItem => item !== null)
        .filter((item) => !coreIds.has(item.id))
        .filter((item) => !isObviouslyNonDurableMemorySummary(item.summary))
        .filter((item) => {
          const normalizedSummary = normalizeMemoryText(item.summary);
          return normalizedSummary.length > 0 && !coreNormalizedSummaries.has(normalizedSummary);
        });
    }

    const touchedIds = [...coreItems, ...contextualItems].map((item) => item.id);
    if (touchedIds.length > 0) {
      await this.memoryRegistryRepository.bumpLastUsedAt(input.assistantId, touchedIds);
    }

    return {
      core: coreItems,
      contextual: contextualItems
    };
  }

  private resolveContextualLimit(requested: number | null): number {
    if (requested === null) {
      return DEFAULT_CONTEXTUAL_LIMIT;
    }
    if (requested < 0) {
      return 0;
    }
    return Math.min(requested, MAX_CONTEXTUAL_LIMIT);
  }

  private toHydratedItem(hit: {
    referenceId: string;
    score: number | null;
    snippet: string | null;
    metadata: unknown;
  }): HydratedDurableMemoryItem | null {
    const metadata = this.asObject(hit.metadata);
    if (metadata === null) {
      return null;
    }
    const memoryItemId = metadata.memoryItemId;
    const sourceType = metadata.sourceType;
    const memoryClass = metadata.memoryClass;
    const kind = metadata.kind;
    const summary = metadata.summary;
    const createdAt = metadata.createdAt;
    if (
      typeof memoryItemId !== "string" ||
      memoryItemId.length === 0 ||
      (sourceType !== "web_chat" && sourceType !== "memory_write") ||
      (memoryClass !== "core" && memoryClass !== "contextual") ||
      (kind !== null && kind !== "fact" && kind !== "preference" && kind !== "open_loop") ||
      typeof summary !== "string" ||
      typeof createdAt !== "string"
    ) {
      return null;
    }
    return {
      id: memoryItemId,
      summary,
      sourceType,
      sourceLabel: typeof metadata.sourceLabel === "string" ? metadata.sourceLabel : null,
      memoryClass,
      kind,
      createdAt,
      score: hit.score
    };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
