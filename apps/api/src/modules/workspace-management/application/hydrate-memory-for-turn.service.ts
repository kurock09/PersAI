import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { MEMORY_CORE_HARD_CAP } from "../domain/memory-class-policy";
import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryKind,
  AssistantMemoryRegistryProvenance
} from "../domain/assistant-memory-registry-item.entity";

/**
 * ADR-074 M1 / ADR-120 Slice 1 — runtime-facing hydration of durable memory for one turn.
 *
 * The runtime no longer reads `assistant_memory_registry_items` directly to build the
 * durable_memory prompt block. Instead it asks this service for the always-on identity/
 * preference `core` memories, capped at {@link MEMORY_CORE_HARD_CAP}, ordered most-recent-first.
 * These go into the cache-stable `durable_memory_core` block (primacy zone).
 *
 * ADR-120 Slice 1 retired the always-on pushed contextual short-memory leg entirely: it pushed
 * cross-chat facts into the recency zone (memory bleeding). Cross-chat recall is now pull-only
 * via the `knowledge_search` `memory` source. This service therefore returns only `core`.
 *
 * After selection we bump `last_used_at` for every returned entry so future staleness scoring
 * works.
 */
export type HydratedDurableMemoryItem = {
  id: string;
  summary: string;
  chatId: string | null;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClass;
  kind: AssistantMemoryRegistryKind | null;
  provenance: AssistantMemoryRegistryProvenance;
  createdAt: string;
  score: number | null;
};

export type HydrateMemoryForTurnInput = {
  assistantId: string;
};

export type HydrateMemoryForTurnResult = {
  core: HydratedDurableMemoryItem[];
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

    if (assistantId === null) {
      throw new BadRequestException("assistantId is required.");
    }

    return {
      assistantId
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
      provenance: row.provenance,
      createdAt: row.createdAt.toISOString(),
      score: null
    }));

    const touchedIds = coreItems.map((item) => item.id);
    if (touchedIds.length > 0) {
      await this.memoryRegistryRepository.bumpLastUsedAt(input.assistantId, touchedIds);
    }

    return {
      core: coreItems
    };
  }
}
