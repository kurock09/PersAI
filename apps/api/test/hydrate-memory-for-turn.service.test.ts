import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import type {
  AssistantMemoryRegistryItem,
  AssistantMemoryRegistryClass
} from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import { HydrateMemoryForTurnService } from "../src/modules/workspace-management/application/hydrate-memory-for-turn.service";
import type { ReadAssistantKnowledgeService } from "../src/modules/workspace-management/application/read-assistant-knowledge.service";

type MemoryRow = AssistantMemoryRegistryItem;

function buildMemoryRow(overrides: Partial<MemoryRow>): MemoryRow {
  const createdAt = new Date("2026-04-20T12:00:00.000Z");
  return {
    id: "memory-id",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "summary",
    sourceType: "memory_write",
    sourceLabel: "Memory write: fact",
    memoryClass: "core",
    kind: "fact",
    durability: "identity",
    stability: "stable",
    confidence: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    createdAt,
    ...overrides
  };
}

function createHarness(options?: {
  coreItems?: MemoryRow[];
  contextualHits?: Array<{
    referenceId: string;
    score: number | null;
    snippet: string | null;
    metadata: unknown;
  }>;
}) {
  const bumpedIds: string[][] = [];
  const searchInputs: Array<{
    assistantId: string;
    query: string;
    maxResults: number;
    memoryClass: AssistantMemoryRegistryClass | undefined;
  }> = [];
  const coreItems = options?.coreItems ?? [];
  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "listActiveCoreByAssistantId" | "bumpLastUsedAt"
  > = {
    async listActiveCoreByAssistantId() {
      return coreItems;
    },
    async bumpLastUsedAt(_assistantId, ids) {
      bumpedIds.push(ids);
    }
  };
  const readAssistantKnowledgeService: Pick<ReadAssistantKnowledgeService, "searchMemory"> = {
    async searchMemory(input) {
      searchInputs.push({
        assistantId: input.assistantId,
        query: input.query,
        maxResults: input.maxResults,
        memoryClass: input.memoryClass
      });
      return (options?.contextualHits ?? []).map((hit) => ({
        referenceId: hit.referenceId,
        source: "memory" as const,
        title: null,
        locator: null,
        snippet: hit.snippet,
        score: hit.score,
        metadata: hit.metadata
      }));
    }
  };
  return {
    service: new HydrateMemoryForTurnService(
      memoryRepository as AssistantMemoryRegistryRepository,
      readAssistantKnowledgeService as ReadAssistantKnowledgeService
    ),
    bumpedIds,
    searchInputs
  };
}

async function run(): Promise<void> {
  // parseInput: rejects missing assistantId
  const validate = createHarness();
  assert.throws(
    () =>
      validate.service.parseInput({
        userQuery: "anything",
        contextualLimit: 4
      }),
    (error) => error instanceof BadRequestException
  );
  assert.throws(
    () =>
      validate.service.parseInput({
        assistantId: "assistant-1",
        userQuery: "anything",
        contextualLimit: -2
      }),
    (error) => error instanceof BadRequestException
  );
  const parsed = validate.service.parseInput({
    assistantId: "  assistant-1  ",
    userQuery: "I am Alex",
    contextualLimit: null
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.userQuery, "I am Alex");
  assert.equal(parsed.contextualLimit, null);

  // execute: returns core items, drops trivial contextual noise, filters
  // normalized contextual duplicates of core, and preserves the search order
  // of surviving contextual hits.
  const coreRow = buildMemoryRow({
    id: "core-1",
    summary: "User's name is Alex.",
    memoryClass: "core",
    kind: "fact",
    sourceLabel: "Memory write: fact"
  });
  const contextualRow = buildMemoryRow({
    id: "ctx-keep-1",
    summary: "Loves photography in Tbilisi.",
    memoryClass: "contextual",
    kind: null,
    sourceLabel: "Web chat memory",
    sourceType: "web_chat"
  });
  const contextualPreferenceRow = buildMemoryRow({
    id: "ctx-keep-2",
    summary: "Prefers walking routes over museum-heavy plans.",
    memoryClass: "contextual",
    kind: "preference",
    sourceLabel: "Memory write: preference"
  });
  const harness = createHarness({
    coreItems: [coreRow],
    contextualHits: [
      {
        referenceId: "memory:greeting-noise",
        score: 99,
        snippet: "hello",
        metadata: {
          memoryItemId: "greeting-noise",
          sourceType: "web_chat",
          sourceLabel: "Web chat memory",
          memoryClass: "contextual",
          kind: null,
          summary: "hello",
          createdAt: contextualRow.createdAt.toISOString()
        }
      },
      {
        referenceId: "memory:ctx-keep-1",
        score: 42,
        snippet: contextualRow.summary,
        metadata: {
          memoryItemId: contextualRow.id,
          sourceType: "web_chat",
          sourceLabel: "Web chat memory",
          memoryClass: "contextual",
          kind: null,
          summary: contextualRow.summary,
          createdAt: contextualRow.createdAt.toISOString()
        }
      },
      {
        // normalized duplicate of core entry with a different id — should be filtered out
        referenceId: "memory:ctx-duplicate-core-text",
        score: 41,
        snippet: "User's name is Alex.",
        metadata: {
          memoryItemId: "ctx-duplicate-core-text",
          sourceType: "memory_write",
          sourceLabel: "Memory write: fact",
          memoryClass: "contextual",
          kind: "fact",
          summary: "  User's   name is Alex.  ",
          createdAt: coreRow.createdAt.toISOString()
        }
      },
      {
        referenceId: "memory:ctx-keep-2",
        score: 12,
        snippet: contextualPreferenceRow.summary,
        metadata: {
          memoryItemId: contextualPreferenceRow.id,
          sourceType: "memory_write",
          sourceLabel: "Memory write: preference",
          memoryClass: "contextual",
          kind: "preference",
          summary: contextualPreferenceRow.summary,
          createdAt: contextualPreferenceRow.createdAt.toISOString()
        }
      }
    ]
  });
  const result = await harness.service.execute({
    assistantId: "assistant-1",
    userQuery: "what should we plan in Tbilisi?",
    contextualLimit: 6
  });

  assert.equal(result.core.length, 1);
  assert.equal(result.core[0]?.id, "core-1");
  assert.equal(result.core[0]?.memoryClass, "core");
  assert.equal(result.core[0]?.kind, "fact");
  assert.deepEqual(
    result.contextual.map((item) => item.id),
    ["ctx-keep-1", "ctx-keep-2"]
  );
  assert.deepEqual(
    result.contextual.map((item) => item.summary),
    ["Loves photography in Tbilisi.", "Prefers walking routes over museum-heavy plans."]
  );
  assert.equal(harness.searchInputs.length, 1);
  assert.equal(harness.searchInputs[0]?.memoryClass, "contextual");
  assert.equal(harness.bumpedIds.length, 1);
  assert.deepEqual(new Set(harness.bumpedIds[0]), new Set(["core-1", "ctx-keep-1", "ctx-keep-2"]));

  // empty query skips contextual lookup entirely
  const emptyQueryHarness = createHarness({
    coreItems: [coreRow]
  });
  const emptyQueryResult = await emptyQueryHarness.service.execute({
    assistantId: "assistant-1",
    userQuery: "    ",
    contextualLimit: null
  });
  assert.equal(emptyQueryResult.contextual.length, 0);
  assert.equal(emptyQueryHarness.searchInputs.length, 0);
  assert.equal(emptyQueryHarness.bumpedIds.length, 1);
  assert.deepEqual(emptyQueryHarness.bumpedIds[0], ["core-1"]);
}

void run();
