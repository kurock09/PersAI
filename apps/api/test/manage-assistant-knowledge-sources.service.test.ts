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
  status: "processing" | "ready" | "failed" | "needs_review";
  currentVersion: number;
  chunkCount: number;
  processorProviderKey: string | null;
  processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback" | null;
  processingQuality: Record<string, unknown> | null;
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
  const jobs: Array<{ sourceType: string; sourceId: string; sourceVersion: number }> = [];
  const releasedBytes: bigint[] = [];
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
          currentVersion: data.currentVersion ?? 1,
          chunkCount: 0,
          processorProviderKey: null,
          processorMode: null,
          processingQuality: null,
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
          createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<void>;
        };
        assistantKnowledgeSource: {
          update: (args: { where: { id: string }; data: Partial<SourceRow> }) => Promise<SourceRow>;
          delete: (args: { where: { id: string } }) => Promise<SourceRow>;
        };
        knowledgeVectorChunk: {
          deleteMany: (args: { where: { sourceType: string; sourceId: string } }) => Promise<void>;
        };
        knowledgeIndexingJob: {
          deleteMany: (args: { where: { sourceType: string; sourceId: string } }) => Promise<void>;
        };
      }) => Promise<void>
    ) =>
      callback({
        assistantKnowledgeSourceChunk: {
          deleteMany: async ({ where }) => {
            void where;
          },
          createMany: async () => undefined
        },
        assistantKnowledgeSource: {
          update: async ({ where, data }) =>
            prisma.assistantKnowledgeSource.update({ where, data }),
          delete: async ({ where }) => prisma.assistantKnowledgeSource.delete({ where })
        },
        knowledgeVectorChunk: {
          deleteMany: async () => undefined
        },
        knowledgeIndexingJob: {
          deleteMany: async () => undefined
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
      enqueueSourceJob: async (input: {
        sourceType: string;
        sourceId: string;
        sourceVersion: number;
      }) => {
        jobs.push(input);
      }
    } as never
  );

  return {
    service,
    sources,
    storedObjects,
    deletedObjects,
    releasedBytes,
    jobs
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

  assert.equal(uploaded.status, "processing");
  assert.equal(uploaded.currentVersion, 1);
  assert.equal(uploaded.chunkCount, 0);
  assert.deepEqual(harness.jobs[0], {
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    requestedByUserId: "user-1",
    sourceType: "assistant_knowledge_source",
    sourceId: uploaded.id,
    sourceVersion: 1,
    processorMode: "auto"
  });

  const listed = await harness.service.list("user-1");
  assert.equal(listed.sources.length, 1);
  assert.equal(listed.sources[0]?.id, uploaded.id);
  assert.equal(listed.quota.usedBytes, file.buffer.length);
  assert.equal(listed.quota.limitBytes, 1024);

  const fetched = await harness.service.get("user-1", uploaded.id);
  assert.equal(fetched.displayName, "Product Notes");

  const reindexed = await harness.service.reindex("user-1", uploaded.id);
  assert.equal(reindexed.status, "processing");
  assert.equal(reindexed.currentVersion, 2);
  assert.equal(harness.jobs[1]?.sourceVersion, 2);

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

async function runReindexDoesNotDownloadImmediately(): Promise<void> {
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

  const queued = await harness.service.reindex("user-1", uploaded.id);
  assert.equal(queued.status, "processing");
  assert.equal(queued.lastErrorCode, null);
  assert.ok(queued.lastReindexRequestedAt !== null);
  assert.equal(queued.currentVersion, 2);
}

async function main(): Promise<void> {
  await runUploadListGetAndReindexHappyPath();
  await runUploadRollsBackOnQuotaCap();
  await runUploadCreateFailureRollsBackStorageAndQuota();
  await runReindexDoesNotDownloadImmediately();
}

void main();
