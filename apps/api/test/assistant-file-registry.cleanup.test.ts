import assert from "node:assert/strict";
import { AssistantFileRegistryService } from "../src/modules/workspace-management/application/assistant-file-registry.service";

const now = new Date("2026-05-02T00:00:00.000Z");
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function createRow(input: {
  id: string;
  origin: "uploaded_attachment" | "runtime_output" | "sandbox_output";
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: bigint;
  metadata: Record<string, unknown> | null;
}) {
  return {
    id: input.id,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    sandboxJobId: null,
    sourceToolCode: null,
    logicalSizeBytes: input.sizeBytes,
    sha256: null,
    createdAt: now,
    updatedAt: now,
    ...input
  };
}

async function run(): Promise<void> {
  const rows = [
    createRow({
      id: "file-user-1",
      origin: "uploaded_attachment",
      objectKey: "objects/report.md",
      relativePath: "uploads/att-user/report.md",
      displayName: "report.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(10),
      metadata: { source: "web_staged_upload" }
    }),
    createRow({
      id: "file-media-1",
      origin: "uploaded_attachment",
      objectKey: "objects/image.png",
      relativePath: "uploads/att-image/image.png",
      displayName: "image.png",
      mimeType: "image/png",
      sizeBytes: BigInt(20),
      metadata: { source: "web_staged_upload" }
    }),
    createRow({
      id: "file-cache-1",
      origin: "uploaded_attachment",
      objectKey: "objects/voice.webm",
      relativePath: "uploads/att-voice/recording.webm",
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(30),
      metadata: { source: "web_staged_upload" }
    }),
    createRow({
      id: "file-created-1",
      origin: "runtime_output",
      objectKey: "objects/result.md",
      relativePath: "artifacts/att-result/result.md",
      displayName: "result.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(40),
      metadata: { source: "tool_output" }
    })
  ];
  const attachmentMetadata: Record<string, unknown>[] = [];
  const deletedObjects: string[] = [];
  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((row) => row.id === where.id);
        assert.notEqual(index, -1);
        const [deleted] = rows.splice(index, 1);
        return deleted;
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [{ id: "att-voice", metadata: { source: "web_staged_upload" } }],
      update: async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
        attachmentMetadata.push(data.metadata);
        return {};
      },
      updateMany: async () => ({ count: 1 }),
      count: async () => 0
    },
    assistantDocumentDeliveredFile: {
      findMany: async () => [],
      findFirst: async () => null
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };
  const service = new AssistantFileRegistryService(
    prisma as never,
    {
      async deleteObject(objectKey: string) {
        deletedObjects.push(objectKey);
      }
    } as never
  );

  const listed = await service.listAssistantFiles({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    limit: 100
  });
  assert.deepEqual(
    listed.map((file) => [file.fileRef, file.fileBucket, file.cleanupEligible]),
    [
      ["file-user-1", "user_files", false],
      ["file-media-1", "media_uploads", false],
      ["file-cache-1", "cache_history", true],
      ["file-created-1", "assistant_created", false]
    ]
  );

  const cleanup = await service.cleanupAssistantFileCache({
    assistantId: "assistant-1",
    workspaceId: "workspace-1"
  });
  assert.deepEqual(cleanup, {
    eligibleCount: 1,
    eligibleBytes: 30,
    deletedCount: 1,
    deletedBytes: 30,
    skippedPinnedCount: 0
  });
  assert.deepEqual(deletedObjects, ["objects/voice.webm"]);
  assert.equal(
    rows.some((row) => row.id === "file-cache-1"),
    false
  );
  assert.equal(attachmentMetadata[0]?.fileDeleted, true);
}

void run();

async function runDerivativeDownloadVisibility(): Promise<void> {
  const rows = [
    createRow({
      id: "file-parent-1",
      origin: "uploaded_attachment",
      objectKey: "objects/parent.png",
      relativePath: "uploads/parent.png",
      displayName: "parent.png",
      mimeType: "image/png",
      sizeBytes: BigInt(100),
      metadata: { source: "web_staged_upload" }
    }),
    createRow({
      id: "file-thumb-1",
      origin: "runtime_output",
      objectKey: "objects/thumb.jpg",
      relativePath: "derivatives/thumb.jpg",
      displayName: "thumb.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(10),
      metadata: {
        schema: "persai.mediaDerivativeFile.v1",
        role: "media_derivative",
        parentFileRef: "file-parent-1",
        derivativeKind: "thumbnail"
      }
    })
  ];
  const service = new AssistantFileRegistryService(
    {
      assistantFile: {
        findMany: async () => rows,
        findFirst: async ({ where }: { where: { id: string } }) =>
          rows.find(
            (row) =>
              row.id === where.id &&
              row.assistantId === "assistant-1" &&
              row.workspaceId === "workspace-1"
          ) ?? null
      },
      assistantDocumentDeliveredFile: {
        findMany: async () => [],
        findFirst: async () => null
      }
    } as never,
    {
      async downloadObject(objectKey: string) {
        assert.equal(objectKey, "objects/thumb.jpg");
        return { buffer: Buffer.from("thumb"), contentType: "application/octet-stream" };
      }
    } as never
  );

  const visibleFiles = await service.listAssistantFiles({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    limit: 20
  });
  assert.deepEqual(
    visibleFiles.map((file) => file.fileRef),
    ["file-parent-1"],
    "derivative rows stay hidden from Files"
  );

  const downloaded = await service.downloadAssistantFile({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    fileRef: "file-thumb-1"
  });
  assert.equal(downloaded.file.fileRef, "file-thumb-1");
  assert.equal(downloaded.file.mimeType, "image/jpeg");
  assert.equal(downloaded.buffer.toString("utf8"), "thumb");
}

void runDerivativeDownloadVisibility();

async function runArchivesDeliveredDocumentDeletion(): Promise<void> {
  const rows = [
    createRow({
      id: "file-document-1",
      origin: "runtime_output",
      objectKey: "objects/document.pdf",
      relativePath: "artifacts/document.pdf",
      displayName: "document.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(50),
      metadata: { source: "tool_output" }
    })
  ];
  let deleteCalls = 0;
  let documentArchiveCalls = 0;
  const attachmentMetadata: Record<string, unknown>[] = [];
  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null,
      delete: async () => {
        deleteCalls += 1;
        throw new Error("delete should not run for delivered document files");
      }
    },
    assistantChatMessageAttachment: {
      findMany: async ({ where }: { where: { assistantFileId?: string | { in: string[] } } }) =>
        typeof where.assistantFileId === "object"
          ? [
              {
                id: "att-document",
                assistantFileId: "file-document-1",
                metadata: { source: "tool_output" }
              }
            ]
          : [],
      update: async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
        attachmentMetadata.push(data.metadata);
        return {};
      },
      updateMany: async () => ({ count: 0 })
    },
    assistantDocumentDeliveredFile: {
      findMany: async ({ select }: { select?: { version?: unknown } }) =>
        select?.version
          ? [
              {
                assistantFileId: "file-document-1",
                docId: "doc-1",
                versionId: "version-1",
                isCurrentOutput: true,
                document: {
                  documentType: "pdf_document",
                  status: "ready"
                },
                version: {
                  versionNumber: 1,
                  descriptorMode: "create_pdf_document",
                  status: "ready"
                }
              }
            ]
          : [{ assistantFileId: "file-document-1" }],
      findFirst: async () => ({
        docId: "doc-1",
        versionId: "version-1",
        isCurrentOutput: true
      })
    },
    assistantDocument: {
      updateMany: async ({ data }: { data: { status: string } }) => {
        assert.equal(data.status, "archived");
        documentArchiveCalls += 1;
        return { count: 1 };
      }
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };
  const service = new AssistantFileRegistryService(
    prisma as never,
    {
      async deleteObject() {
        throw new Error("storage delete should not run for delivered document files");
      }
    } as never
  );

  await service.deleteAssistantFile({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    fileRef: "file-document-1"
  });
  assert.equal(deleteCalls, 0);
  assert.equal(documentArchiveCalls, 1);
  assert.equal(attachmentMetadata[0]?.fileDeleted, true);
  assert.equal(attachmentMetadata[0]?.deletedDocumentId, "doc-1");
  assert.equal(attachmentMetadata[0]?.deletedFileRef, "file-document-1");
}

void runArchivesDeliveredDocumentDeletion();

async function runTtlGating(): Promise<void> {
  const createdRecently = new Date(now.getTime() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000);
  const createdOld = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS - 60 * 1000);

  function makeVoiceRow(id: string, createdAt: Date) {
    return {
      id,
      assistantId: "assistant-ttl",
      workspaceId: "workspace-ttl",
      sandboxJobId: null,
      sourceToolCode: null,
      origin: "uploaded_attachment" as const,
      objectKey: `objects/${id}.webm`,
      relativePath: `uploads/${id}/recording.webm`,
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(100),
      logicalSizeBytes: BigInt(100),
      sha256: null,
      metadata: { source: "web_staged_upload" },
      createdAt,
      updatedAt: createdAt
    };
  }

  const rows = [
    makeVoiceRow("voice-fresh", createdRecently),
    makeVoiceRow("voice-old", createdOld)
  ];
  const deletedIds: string[] = [];
  const countResults: Record<string, number> = { "voice-fresh": 0, "voice-old": 0 };

  const prisma = {
    assistantFile: {
      findMany: async () => rows,
      findFirst: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        assert.notEqual(idx, -1, `Expected row ${where.id} to exist`);
        const [deleted] = rows.splice(idx, 1);
        deletedIds.push(where.id);
        return deleted;
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      count: async ({ where }: { where: { assistantFileId: string } }) =>
        countResults[where.assistantFileId] ?? 0
    },
    assistantDocumentDeliveredFile: {
      findMany: async () => [],
      findFirst: async () => null
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops)
  };

  const service = new AssistantFileRegistryService(
    prisma as never,
    { async deleteObject() {} } as never
  );

  const result = await service.cleanupAssistantFileCache(
    { assistantId: "assistant-ttl", workspaceId: "workspace-ttl" },
    now
  );

  assert.equal(result.eligibleCount, 1, "only the old file should be eligible");
  assert.equal(result.deletedCount, 1, "only the old file should be deleted");
  assert.deepEqual(deletedIds, ["voice-old"], "fresh file must not be deleted");
  assert.equal(result.skippedPinnedCount, 0);
}

void runTtlGating();

async function runPinningProtection(): Promise<void> {
  const createdOld = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS - 60 * 1000);

  const rows = [
    {
      id: "voice-pinned",
      assistantId: "assistant-pin",
      workspaceId: "workspace-pin",
      sandboxJobId: null,
      sourceToolCode: null,
      origin: "uploaded_attachment" as const,
      objectKey: "objects/pinned.webm",
      relativePath: "uploads/pinned/recording.webm",
      displayName: "recording.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(50),
      logicalSizeBytes: BigInt(50),
      sha256: null,
      metadata: { source: "web_staged_upload" },
      createdAt: createdOld,
      updatedAt: createdOld
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
        const idx = rows.findIndex((r) => r.id === where.id);
        const [d] = rows.splice(idx, 1);
        return d;
      }
    },
    assistantChatMessageAttachment: {
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      count: async ({ where }: { where: { assistantFileId: string } }) =>
        where.assistantFileId === "voice-pinned" ? 1 : 0
    },
    assistantDocumentDeliveredFile: {
      findMany: async () => [],
      findFirst: async () => null
    },
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
    { assistantId: "assistant-pin", workspaceId: "workspace-pin" },
    now
  );

  assert.equal(result.deletedCount, 0, "pinned file must not be deleted");
  assert.equal(result.skippedPinnedCount, 1, "pinned file should be counted as skipped");
  assert.deepEqual(deletedIds, [], "no DB deletion should occur");
  assert.deepEqual(deletedObjects, [], "no storage deletion should occur");
}

void runPinningProtection();
