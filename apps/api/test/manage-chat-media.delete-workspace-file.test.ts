import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ManageChatMediaService } from "../src/modules/workspace-management/application/manage-chat-media.service";

const assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1"
};

function createService(input?: {
  attachments?: Array<{
    thumbnailStoragePath: string | null;
    posterStoragePath: string | null;
  }>;
  manifestExists?: boolean;
  objectExists?: boolean;
  manifestDeleteError?: Error;
  removeHotPodsError?: Error;
}) {
  const deletedObjectKeys: string[] = [];
  const manifestDeletes: Array<{ workspaceId: string; path: string }> = [];
  const hotPodRemovals: Array<{ workspaceId: string; path: string }> = [];
  const attachmentUpdates: Array<Record<string, unknown>> = [];

  const service = new ManageChatMediaService(
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return { assistantId: assistant.id, assistant } as never;
      }
    } as never,
    {
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          surface: "web"
        };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      buildSharedObjectKey({
        workspaceRelPath
      }: {
        workspaceId: string;
        workspaceRelPath: string;
      }) {
        return `gcs:${workspaceRelPath}`;
      },
      async deleteObject(objectKey: string) {
        deletedObjectKeys.push(objectKey);
      },
      async existsObject() {
        return input?.objectExists ?? false;
      }
    } as never,
    {} as never,
    {} as never,
    {
      async get({ workspaceId, path }: { workspaceId: string; path: string }) {
        if (input?.manifestExists === false) {
          return null;
        }
        return {
          workspaceId,
          path,
          mimeType: "text/plain",
          sizeBytes: BigInt(4),
          contentHash: null,
          shortDescription: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      },
      async delete(row: { workspaceId: string; path: string }) {
        manifestDeletes.push(row);
        if (input?.manifestDeleteError) {
          throw input.manifestDeleteError;
        }
      }
    } as never,
    {} as never,
    {} as never,
    {
      async removeSharedFileFromHotPods(row: { workspaceId: string; path: string }) {
        hotPodRemovals.push(row);
        if (input?.removeHotPodsError) {
          throw input.removeHotPodsError;
        }
        return { removedFromPods: 1, failures: [] };
      }
    } as never,
    {
      assistantChatMessageAttachment: {
        async findMany() {
          return (
            input?.attachments ?? [
              {
                thumbnailStoragePath: "/shared/input/report-thumb.png",
                posterStoragePath: "/shared/input/report-poster.png"
              }
            ]
          );
        },
        async updateMany(row: Record<string, unknown>) {
          attachmentUpdates.push(row);
          return { count: 1 };
        }
      }
    } as never
  );

  return {
    service,
    deletedObjectKeys,
    manifestDeletes,
    hotPodRemovals,
    attachmentUpdates
  };
}

test("deleteChatWorkspaceFile removes manifest row and best-effort hot pod copy", async () => {
  const harness = createService();

  await harness.service.deleteChatWorkspaceFile({
    userId: "user-1",
    chatId: "chat-1",
    storagePath: "/shared/input/report.txt"
  });

  assert.deepEqual(harness.deletedObjectKeys, [
    "gcs:/shared/input/report.txt",
    "gcs:/shared/input/report-thumb.png",
    "gcs:/shared/input/report-poster.png"
  ]);
  assert.deepEqual(harness.manifestDeletes, [
    { workspaceId: "workspace-1", path: "/shared/input/report.txt" }
  ]);
  assert.deepEqual(harness.hotPodRemovals, [
    { workspaceId: "workspace-1", path: "/shared/input/report.txt" }
  ]);
  assert.equal(harness.attachmentUpdates.length, 1);
});

test("deleteChatWorkspaceFile swallows hot pod rm failure after durable delete", async () => {
  const harness = createService({
    removeHotPodsError: new Error("pod exec failed")
  });

  await assert.doesNotReject(() =>
    harness.service.deleteChatWorkspaceFile({
      userId: "user-1",
      chatId: "chat-1",
      storagePath: "/shared/input/report.txt"
    })
  );
  assert.equal(harness.manifestDeletes.length, 1);
});

test("deleteChatWorkspaceFile surfaces manifest delete failure", async () => {
  const harness = createService({
    manifestDeleteError: new Error("db down")
  });

  await assert.rejects(
    harness.service.deleteChatWorkspaceFile({
      userId: "user-1",
      chatId: "chat-1",
      storagePath: "/shared/input/report.txt"
    }),
    /db down/
  );
  assert.equal(harness.hotPodRemovals.length, 0);
});

test("deleteWorkspaceFile deletes GCS + manifest + hot pod copy for orphan tiles", async () => {
  const harness = createService({
    attachments: []
  });

  await harness.service.deleteWorkspaceFile({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    path: "/shared/outbound/self/orphan.txt"
  });

  assert.deepEqual(harness.deletedObjectKeys, ["gcs:/shared/outbound/self/orphan.txt"]);
  assert.deepEqual(harness.manifestDeletes, [
    { workspaceId: "workspace-1", path: "/shared/outbound/self/orphan.txt" }
  ]);
  assert.deepEqual(harness.hotPodRemovals, [
    { workspaceId: "workspace-1", path: "/shared/outbound/self/orphan.txt" }
  ]);
  assert.equal(harness.attachmentUpdates.length, 0);
});

test("deleteWorkspaceFile returns 404 when manifest row and object are both absent", async () => {
  const harness = createService({
    attachments: [],
    manifestExists: false,
    objectExists: false
  });

  await assert.rejects(
    harness.service.deleteWorkspaceFile({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: "/shared/outbound/self/missing.txt"
    }),
    NotFoundException
  );
  assert.equal(harness.manifestDeletes.length, 0);
  assert.equal(harness.deletedObjectKeys.length, 0);
});
