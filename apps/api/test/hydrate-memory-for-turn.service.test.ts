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

  // execute: returns core items, deduplicates contextual against core,
  // bumps last_used_at for both blocks.
  const coreRow = buildMemoryRow({
    id: "core-1",
    summary: "User's name is Alex.",
    memoryClass: "core",
    kind: "fact",
    sourceLabel: "Memory write: fact"
  });
  const contextualRow = buildMemoryRow({
    id: "ctx-1",
    summary: "Loves photography in Tbilisi.",
    memoryClass: "contextual",
    kind: null,
    sourceLabel: "Web chat memory",
    sourceType: "web_chat"
  });
  const harness = createHarness({
    coreItems: [coreRow],
    contextualHits: [
      {
        referenceId: "memory:ctx-1",
        score: 0.42,
        snippet: "Loves photography in Tbilisi.",
        metadata: {
          memoryItemId: contextualRow.id,
          sourceType: "web_chat",
          sourceLabel: "Web chat memory",
          memoryClass: "contextual",
          kind: null,
          summary: "Loves photography in Tbilisi.",
          createdAt: contextualRow.createdAt.toISOString()
        }
      },
      {
        // duplicate of core entry — should be filtered out
        referenceId: "memory:core-1",
        score: 0.99,
        snippet: "User's name is Alex.",
        metadata: {
          memoryItemId: coreRow.id,
          sourceType: "memory_write",
          sourceLabel: "Memory write: fact",
          memoryClass: "core",
          kind: "fact",
          summary: "User's name is Alex.",
          createdAt: coreRow.createdAt.toISOString()
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
  assert.equal(result.contextual.length, 1);
  assert.equal(result.contextual[0]?.id, "ctx-1");
  assert.equal(result.contextual[0]?.memoryClass, "contextual");
  assert.equal(result.contextual[0]?.summary, "Loves photography in Tbilisi.");
  assert.equal(harness.searchInputs.length, 1);
  assert.equal(harness.searchInputs[0]?.memoryClass, "contextual");
  assert.equal(harness.bumpedIds.length, 1);
  assert.deepEqual(new Set(harness.bumpedIds[0]), new Set(["core-1", "ctx-1"]));

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
