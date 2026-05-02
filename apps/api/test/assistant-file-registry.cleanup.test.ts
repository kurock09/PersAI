import assert from "node:assert/strict";
import { AssistantFileRegistryService } from "../src/modules/workspace-management/application/assistant-file-registry.service";

const now = new Date("2026-05-02T00:00:00.000Z");

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
      relativePath: "uploads/att-voice/voice-123.webm",
      displayName: "voice-123.webm",
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
      updateMany: async () => ({ count: 1 })
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
    deletedBytes: 30
  });
  assert.deepEqual(deletedObjects, ["objects/voice.webm"]);
  assert.equal(
    rows.some((row) => row.id === "file-cache-1"),
    false
  );
  assert.equal(attachmentMetadata[0]?.fileDeleted, true);
}

void run();
