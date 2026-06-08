import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import { HydrateMemoryForTurnService } from "../src/modules/workspace-management/application/hydrate-memory-for-turn.service";

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
    sourceLabel: "Long memory write: fact",
    memoryClass: "core",
    kind: "fact",
    durability: "identity",
    stability: "stable",
    confidence: null,
    embeddingVector: null,
    embeddingModelKey: null,
    embeddingGeneratedAt: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt,
    ...overrides
  };
}

function createHarness(options?: { coreItems?: MemoryRow[]; contextualItems?: MemoryRow[] }) {
  const bumpedIds: string[][] = [];
  const coreListCalls: Array<{ assistantId: string; limit: number }> = [];
  const contextualListCalls: Array<{
    assistantId: string;
    limit: number;
    filter: { sourceType?: MemoryRow["sourceType"] } | undefined;
  }> = [];
  const supersedeCalls: Array<{
    id: string;
    assistantId: string;
    supersededByMemoryId: string | null;
  }> = [];
  const coreItems = options?.coreItems ?? [];
  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    | "listActiveCoreByAssistantId"
    | "listRecentActiveContextualByAssistantId"
    | "bumpLastUsedAt"
    | "markSupersededById"
  > = {
    async listActiveCoreByAssistantId(assistantId, limit) {
      coreListCalls.push({ assistantId, limit });
      return coreItems;
    },
    async listRecentActiveContextualByAssistantId(assistantId, limit, filter) {
      contextualListCalls.push({ assistantId, limit, filter });
      return options?.contextualItems ?? [];
    },
    async bumpLastUsedAt(_assistantId, ids) {
      bumpedIds.push(ids);
    },
    async markSupersededById(id, assistantId, supersededByMemoryId) {
      supersedeCalls.push({ id, assistantId, supersededByMemoryId });
      return false;
    }
  };
  return {
    service: new HydrateMemoryForTurnService(memoryRepository as AssistantMemoryRegistryRepository),
    bumpedIds,
    coreListCalls,
    contextualListCalls,
    memoryRepository,
    supersedeCalls
  };
}

async function run(): Promise<void> {
  // parseInput: rejects missing assistantId
  const validate = createHarness();
  assert.throws(
    () =>
      validate.service.parseInput({
        contextualLimit: 4
      }),
    (error) => error instanceof BadRequestException
  );
  assert.throws(
    () =>
      validate.service.parseInput({
        assistantId: "assistant-1",
        contextualLimit: -2
      }),
    (error) => error instanceof BadRequestException
  );
  const parsed = validate.service.parseInput({
    assistantId: "  assistant-1  ",
    contextualLimit: null
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.contextualLimit, null);

  // execute: returns core items, ignores raw web_chat contextual rows, filters
  // normalized contextual duplicates of core, and preserves newest-first
  // recency order from the repository.
  const coreRow = buildMemoryRow({
    id: "core-1",
    summary: "User's name is Alex.",
    memoryClass: "core",
    kind: "fact",
    sourceLabel: "Long memory write: fact"
  });
  const contextualPreferenceRow = buildMemoryRow({
    id: "ctx-keep-2",
    summary: "Prefers walking routes over museum-heavy plans.",
    chatId: "chat-past-1",
    memoryClass: "contextual",
    kind: "preference",
    sourceLabel: "Short memory write: preference",
    durability: "episodic",
    stability: "time_bound",
    createdAt: new Date("2026-04-20T12:00:02.000Z")
  });
  const contextualFactRow = buildMemoryRow({
    id: "ctx-keep-1",
    summary: "Loves photography in Tbilisi.",
    chatId: "chat-current-1",
    memoryClass: "contextual",
    kind: "fact",
    sourceLabel: "Short memory write: fact",
    durability: "episodic",
    stability: "time_bound",
    createdAt: new Date("2026-04-20T12:00:03.000Z")
  });
  const duplicateCoreSummaryRow = buildMemoryRow({
    id: "ctx-duplicate-core-text",
    summary: "  User's   name is Alex.  ",
    memoryClass: "contextual",
    kind: "fact",
    sourceLabel: "Short memory write: fact",
    durability: "episodic",
    stability: "time_bound",
    createdAt: new Date("2026-04-20T12:00:01.000Z")
  });
  const trivialNoiseRow = buildMemoryRow({
    id: "greeting-noise",
    summary: "hello",
    memoryClass: "contextual",
    kind: "fact",
    sourceLabel: "Short memory write: fact",
    durability: "episodic",
    stability: "time_bound",
    createdAt: new Date("2026-04-20T12:00:04.000Z")
  });
  const harness = createHarness({
    coreItems: [coreRow],
    contextualItems: [
      trivialNoiseRow,
      contextualFactRow,
      contextualPreferenceRow,
      duplicateCoreSummaryRow
    ]
  });
  const result = await harness.service.execute({
    assistantId: "assistant-1",
    contextualLimit: 6
  });

  assert.equal(result.core.length, 1);
  assert.equal(result.core[0]?.id, "core-1");
  assert.equal(result.core[0]?.memoryClass, "core");
  assert.equal(result.core[0]?.kind, "fact");
  assert.deepEqual(harness.coreListCalls, [{ assistantId: "assistant-1", limit: 15 }]);
  assert.deepEqual(
    result.contextual.map((item) => item.id),
    ["ctx-keep-1", "ctx-keep-2"]
  );
  assert.deepEqual(
    result.contextual.map((item) => item.summary),
    ["Loves photography in Tbilisi.", "Prefers walking routes over museum-heavy plans."]
  );
  assert.deepEqual(
    result.contextual.map((item) => item.chatId),
    ["chat-current-1", "chat-past-1"]
  );
  assert.deepEqual(harness.contextualListCalls, [
    {
      assistantId: "assistant-1",
      limit: 6,
      filter: { sourceType: "memory_write" }
    }
  ]);
  assert.equal(harness.bumpedIds.length, 1);
  assert.deepEqual(new Set(harness.bumpedIds[0]), new Set(["core-1", "ctx-keep-1", "ctx-keep-2"]));

  // zero contextual budget skips recent short-memory loading entirely
  const zeroLimitHarness = createHarness({
    coreItems: [coreRow]
  });
  const zeroLimitResult = await zeroLimitHarness.service.execute({
    assistantId: "assistant-1",
    contextualLimit: 0
  });
  assert.equal(zeroLimitResult.contextual.length, 0);
  assert.equal(zeroLimitHarness.contextualListCalls.length, 0);
  assert.equal(zeroLimitHarness.bumpedIds.length, 1);
  assert.deepEqual(zeroLimitHarness.bumpedIds[0], ["core-1"]);

  // ADR-112 Slice 3a — keep the mocked repository contract honest by
  // exposing the supersession method on the same seam Hydrate uses.
  const supersessionHarness = createHarness();
  const superseded = await supersessionHarness.memoryRepository.markSupersededById(
    "memory-old",
    "assistant-1",
    "memory-new"
  );
  assert.equal(superseded, false);
  assert.deepEqual(supersessionHarness.supersedeCalls, [
    {
      id: "memory-old",
      assistantId: "assistant-1",
      supersededByMemoryId: "memory-new"
    }
  ]);
}

void run();
