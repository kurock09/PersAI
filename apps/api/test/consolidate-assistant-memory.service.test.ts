import assert from "node:assert/strict";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import { ConsolidateAssistantMemoryService } from "../src/modules/workspace-management/application/consolidate-assistant-memory.service";
import type { KnowledgeEmbeddingService } from "../src/modules/workspace-management/application/knowledge-embedding.service";
import type { KnowledgeModelPolicyService } from "../src/modules/workspace-management/application/knowledge-model-policy.service";

const CURRENT_MODEL_KEY = "text-embedding-3-small";
const NOW = new Date("2026-06-07T21:00:00.000Z");
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

type MemoryRow = AssistantMemoryRegistryItem;

function buildMemory(overrides: Partial<MemoryRow> & Pick<MemoryRow, "id" | "summary">): MemoryRow {
  const createdAt = new Date("2026-05-20T12:00:00.000Z");
  return {
    id: overrides.id,
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: overrides.summary,
    sourceType: "memory_write",
    sourceLabel: "Memory write: fact",
    memoryClass: "contextual",
    kind: "fact",
    durability: "episodic",
    stability: "stable",
    confidence: 0.5,
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

function createHarness(options?: {
  memories?: MemoryRow[];
  modelKey?: string | null;
  embeddingBatches?: Array<Array<number[] | null>>;
}) {
  const memories = options?.memories ?? [];
  const embedCalls: Array<{ modelKey: string | null; texts: string[] }> = [];
  const updateEmbeddingCalls: Array<{
    id: string;
    assistantId: string;
    embedding: number[];
    modelKey: string;
  }> = [];
  const supersedeCalls: Array<{
    id: string;
    assistantId: string;
    supersededByMemoryId: string | null;
  }> = [];
  const forgottenCalls: Array<{ id: string; assistantId: string }> = [];

  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    | "listActiveForConsolidation"
    | "updateEmbeddingById"
    | "markSupersededById"
    | "markForgottenById"
  > = {
    async listActiveForConsolidation() {
      return memories;
    },
    async updateEmbeddingById(id, assistantId, embedding, modelKey) {
      updateEmbeddingCalls.push({ id, assistantId, embedding, modelKey });
      return true;
    },
    async markSupersededById(id, assistantId, supersededByMemoryId) {
      supersedeCalls.push({ id, assistantId, supersededByMemoryId });
      return true;
    },
    async markForgottenById(id, assistantId) {
      forgottenCalls.push({ id, assistantId });
      return true;
    }
  };

  const knowledgeModelPolicyService: Pick<
    KnowledgeModelPolicyService,
    "resolveAssistantEmbeddingModelKey"
  > = {
    async resolveAssistantEmbeddingModelKey() {
      return options?.modelKey ?? CURRENT_MODEL_KEY;
    }
  };

  const embeddingBatches = [...(options?.embeddingBatches ?? [])];
  const knowledgeEmbeddingService: Pick<KnowledgeEmbeddingService, "generateEmbeddings"> = {
    async generateEmbeddings(input) {
      embedCalls.push(input);
      const nextBatch = embeddingBatches.shift() ?? input.texts.map(() => null);
      return {
        embeddings: nextBatch,
        usage: null
      };
    }
  };

  const realDateNow = Date.now;
  Date.now = () => NOW.getTime();

  return {
    service: new ConsolidateAssistantMemoryService(
      memoryRepository as AssistantMemoryRegistryRepository,
      knowledgeModelPolicyService as KnowledgeModelPolicyService,
      knowledgeEmbeddingService as KnowledgeEmbeddingService
    ),
    memories,
    embedCalls,
    updateEmbeddingCalls,
    supersedeCalls,
    forgottenCalls,
    restore() {
      Date.now = realDateNow;
    }
  };
}

async function runNearDuplicateMerge(): Promise<void> {
  const survivor = buildMemory({
    id: "memory-core",
    summary: "User prefers concise answers.",
    memoryClass: "core",
    confidence: 0.6,
    createdAt: new Date("2026-06-01T00:00:00.000Z")
  });
  const loser = buildMemory({
    id: "memory-contextual",
    summary: "User likes concise answers.",
    memoryClass: "contextual",
    confidence: 0.95,
    createdAt: new Date("2026-06-02T00:00:00.000Z")
  });
  const harness = createHarness({
    memories: [loser, survivor],
    embeddingBatches: [
      [
        [1, 0],
        [0.96, 0.04]
      ]
    ]
  });

  try {
    const outcome = await harness.service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      requestId: "request-1"
    });

    assert.equal(outcome.embedded, 2);
    assert.equal(outcome.mergedSuperseded, 1);
    assert.deepEqual(harness.supersedeCalls, [
      {
        id: "memory-contextual",
        assistantId: "assistant-1",
        supersededByMemoryId: "memory-core"
      }
    ]);
    assert.equal(harness.forgottenCalls.length, 0);
  } finally {
    harness.restore();
  }
}

async function runDistinctMemoriesStayActive(): Promise<void> {
  const first = buildMemory({ id: "memory-a", summary: "User loves photography." });
  const second = buildMemory({ id: "memory-b", summary: "User works in finance." });
  const harness = createHarness({
    memories: [first, second],
    embeddingBatches: [
      [
        [1, 0],
        [0, 1]
      ]
    ]
  });

  try {
    const outcome = await harness.service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    assert.equal(outcome.mergedSuperseded, 0);
    assert.equal(harness.supersedeCalls.length, 0);
  } finally {
    harness.restore();
  }
}

async function runDecayPrunesOnlyEligibleContextualRows(): Promise<void> {
  const oldDate = new Date(NOW.getTime() - SIXTY_DAYS_MS);
  const decayed = buildMemory({
    id: "memory-decayed",
    summary: "User is traveling this month.",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const stable = buildMemory({
    id: "memory-stable",
    summary: "User prefers 3 bullet answers.",
    stability: "stable",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const core = buildMemory({
    id: "memory-core",
    summary: "User's name is Alex.",
    memoryClass: "core",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const identity = buildMemory({
    id: "memory-identity",
    summary: "User is vegetarian for now.",
    durability: "identity",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const harness = createHarness({
    memories: [decayed, stable, core, identity],
    modelKey: null
  });

  try {
    const outcome = await harness.service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    assert.equal(outcome.prunedDecayed, 1);
    assert.deepEqual(harness.forgottenCalls, [
      {
        id: "memory-decayed",
        assistantId: "assistant-1"
      }
    ]);
  } finally {
    harness.restore();
  }
}

async function runGracefulNullEmbeddingsStillPrune(): Promise<void> {
  const oldDate = new Date(NOW.getTime() - SIXTY_DAYS_MS);
  const duplicateA = buildMemory({
    id: "memory-dup-a",
    summary: "User likes jazz.",
    kind: "fact"
  });
  const duplicateB = buildMemory({
    id: "memory-dup-b",
    summary: "User enjoys jazz.",
    kind: "fact"
  });
  const decayed = buildMemory({
    id: "memory-old",
    summary: "Planning a trip this month.",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const harness = createHarness({
    memories: [duplicateA, duplicateB, decayed],
    embeddingBatches: [[null, null, null]]
  });

  try {
    const outcome = await harness.service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    assert.equal(outcome.embedded, 0);
    assert.equal(outcome.mergedSuperseded, 0);
    assert.equal(outcome.prunedDecayed, 1);
    assert.equal(harness.supersedeCalls.length, 0);
    assert.equal(harness.updateEmbeddingCalls.length, 0);
    assert.deepEqual(harness.forgottenCalls, [
      {
        id: "memory-old",
        assistantId: "assistant-1"
      }
    ]);
  } finally {
    harness.restore();
  }
}

async function runUnresolvedOpenLoopsAreProtected(): Promise<void> {
  const oldDate = new Date(NOW.getTime() - SIXTY_DAYS_MS);
  const openLoopA = buildMemory({
    id: "loop-a",
    summary: "Need to pick a venue for the retreat.",
    kind: "open_loop",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const openLoopB = buildMemory({
    id: "loop-b",
    summary: "Need to choose the retreat venue.",
    kind: "open_loop",
    stability: "time_bound",
    lastUsedAt: oldDate,
    createdAt: oldDate
  });
  const harness = createHarness({
    memories: [openLoopA, openLoopB],
    embeddingBatches: [
      [
        [1, 0],
        [0.99, 0.01]
      ]
    ]
  });

  try {
    const outcome = await harness.service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    assert.equal(outcome.mergedSuperseded, 0);
    assert.equal(outcome.prunedDecayed, 0);
    assert.equal(harness.supersedeCalls.length, 0);
    assert.equal(harness.forgottenCalls.length, 0);
  } finally {
    harness.restore();
  }
}

async function run(): Promise<void> {
  await runNearDuplicateMerge();
  await runDistinctMemoriesStayActive();
  await runDecayPrunesOnlyEligibleContextualRows();
  await runGracefulNullEmbeddingsStillPrune();
  await runUnresolvedOpenLoopsAreProtected();
}

void run();
