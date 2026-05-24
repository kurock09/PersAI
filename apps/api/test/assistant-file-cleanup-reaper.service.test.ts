import assert from "node:assert/strict";
import { AssistantFileCleanupReaperService } from "../src/modules/workspace-management/application/assistant-file-cleanup-reaper.service";
import { AssistantFileRegistryService } from "../src/modules/workspace-management/application/assistant-file-registry.service";

function buildReaper(overrides: {
  eligibleRows?: Array<{ assistantId: string; workspaceId: string }>;
  cleanupResults?: Record<
    string,
    {
      eligibleCount: number;
      eligibleBytes: number;
      deletedCount: number;
      deletedBytes: number;
      skippedPinnedCount: number;
    }
  >;
  acquireResult?: { token: string } | null;
  leaseLostOnHeartbeat?: boolean;
}): {
  reaper: AssistantFileCleanupReaperService;
  cleanupCalls: Array<{ assistantId: string; workspaceId: string }>;
  loggedWarnings: string[];
} {
  const cleanupCalls: Array<{ assistantId: string; workspaceId: string }> = [];
  const loggedWarnings: string[] = [];

  const prisma = {
    $queryRaw: async () => overrides.eligibleRows ?? []
  };

  const schedulerLeaseService = {
    getLeaseState: async () => null,
    acquire: async () =>
      overrides.acquireResult !== undefined ? overrides.acquireResult : { token: "test-token" },
    heartbeat: async () => !overrides.leaseLostOnHeartbeat,
    release: async () => {}
  };

  const backgroundSchedulerMetricsService = {
    recordTickSkipped: () => {},
    recordTickAcquired: () => {},
    recordLeaseLost: () => {},
    recordLeaseExpiredRecovered: () => {}
  };

  const assistantFileRegistryService = {
    cleanupAssistantFileCache: async (input: { assistantId: string; workspaceId: string }) => {
      cleanupCalls.push({ assistantId: input.assistantId, workspaceId: input.workspaceId });
      const key = input.assistantId;
      const result = overrides.cleanupResults?.[key] ?? {
        eligibleCount: 1,
        eligibleBytes: 100,
        deletedCount: 1,
        deletedBytes: 100,
        skippedPinnedCount: 0
      };
      return result;
    }
  };

  const reaper = new AssistantFileCleanupReaperService(
    prisma as never,
    schedulerLeaseService as never,
    backgroundSchedulerMetricsService as never,
    assistantFileRegistryService as never
  );

  // Patch logger to capture warnings
  (reaper as unknown as { logger: { warn: (msg: string) => void } }).logger.warn = (
    msg: string
  ) => {
    loggedWarnings.push(msg);
  };

  return { reaper, cleanupCalls, loggedWarnings };
}

async function runTickOnce(reaper: AssistantFileCleanupReaperService): Promise<void> {
  await (reaper as unknown as { tick(): Promise<void> }).tick();
}

async function runEmptyPath(): Promise<void> {
  const { reaper, cleanupCalls } = buildReaper({ eligibleRows: [] });

  await runTickOnce(reaper);

  assert.equal(cleanupCalls.length, 0, "no cleanup calls when no eligible files exist");
}

void runEmptyPath();

async function runMultipleAssistants(): Promise<void> {
  const eligibleRows = [
    { assistantId: "assistant-1", workspaceId: "workspace-1" },
    { assistantId: "assistant-2", workspaceId: "workspace-1" },
    { assistantId: "assistant-3", workspaceId: "workspace-2" }
  ];
  const { reaper, cleanupCalls } = buildReaper({ eligibleRows });

  await runTickOnce(reaper);

  assert.equal(cleanupCalls.length, 3, "reaper processes all eligible assistants in one tick");
  assert.deepEqual(cleanupCalls.map((c) => c.assistantId).sort(), [
    "assistant-1",
    "assistant-2",
    "assistant-3"
  ]);
}

void runMultipleAssistants();

async function runLeaseNotAcquired(): Promise<void> {
  const eligibleRows = [{ assistantId: "assistant-1", workspaceId: "workspace-1" }];
  const { reaper, cleanupCalls } = buildReaper({
    eligibleRows,
    acquireResult: null
  });

  await runTickOnce(reaper);

  assert.equal(cleanupCalls.length, 0, "no cleanup called when lease cannot be acquired");
}

void runLeaseNotAcquired();

async function runPerAssistantErrorTolerance(): Promise<void> {
  const eligibleRows = [
    { assistantId: "assistant-ok", workspaceId: "workspace-1" },
    { assistantId: "assistant-err", workspaceId: "workspace-1" },
    { assistantId: "assistant-ok2", workspaceId: "workspace-1" }
  ];

  const cleanupCalls: string[] = [];
  const prisma = { $queryRaw: async () => eligibleRows };
  const schedulerLeaseService = {
    getLeaseState: async () => null,
    acquire: async () => ({ token: "token" }),
    heartbeat: async () => true,
    release: async () => {}
  };
  const backgroundSchedulerMetricsService = {
    recordTickSkipped: () => {},
    recordTickAcquired: () => {},
    recordLeaseLost: () => {},
    recordLeaseExpiredRecovered: () => {}
  };
  const assistantFileRegistryService = {
    cleanupAssistantFileCache: async (input: { assistantId: string }) => {
      cleanupCalls.push(input.assistantId);
      if (input.assistantId === "assistant-err") {
        throw new Error("simulated error");
      }
      return {
        eligibleCount: 1,
        eligibleBytes: 100,
        deletedCount: 1,
        deletedBytes: 100,
        skippedPinnedCount: 0
      };
    }
  };

  const reaper = new AssistantFileCleanupReaperService(
    prisma as never,
    schedulerLeaseService as never,
    backgroundSchedulerMetricsService as never,
    assistantFileRegistryService as never
  );

  // Should not throw
  await (reaper as unknown as { tick(): Promise<void> }).tick();

  assert.deepEqual(
    cleanupCalls.sort(),
    ["assistant-err", "assistant-ok", "assistant-ok2"].sort(),
    "all assistants attempted even when one throws"
  );
}

void runPerAssistantErrorTolerance();

// TTL boundary: these test the registry service directly to verify TTL semantics
async function runTtlBoundaryNotEligibleBelow24h(): Promise<void> {
  const now = new Date("2026-05-24T12:00:00.000Z");
  const createdAt = new Date(now.getTime() - (23 * 60 + 59) * 60 * 1000); // 23h59m ago

  const rows = [
    {
      id: "voice-fresh",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      sourceToolCode: null,
      origin: "uploaded_attachment" as const,
      objectKey: "objects/voice-fresh.webm",
      relativePath: "uploads/voice-fresh/recording.webm",
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(100),
      logicalSizeBytes: BigInt(100),
      sha256: null,
      metadata: { source: "web_staged_upload" },
      createdAt,
      updatedAt: createdAt
    }
  ];
  const deletedIds: string[] = [];
  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        deletedIds.push(where.id);
        return rows[0];
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      count: async () => 0
    },
    assistantDocumentDeliveredFile: { findMany: async () => [], findFirst: async () => null },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };

  const service = new AssistantFileRegistryService(
    prisma as never,
    { async deleteObject() {} } as never
  );
  const result = await service.cleanupAssistantFileCache(
    { assistantId: "assistant-1", workspaceId: "workspace-1" },
    now
  );

  assert.equal(result.eligibleCount, 0, "file created 23h59m ago is NOT yet eligible");
  assert.equal(result.deletedCount, 0, "file created 23h59m ago must not be deleted");
  assert.deepEqual(deletedIds, []);
}

void runTtlBoundaryNotEligibleBelow24h();

async function runTtlBoundaryEligibleAfter24h(): Promise<void> {
  const now = new Date("2026-05-24T12:00:00.000Z");
  const createdAt = new Date(now.getTime() - (24 * 60 + 1) * 60 * 1000); // 24h01m ago

  const rows = [
    {
      id: "voice-old",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      sourceToolCode: null,
      origin: "uploaded_attachment" as const,
      objectKey: "objects/voice-old.webm",
      relativePath: "uploads/voice-old/recording.webm",
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(100),
      logicalSizeBytes: BigInt(100),
      sha256: null,
      metadata: { source: "web_staged_upload" },
      createdAt,
      updatedAt: createdAt
    }
  ];
  const deletedIds: string[] = [];
  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        const [d] = rows.splice(idx, 1);
        deletedIds.push(where.id);
        return d;
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      count: async () => 0
    },
    assistantDocumentDeliveredFile: { findMany: async () => [], findFirst: async () => null },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };

  const service = new AssistantFileRegistryService(
    prisma as never,
    { async deleteObject() {} } as never
  );
  const result = await service.cleanupAssistantFileCache(
    { assistantId: "assistant-1", workspaceId: "workspace-1" },
    now
  );

  assert.equal(result.eligibleCount, 1, "file created 24h01m ago IS eligible");
  assert.equal(result.deletedCount, 1, "file created 24h01m ago must be deleted");
  assert.deepEqual(deletedIds, ["voice-old"]);
}

void runTtlBoundaryEligibleAfter24h();

async function runPinningProtectionInReaper(): Promise<void> {
  const now = new Date("2026-05-24T12:00:00.000Z");
  const createdAt = new Date(now.getTime() - (24 * 60 + 1) * 60 * 1000);

  const rows = [
    {
      id: "voice-pinned",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      sourceToolCode: null,
      origin: "uploaded_attachment" as const,
      objectKey: "objects/pinned.webm",
      relativePath: "uploads/pinned/recording.webm",
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(200),
      logicalSizeBytes: BigInt(200),
      sha256: null,
      metadata: { source: "web_staged_upload" },
      createdAt,
      updatedAt: createdAt
    }
  ];
  const deletedIds: string[] = [];
  const deletedObjects: string[] = [];

  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        deletedIds.push(where.id);
        return rows[0];
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      count: async ({ where }: { where: { assistantFileId: string } }) =>
        where.assistantFileId === "voice-pinned" ? 2 : 0
    },
    assistantDocumentDeliveredFile: { findMany: async () => [], findFirst: async () => null },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };

  const service = new AssistantFileRegistryService(
    prisma as never,
    {
      async deleteObject(key: string) {
        deletedObjects.push(key);
      }
    } as never
  );

  const result = await service.cleanupAssistantFileCache(
    { assistantId: "assistant-1", workspaceId: "workspace-1" },
    now
  );

  assert.equal(result.deletedCount, 0, "pinned file must not be deleted");
  assert.equal(result.skippedPinnedCount, 1, "pinned file must be counted as skipped");
  assert.deepEqual(deletedIds, [], "no DB row deleted for pinned file");
  assert.deepEqual(deletedObjects, [], "no storage object deleted for pinned file");
}

void runPinningProtectionInReaper();
