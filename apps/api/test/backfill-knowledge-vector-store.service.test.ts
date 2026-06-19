import assert from "node:assert/strict";
import { BackfillKnowledgeVectorStoreService } from "../src/modules/workspace-management/application/backfill-knowledge-vector-store.service";

type StoreRow = {
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  embeddingModelKey: string;
};

function storeKey(row: StoreRow): string {
  return [
    row.sourceType,
    row.sourceId,
    String(row.sourceVersion),
    String(row.chunkIndex),
    row.embeddingModelKey
  ].join("|");
}

async function run(): Promise<void> {
  const assistantSources = [
    {
      id: "a1",
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      currentVersion: 1,
      status: "ready"
    }
  ];
  const assistantChunks = [
    {
      knowledgeSourceId: "a1",
      sourceVersion: 1,
      chunkIndex: 0,
      locator: "p1",
      content: "alpha",
      embeddingModelKey: "embed-1",
      embeddingVector: [0.1, 0.2]
    },
    {
      knowledgeSourceId: "a1",
      sourceVersion: 1,
      chunkIndex: 1,
      locator: "p2",
      content: "beta",
      embeddingModelKey: "embed-1",
      embeddingVector: [0.3, 0.4]
    }
  ];
  const globalSources = [{ id: "g1", currentVersion: 1, status: "ready" }];
  const globalChunks = [
    {
      globalKnowledgeSourceId: "g1",
      sourceVersion: 1,
      chunkIndex: 0,
      locator: "g-1",
      content: "gamma",
      embeddingModelKey: "embed-1",
      embeddingVector: [0.5, 0.6]
    }
  ];
  // Ready product entry whose chunk has no stored embedding — must be skipped
  // (and its stale vector rows cleared), never mirrored.
  const productSources = [{ id: "p1", currentVersion: 1, status: "ready" }];
  const productChunks = [
    {
      textEntryId: "p1",
      sourceVersion: 1,
      chunkIndex: 0,
      locator: "pk-1",
      content: "delta",
      embeddingModelKey: null,
      embeddingVector: null
    }
  ];

  const store = new Map<string, StoreRow>();
  let deleteSourceCalls = 0;

  const prisma = {
    assistantKnowledgeSource: {
      findMany: async () => assistantSources.filter((source) => source.status === "ready")
    },
    assistantKnowledgeSourceChunk: {
      findMany: async ({
        where
      }: {
        where: { knowledgeSourceId: string; sourceVersion: number };
      }) =>
        assistantChunks.filter(
          (chunk) =>
            chunk.knowledgeSourceId === where.knowledgeSourceId &&
            chunk.sourceVersion === where.sourceVersion
        )
    },
    globalKnowledgeSource: {
      findMany: async () => globalSources.filter((source) => source.status === "ready")
    },
    globalKnowledgeSourceChunk: {
      findMany: async ({
        where
      }: {
        where: { globalKnowledgeSourceId: string; sourceVersion: number };
      }) =>
        globalChunks.filter(
          (chunk) =>
            chunk.globalKnowledgeSourceId === where.globalKnowledgeSourceId &&
            chunk.sourceVersion === where.sourceVersion
        )
    },
    productKnowledgeTextEntry: {
      findMany: async () => productSources.filter((source) => source.status === "ready")
    },
    productKnowledgeTextEntryChunk: {
      findMany: async ({ where }: { where: { textEntryId: string; sourceVersion: number } }) =>
        productChunks.filter(
          (chunk) =>
            chunk.textEntryId === where.textEntryId && chunk.sourceVersion === where.sourceVersion
        )
    }
  };

  const vectorIndex = {
    replaceSourceChunks: async (input: {
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      chunks: Array<{ chunkIndex: number; embeddingModelKey: string }>;
    }) => {
      for (const key of [...store.keys()]) {
        const row = store.get(key);
        if (row && row.sourceType === input.sourceType && row.sourceId === input.sourceId) {
          store.delete(key);
        }
      }
      for (const chunk of input.chunks) {
        const row: StoreRow = {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          chunkIndex: chunk.chunkIndex,
          embeddingModelKey: chunk.embeddingModelKey
        };
        store.set(storeKey(row), row);
      }
    },
    deleteSource: async (input: { sourceType: string; sourceId: string }) => {
      deleteSourceCalls += 1;
      for (const key of [...store.keys()]) {
        const row = store.get(key);
        if (row && row.sourceType === input.sourceType && row.sourceId === input.sourceId) {
          store.delete(key);
        }
      }
    },
    searchNearest: async () => []
  };

  const service = new BackfillKnowledgeVectorStoreService(prisma as never, vectorIndex as never);

  const first = await service.execute();
  assert.equal(first.mirroredSources, 2, "assistant + global sources mirrored");
  assert.equal(first.mirroredChunks, 3, "two assistant chunks + one global chunk mirrored");
  assert.equal(first.clearedSources, 1, "product entry without embeddings cleared");
  assert.equal(first.skippedSourcesWithoutEmbeddings, 1);
  assert.equal(store.size, 3, "store holds exactly the embedded chunks");
  assert.equal(store.has("assistant_knowledge_source|a1|1|0|embed-1"), true);
  assert.equal(store.has("assistant_knowledge_source|a1|1|1|embed-1"), true);
  assert.equal(store.has("global_knowledge_source|g1|1|0|embed-1"), true);
  assert.equal(deleteSourceCalls, 1, "product entry without embeddings triggers a clear");

  // Idempotency: re-running converges to the exact same store with no
  // duplicate rows.
  const second = await service.execute();
  assert.equal(second.mirroredSources, 2);
  assert.equal(second.mirroredChunks, 3);
  assert.equal(store.size, 3, "re-running the backfill does not duplicate rows");
  assert.equal(deleteSourceCalls, 2);
}

void run();
