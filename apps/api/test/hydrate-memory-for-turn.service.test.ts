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

function createHarness(options?: { coreItems?: MemoryRow[] }) {
  const bumpedIds: string[][] = [];
  const coreListCalls: Array<{ assistantId: string; limit: number }> = [];
  const supersedeCalls: Array<{
    id: string;
    assistantId: string;
    supersededByMemoryId: string | null;
  }> = [];
  const coreItems = options?.coreItems ?? [];
  // ADR-120 Slice 1 — the contextual hydration leg was retired end to end, so
  // the service depends ONLY on the core listing + last-used bump (no
  // `listRecentActiveContextualByAssistantId`).
  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "listActiveCoreByAssistantId" | "bumpLastUsedAt" | "markSupersededById"
  > = {
    async listActiveCoreByAssistantId(assistantId, limit) {
      coreListCalls.push({ assistantId, limit });
      return coreItems;
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
    memoryRepository,
    supersedeCalls
  };
}

async function run(): Promise<void> {
  // parseInput: rejects missing assistantId
  const validate = createHarness();
  assert.throws(
    () => validate.service.parseInput({}),
    (error) => error instanceof BadRequestException
  );
  // parseInput: trims assistantId and ignores any extra fields (the retired
  // contextualLimit param is no longer accepted or required).
  const parsed = validate.service.parseInput({
    assistantId: "  assistant-1  ",
    contextualLimit: 4
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.deepEqual(Object.keys(parsed), ["assistantId"]);

  // execute: returns core items only and bumps last_used_at for the returned core ids.
  const coreRow = buildMemoryRow({
    id: "core-1",
    summary: "User's name is Alex.",
    memoryClass: "core",
    kind: "fact",
    sourceLabel: "Long memory write: fact"
  });
  const coreRow2 = buildMemoryRow({
    id: "core-2",
    summary: "Alex prefers concise answers.",
    memoryClass: "core",
    kind: "preference",
    sourceLabel: "Long memory write: preference",
    createdAt: new Date("2026-04-20T12:00:01.000Z")
  });
  const harness = createHarness({
    coreItems: [coreRow, coreRow2]
  });
  const result = await harness.service.execute({
    assistantId: "assistant-1"
  });

  assert.deepEqual(
    result.core.map((item) => item.id),
    ["core-1", "core-2"]
  );
  assert.equal(result.core[0]?.memoryClass, "core");
  assert.equal(result.core[0]?.kind, "fact");
  // The result no longer carries a contextual leg.
  assert.equal(
    Object.prototype.hasOwnProperty.call(result, "contextual"),
    false,
    "ADR-120 Slice 1: hydration result must not expose a contextual leg"
  );
  assert.deepEqual(harness.coreListCalls, [{ assistantId: "assistant-1", limit: 15 }]);
  assert.equal(harness.bumpedIds.length, 1);
  assert.deepEqual(new Set(harness.bumpedIds[0]), new Set(["core-1", "core-2"]));

  // empty core set → no bump call at all
  const emptyHarness = createHarness({ coreItems: [] });
  const emptyResult = await emptyHarness.service.execute({ assistantId: "assistant-1" });
  assert.equal(emptyResult.core.length, 0);
  assert.equal(emptyHarness.bumpedIds.length, 0);

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
