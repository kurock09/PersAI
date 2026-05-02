import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ManageAdminKnowledgeSourcesService } from "../src/modules/workspace-management/application/manage-admin-knowledge-sources.service";

type SourceRow = {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  scope: "product";
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

function createHarness(options?: { quotaAllowed?: boolean; cappedUpload?: boolean }) {
  const sources = new Map<string, SourceRow>();
  const textEntries = new Map<string, Record<string, unknown>>();
  const deletedObjectKeys: string[] = [];
  const releasedBytes: bigint[] = [];
  const jobs: Array<{ sourceType: string; sourceId: string; sourceVersion: number }> = [];
  let nextId = 1;
  let nextTextEntryId = 1;

  const prisma = {
    globalKnowledgeSource: {
      findMany: async () => [...sources.values()],
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
        const now = new Date();
        const row: SourceRow = {
          id: `global-source-${nextId++}`,
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
      findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
        [...sources.values()].find(
          (row) => row.id === where.id && row.workspaceId === where.workspaceId
        ) ?? null,
      findUniqueOrThrow: async ({
        where,
        select
      }: {
        where: { id: string };
        select?: { workspaceId: true; scope: true };
      }) => {
        const row = sources.get(where.id);
        if (!row) {
          throw new Error("Source not found");
        }
        if (select) {
          return {
            workspaceId: row.workspaceId,
            scope: row.scope
          };
        }
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SourceRow> }) => {
        const row = sources.get(where.id);
        if (!row) {
          throw new Error("Source not found");
        }
        const nextRow = {
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
    productKnowledgeTextEntry: {
      findMany: async () => [...textEntries.values()],
      findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = textEntries.get(where.id);
        return row && row.workspaceId === where.workspaceId ? row : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row = {
          id: `text-entry-${nextTextEntryId++}`,
          ...data,
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
        textEntries.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = textEntries.get(where.id);
        if (!row) {
          throw new Error("Text entry not found");
        }
        const nextRow = { ...row, ...data, updatedAt: new Date() };
        textEntries.set(where.id, nextRow);
        return nextRow;
      }
    },
    $transaction: async <T>(
      callback: (tx: {
        globalKnowledgeSourceChunk: {
          deleteMany: (args: { where: { globalKnowledgeSourceId: string } }) => Promise<void>;
          createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<void>;
        };
        globalKnowledgeSource: {
          update: (args: { where: { id: string }; data: Partial<SourceRow> }) => Promise<SourceRow>;
          delete: (args: { where: { id: string } }) => Promise<SourceRow>;
        };
        knowledgeVectorChunk: {
          deleteMany: (args: { where: { sourceType: string; sourceId: string } }) => Promise<void>;
        };
        knowledgeIndexingJob: {
          create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
          deleteMany: (args: { where: { sourceType: string; sourceId: string } }) => Promise<void>;
        };
        productKnowledgeTextEntry: {
          create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
          update: (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => Promise<Record<string, unknown>>;
        };
        productKnowledgeTextEntryChunk: {
          deleteMany: (args: { where: { textEntryId: string } }) => Promise<void>;
        };
      }) => Promise<T>
    ) =>
      callback({
        globalKnowledgeSourceChunk: {
          deleteMany: async () => undefined,
          createMany: async () => undefined
        },
        globalKnowledgeSource: {
          update: async ({ where, data }) => prisma.globalKnowledgeSource.update({ where, data }),
          delete: async ({ where }) => prisma.globalKnowledgeSource.delete({ where })
        },
        knowledgeVectorChunk: {
          deleteMany: async () => undefined
        },
        knowledgeIndexingJob: {
          create: async ({ data }) => {
            const job = {
              id: `job-${jobs.length + 1}`,
              ...data,
              selectedProviderKey: null,
              fallbackProviderKey: null,
              attemptCount: 0,
              maxAttempts: 3,
              retryAfterAt: null,
              extractionQuality: null,
              resultPayload: null,
              lastErrorCode: null,
              lastErrorMessage: null,
              startedAt: null,
              completedAt: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            jobs.push(job as { sourceType: string; sourceId: string; sourceVersion: number });
            return job;
          },
          deleteMany: async () => undefined
        },
        productKnowledgeTextEntry: {
          create: async ({ data }) => prisma.productKnowledgeTextEntry.create({ data }),
          update: async ({ where, data }) =>
            prisma.productKnowledgeTextEntry.update({ where, data })
        },
        productKnowledgeTextEntryChunk: {
          deleteMany: async () => undefined
        }
      })
  };

  const service = new ManageAdminKnowledgeSourcesService(
    {
      assertCanReadAdminSurface: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["security_admin"],
        hasLegacyOwnerFallback: false,
        hasGlobalPlatformAdminScope: false
      }),
      assertCanWriteGlobalKnowledge: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["security_admin"],
        hasLegacyOwnerFallback: false,
        hasGlobalPlatformAdminScope: false
      })
    } as never,
    prisma as never,
    {
      buildGlobalKnowledgeSourceObjectKey: () => "global/product/mock/source.txt",
      saveObject: async ({
        objectKey,
        buffer,
        mimeType
      }: {
        objectKey: string;
        buffer: Buffer;
        mimeType: string;
      }) => ({
        objectKey,
        sizeBytes: buffer.length,
        mimeType
      }),
      downloadObject: async () => null,
      deleteObject: async (objectKey: string) => {
        deletedObjectKeys.push(objectKey);
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
    } as never,
    {
      checkWorkspaceKnowledgeStorageQuota: async () => ({
        allowed: options?.quotaAllowed ?? true,
        usedBytes: BigInt(0),
        limitBytes: BigInt(1024)
      }),
      recordWorkspaceKnowledgeStorageUpload: async ({ sizeBytes }: { sizeBytes: bigint }) => ({
        appliedDelta: options?.cappedUpload ? BigInt(0) : sizeBytes,
        capped: options?.cappedUpload ?? false,
        state: {
          id: "quota-state",
          workspaceId: "ws-1",
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: null,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: null,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: null,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: sizeBytes,
          knowledgeStorageBytesLimit: BigInt(1024),
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }),
      releaseWorkspaceKnowledgeStorage: async ({ sizeBytes }: { sizeBytes: bigint }) => {
        releasedBytes.push(sizeBytes);
        return {
          releasedDelta: sizeBytes,
          state: {
            id: "quota-state",
            workspaceId: "ws-1",
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(0),
            mediaStorageBytesLimit: null,
            knowledgeStorageBytesUsed: BigInt(0),
            knowledgeStorageBytesLimit: BigInt(1024),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never
  );

  return {
    service,
    sources,
    textEntries,
    deletedObjectKeys,
    releasedBytes,
    jobs
  };
}

async function runUploadAndDeleteHappyPath(): Promise<void> {
  const harness = createHarness();
  const uploaded = await harness.service.upload({
    userId: "admin-1",
    scope: "product",
    displayName: "Product KB",
    file: {
      buffer: Buffer.from("persai product knowledge"),
      mimetype: "text/plain",
      originalname: "product.txt"
    }
  });

  assert.equal(uploaded.status, "processing");
  assert.equal(harness.sources.size, 1);
  assert.deepEqual(harness.jobs[0], {
    workspaceId: "ws-1",
    requestedByUserId: "admin-1",
    sourceType: "global_knowledge_source",
    sourceId: uploaded.id,
    sourceVersion: 1,
    processorMode: "auto"
  });

  await harness.service.delete("admin-1", uploaded.id);
  assert.equal(harness.sources.size, 0);
  assert.deepEqual(harness.releasedBytes, [BigInt(Buffer.from("persai product knowledge").length)]);
}

async function runQuotaFailures(): Promise<void> {
  const blockedHarness = createHarness({ quotaAllowed: false });
  await assert.rejects(
    () =>
      blockedHarness.service.upload({
        userId: "admin-1",
        scope: "product",
        displayName: null,
        file: {
          buffer: Buffer.from("blocked"),
          mimetype: "text/plain",
          originalname: "blocked.txt"
        }
      }),
    ConflictException
  );

  const cappedHarness = createHarness({ cappedUpload: true });
  await assert.rejects(
    () =>
      cappedHarness.service.upload({
        userId: "admin-1",
        scope: "product",
        displayName: "Product KB",
        file: {
          buffer: Buffer.from("product"),
          mimetype: "text/plain",
          originalname: "product.txt"
        }
      }),
    ConflictException
  );
  assert.equal(cappedHarness.sources.size, 0);
  assert.equal(cappedHarness.deletedObjectKeys.length, 1);
}

async function runProductTextEntryLifecycle(): Promise<void> {
  const harness = createHarness();
  const draft = await harness.service.createTextEntry("admin-1", {
    title: "Draft entry",
    body: "Draft product knowledge.",
    category: "support",
    locale: "en",
    tags: ["draft"],
    lifecycleStatus: "draft",
    provenanceKind: "manual",
    provenanceMetadata: null
  });
  assert.equal(draft.entry.lifecycleStatus, "draft");
  assert.equal(draft.indexingJob, null);
  assert.equal(harness.jobs.length, 0);

  const active = await harness.service.updateTextEntry("admin-1", draft.entry.id, {
    title: "Active entry",
    body: "Active product knowledge.",
    category: "support",
    locale: "en",
    tags: ["active"],
    lifecycleStatus: "active",
    provenanceKind: "manual",
    provenanceMetadata: null
  });
  assert.equal(active.entry.lifecycleStatus, "active");
  assert.equal(active.indexingJob?.sourceType, "product_knowledge_text_entry");
  assert.equal(harness.jobs.length, 1);

  await harness.service.archiveTextEntry("admin-1", draft.entry.id);
  assert.equal(harness.textEntries.get(draft.entry.id)?.lifecycleStatus, "archived");
}

void runUploadAndDeleteHappyPath()
  .then(runQuotaFailures)
  .then(runProductTextEntryLifecycle)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
