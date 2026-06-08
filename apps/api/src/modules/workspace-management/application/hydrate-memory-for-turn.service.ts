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
 *   * `contextual` — the most recent active short memories, ordered newest
 *     first with deterministic tie-breaks and restricted to
 *     `source_type = memory_write`. Goes into the non-stable
 *     `durable_memory_contextual` block.
 *
 * After selection we bump `last_used_at` for every returned entry so future
 * staleness scoring works.
 */
const DEFAULT_CONTEXTUAL_LIMIT = 6;
const MAX_CONTEXTUAL_LIMIT = 12;

export type HydratedDurableMemoryItem = {
  id: string;
  summary: string;
  chatId: string | null;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClass;
  kind: AssistantMemoryRegistryKind | null;
  createdAt: string;
  score: number | null;
};

export type HydrateMemoryForTurnInput = {
  assistantId: string;
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
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
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
      chatId: row.chatId,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
      memoryClass: row.memoryClass,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
      score: null
    }));

    const contextualLimit = this.resolveContextualLimit(input.contextualLimit);
    const coreIds = new Set(coreItems.map((item) => item.id));
    const coreNormalizedSummaries = new Set(
      coreItems
        .map((item) => normalizeMemoryText(item.summary))
        .filter((summary) => summary.length > 0)
    );
    const contextualEntries =
      contextualLimit > 0
        ? await this.memoryRegistryRepository.listRecentActiveContextualByAssistantId(
            input.assistantId,
            contextualLimit,
            { sourceType: "memory_write" }
          )
        : [];
    const contextualItems = contextualEntries
      .map((row) => ({
        id: row.id,
        summary: row.summary,
        chatId: row.chatId,
        sourceType: row.sourceType,
        sourceLabel: row.sourceLabel,
        memoryClass: row.memoryClass,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        score: null
      }))
      .filter((item) => !coreIds.has(item.id))
      .filter((item) => !isObviouslyNonDurableMemorySummary(item.summary))
      .filter((item) => {
        const normalizedSummary = normalizeMemoryText(item.summary);
        return normalizedSummary.length > 0 && !coreNormalizedSummaries.has(normalizedSummary);
      });

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
}
