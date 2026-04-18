import assert from "node:assert/strict";
import { ManageAssistantKnowledgeSourcesService } from "../src/modules/workspace-management/application/manage-assistant-knowledge-sources.service";

type SourceRow = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  namespace: "assistant_user_workspace";
  sourceKind: "uploaded_file";
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  storagePath: string;
  status: "processing" | "ready" | "failed";
  currentVersion: number;
  chunkCount: number;
  lastIndexedAt: Date | null;
  lastReindexRequestedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createHarness(options?: { cappedUpload?: boolean; failCreate?: boolean }) {
  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1"
  };
  const sources = new Map<string, SourceRow>();
  const storedObjects = new Map<string, Buffer>();
  const deletedObjects: string[] = [];
  const createdChunks: Array<{ knowledgeSourceId: string; content: string }> = [];
  const releasedBytes: bigint[] = [];
  const processCalls: Array<{
    mimeType: string;
    originalFilename: string;
    embeddingModelKey: string | null;
  }> = [];
  let quotaUsed = BigInt(0);
  let nextSourceId = 1;

  const prisma = {
    assistantKnowledgeSource: {
      create: async ({
        data
      }: {
        data: Omit<
          SourceRow,
          | "id"
          | "currentVersion"
          | "chunkCount"
          | "lastIndexedAt"
          | "lastReindexRequestedAt"
          | "lastErrorCode"
          | "lastErrorMessage"
          | "createdAt"
          | "updatedAt"
        >;
      }) => {
        if (options?.failCreate) {
          throw new Error("create failed");
        }
        const now = new Date();
        const row: SourceRow = {
          id: `source-${nextSourceId++}`,
          ...data,
          currentVersion: 0,
          chunkCount: 0,
          lastIndexedAt: null,
          lastReindexRequestedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          createdAt: now,
          updatedAt: now
        };
        sources.set(row.id, row);
        return row;
      },
      findMany: async ({ where }: { where: { assistantId: string } }) =>
        [...sources.values()]
          .filter((row) => row.assistantId === where.assistantId)
          .sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
          ),
      findFirst: async ({ where }: { where: { id: string; assistantId: string } }) =>
        [...sources.values()].find(
          (row) => row.id === where.id && row.assistantId === where.assistantId
        ) ?? null,
      findUniqueOrThrow: async ({
        where,
        select
      }: {
        where: { id: string };
        select?: { assistantId: true; workspaceId: true };
      }) => {
        const row = sources.get(where.id);
        if (!row) {
          throw new Error("Source not found");
        }
        if (select) {
          return {
            assistantId: row.assistantId,
            workspaceId: row.workspaceId
          };
        }
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SourceRow> }) => {
        const row = sources.get(where.id);
        if (!row) {
          throw new Error("Source not found");
        }
        const nextRow: SourceRow = {
          ...row,
          ...data,
          updatedAt: new Date()
        };
        sources.set(where.id, nextRow);
        return nextRow;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = sources.get(where.id);
        if (!row) {
          throw new Error("Source not found");
        }
        sources.delete(where.id);
        return row;
      }
    },
    $transaction: async (
      callback: (tx: {
        assistantKnowledgeSourceChunk: {
          deleteMany: (args: { where: { knowledgeSourceId: string } }) => Promise<void>;
          createMany: (args: {
            data: Array<{
              knowledgeSourceId: string;
              assistantId: string;
              workspaceId: string;
              sourceVersion: number;
              chunkIndex: number;
              locator: string | null;
              content: string;
              embeddingModelKey: string | null;
              embeddingVector: unknown;
              embeddingGeneratedAt: Date | null;
            }>;
          }) => Promise<void>;
        };
        assistantKnowledgeSource: {
          update: (args: { where: { id: string }; data: Partial<SourceRow> }) => Promise<SourceRow>;
        };
      }) => Promise<void>
    ) =>
      callback({
        assistantKnowledgeSourceChunk: {
          deleteMany: async ({ where }) => {
            for (let idx = createdChunks.length - 1; idx >= 0; idx -= 1) {
              if (createdChunks[idx]?.knowledgeSourceId === where.knowledgeSourceId) {
                createdChunks.splice(idx, 1);
              }
            }
          },
          createMany: async ({ data }) => {
            createdChunks.push(
              ...data.map((item) => ({
                knowledgeSourceId: item.knowledgeSourceId,
                content: item.content
              }))
            );
          }
        },
        assistantKnowledgeSource: {
          update: async ({ where, data }) => prisma.assistantKnowledgeSource.update({ where, data })
        }
      })
  };

  const service = new ManageAssistantKnowledgeSourcesService(
    {
      findByUserId: async (userId: string) => (userId === "user-1" ? assistant : null)
    } as never,
    prisma as never,
    {
      buildKnowledgeSourceObjectKey: ({
        assistantId,
        originalFilename
      }: {
        assistantId: string;
        extension: string | null;
        originalFilename: string | null;
      }) =>
        `assistant-knowledge/assistants/${assistantId}/sources/mock/${originalFilename ?? "source.txt"}`,
      saveObject: async ({
        objectKey,
        buffer,
        mimeType
      }: {
        objectKey: string;
        buffer: Buffer;
        mimeType: string;
      }) => {
        storedObjects.set(objectKey, buffer);
        return {
          objectKey,
          sizeBytes: buffer.length,
          mimeType
        };
      },
      downloadObject: async (objectKey: string) => {
        const buffer = storedObjects.get(objectKey);
        return buffer
          ? {
              buffer,
              contentType: "text/plain"
            }
          : null;
      },
      deleteObject: async (objectKey: string) => {
        deletedObjects.push(objectKey);
        storedObjects.delete(objectKey);
      }
    } as never,
    {
      checkKnowledgeStorageQuota: async () => ({
        allowed: true,
        usedBytes: quotaUsed,
        limitBytes: BigInt(1024)
      }),
      recordKnowledgeStorageUpload: async ({ sizeBytes }: { sizeBytes: bigint }) => {
        if (options?.cappedUpload) {
          quotaUsed += BigInt(3);
          return {
            appliedDelta: BigInt(3),
            capped: true,
            state: {
              knowledgeStorageBytesUsed: quotaUsed,
              knowledgeStorageBytesLimit: BigInt(3)
            }
          };
        }
        quotaUsed += sizeBytes;
        return {
          appliedDelta: sizeBytes,
          capped: false,
          state: {
            knowledgeStorageBytesUsed: quotaUsed,
            knowledgeStorageBytesLimit: BigInt(1024)
          }
        };
      },
      releaseKnowledgeStorage: async ({ sizeBytes }: { sizeBytes: bigint }) => {
        releasedBytes.push(sizeBytes);
        quotaUsed -= sizeBytes;
        return {
          releasedDelta: sizeBytes,
          state: {
            knowledgeStorageBytesUsed: quotaUsed,
            knowledgeStorageBytesLimit: BigInt(3)
          }
        };
      }
    } as never,
    {
      buildIndexedChunks: async ({
        mimeType,
        originalFilename,
        embeddingModelKey
      }: {
        buffer: Buffer;
        mimeType: string;
        originalFilename: string;
        embeddingModelKey: string | null;
      }) => {
        processCalls.push({ mimeType, originalFilename, embeddingModelKey });
        return [
          {
            chunkIndex: 0,
            locator: null,
            content: "PersAI knowledge sources keep durable workspace facts searchable.",
            embeddingModelKey,
            embeddingVector: null,
            embeddingGeneratedAt: null
          }
        ];
      }
    } as never,
    {
      resolveAssistantEmbeddingModelKey: async () => "text-embedding-3-small"
    } as never
  );

  return {
    service,
    sources,
    storedObjects,
    deletedObjects,
    createdChunks,
    releasedBytes,
    processCalls
  };
}

async function runUploadListGetAndReindexHappyPath(): Promise<void> {
  const harness = createHarness();
  const file = {
    buffer: Buffer.from("persai knowledge document"),
    mimetype: "text/plain",
    originalname: "notes.txt"
  };

  const uploaded = await harness.service.upload({
    userId: "user-1",
    displayName: "Product Notes",
    file
  });

  assert.equal(uploaded.status, "ready");
  assert.equal(uploaded.currentVersion, 1);
  assert.ok(uploaded.chunkCount >= 1);
  assert.equal(harness.createdChunks.length, uploaded.chunkCount);
  assert.equal(harness.processCalls[0]?.embeddingModelKey, "text-embedding-3-small");

  const listed = await harness.service.list("user-1");
  assert.equal(listed.sources.length, 1);
  assert.equal(listed.sources[0]?.id, uploaded.id);
  assert.equal(listed.quota.usedBytes, file.buffer.length);
  assert.equal(listed.quota.limitBytes, 1024);

  const fetched = await harness.service.get("user-1", uploaded.id);
  assert.equal(fetched.displayName, "Product Notes");

  const reindexed = await harness.service.reindex("user-1", uploaded.id);
  assert.equal(reindexed.status, "ready");
  assert.equal(reindexed.currentVersion, 2);
  assert.equal(harness.processCalls[1]?.embeddingModelKey, "text-embedding-3-small");

  await harness.service.delete("user-1", uploaded.id);
  assert.equal(harness.sources.size, 0);
  assert.equal(harness.deletedObjects.length, 1);
  assert.deepEqual(harness.releasedBytes, [BigInt(file.buffer.length)]);
}

async function runUploadRollsBackOnQuotaCap(): Promise<void> {
  const harness = createHarness({ cappedUpload: true });

  await assert.rejects(
    harness.service.upload({
      userId: "user-1",
      displayName: null,
      file: {
        buffer: Buffer.from("persai knowledge document"),
        mimetype: "text/plain",
        originalname: "notes.txt"
      }
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 409 &&
      "errorObject" in error &&
      typeof (error as { errorObject?: { code?: string } }).errorObject?.code === "string" &&
      (error as { errorObject: { code: string } }).errorObject.code ===
        "knowledge_storage_quota_exceeded"
  );

  assert.equal(harness.sources.size, 0);
  assert.equal(harness.deletedObjects.length, 1);
  assert.deepEqual(harness.releasedBytes, [BigInt(3)]);
}

async function runUploadCreateFailureRollsBackStorageAndQuota(): Promise<void> {
  const harness = createHarness({ failCreate: true });
  const sizeBytes = Buffer.byteLength("persai knowledge document");

  await assert.rejects(
    harness.service.upload({
      userId: "user-1",
      displayName: null,
      file: {
        buffer: Buffer.from("persai knowledge document"),
        mimetype: "text/plain",
        originalname: "notes.txt"
      }
    }),
    /create failed/
  );

  assert.equal(harness.sources.size, 0);
  assert.equal(harness.deletedObjects.length, 1);
  assert.deepEqual(harness.releasedBytes, [BigInt(sizeBytes)]);
}

async function runReindexMissingObjectMarksSourceFailed(): Promise<void> {
  const harness = createHarness();
  const uploaded = await harness.service.upload({
    userId: "user-1",
    displayName: "Missing File",
    file: {
      buffer: Buffer.from("persai knowledge document"),
      mimetype: "text/plain",
      originalname: "missing.txt"
    }
  });

  const row = harness.sources.get(uploaded.id);
  assert.ok(row);
  if (!row) {
    throw new Error("Expected source row to exist.");
  }
  harness.storedObjects.delete(row.storagePath);

  const failed = await harness.service.reindex("user-1", uploaded.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastErrorCode, "stored_file_missing");
  assert.ok(failed.lastReindexRequestedAt !== null);
  assert.equal(failed.currentVersion, 1);
}

async function main(): Promise<void> {
  await runUploadListGetAndReindexHappyPath();
  await runUploadRollsBackOnQuotaCap();
  await runUploadCreateFailureRollsBackStorageAndQuota();
  await runReindexMissingObjectMarksSourceFailed();
}

void main();
