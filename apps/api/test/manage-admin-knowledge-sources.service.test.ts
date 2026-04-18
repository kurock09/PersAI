import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ManageAdminKnowledgeSourcesService } from "../src/modules/workspace-management/application/manage-admin-knowledge-sources.service";

type SourceRow = {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  scope: "product" | "skill";
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

function createHarness(options?: { quotaAllowed?: boolean; cappedUpload?: boolean }) {
  const sources = new Map<string, SourceRow>();
  const deletedObjectKeys: string[] = [];
  const releasedBytes: bigint[] = [];
  let nextId = 1;

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
    $transaction: async (
      callback: (tx: {
        globalKnowledgeSourceChunk: {
          deleteMany: (args: { where: { globalKnowledgeSourceId: string } }) => Promise<void>;
          createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<void>;
        };
        globalKnowledgeSource: {
          update: (args: { where: { id: string }; data: Partial<SourceRow> }) => Promise<SourceRow>;
        };
      }) => Promise<void>
    ) =>
      callback({
        globalKnowledgeSourceChunk: {
          deleteMany: async () => undefined,
          createMany: async () => undefined
        },
        globalKnowledgeSource: {
          update: async ({ where, data }) => prisma.globalKnowledgeSource.update({ where, data })
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
      buildIndexedChunks: async () => [
        {
          chunkIndex: 0,
          locator: "p1",
          content: "PersAI global knowledge chunk",
          embeddingModelKey: null,
          embeddingVector: null,
          embeddingGeneratedAt: null
        }
      ]
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
    deletedObjectKeys,
    releasedBytes
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

  assert.equal(uploaded.status, "ready");
  assert.equal(harness.sources.size, 1);

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
        scope: "skill",
        displayName: "Skill KB",
        file: {
          buffer: Buffer.from("skill"),
          mimetype: "text/plain",
          originalname: "skill.txt"
        }
      }),
    ConflictException
  );
  assert.equal(cappedHarness.sources.size, 0);
  assert.equal(cappedHarness.deletedObjectKeys.length, 1);
}

void runUploadAndDeleteHappyPath()
  .then(runQuotaFailures)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
