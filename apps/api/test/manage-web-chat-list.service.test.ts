import assert from "node:assert/strict";
import { ManageWebChatListService } from "../src/modules/workspace-management/application/manage-web-chat-list.service";

async function run(): Promise<void> {
  const callOrder: string[] = [];
  const releasedBytes: bigint[] = [];
  const service = new ManageWebChatListService(
    {
      findByUserId: async (userId: string) =>
        userId === "user-1"
          ? {
              id: "assistant-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              draftDisplayName: null,
              draftInstructions: null,
              draftTraits: null,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftUpdatedAt: null,
              applyStatus: "succeeded",
              applyTargetVersionId: "version-1",
              applyAppliedVersionId: "version-1",
              applyRequestedAt: null,
              applyStartedAt: null,
              applyFinishedAt: null,
              applyErrorCode: null,
              applyErrorMessage: null,
              configDirtyAt: null,
              createdAt: new Date("2026-03-31T00:00:00.000Z"),
              updatedAt: new Date("2026-03-31T00:00:00.000Z")
            }
          : null
    } as never,
    {
      findChatById: async (chatId: string) =>
        chatId === "chat-1"
          ? {
              id: "chat-1",
              assistantId: "assistant-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              surface: "web",
              surfaceThreadKey: "thread-1",
              title: "Chat",
              archivedAt: null,
              lastMessageAt: null,
              createdAt: new Date("2026-03-31T00:00:00.000Z"),
              updatedAt: new Date("2026-03-31T00:00:00.000Z")
            }
          : null,
      hardDeleteChat: async () => {
        callOrder.push("repo-delete");
        return true;
      },
      countActiveChatsByAssistantIdAndSurface: async () => 0
    } as never,
    {
      listByChatId: async () => [
        {
          id: "att-1",
          messageId: "msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          attachmentType: "image",
          storagePath: "chat-1/msg-1/a.png",
          originalFilename: "a.png",
          mimeType: "image/png",
          sizeBytes: BigInt(2),
          durationMs: null,
          width: null,
          height: null,
          processingStatus: "ready",
          transcription: null,
          metadata: null,
          createdAt: new Date("2026-03-31T00:00:00.000Z")
        },
        {
          id: "att-2",
          messageId: "msg-2",
          chatId: "chat-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          attachmentType: "image",
          storagePath: "chat-1/msg-2/b.png",
          originalFilename: "b.png",
          mimeType: "image/png",
          sizeBytes: BigInt(3),
          durationMs: null,
          width: null,
          height: null,
          processingStatus: "ready",
          transcription: null,
          metadata: null,
          createdAt: new Date("2026-03-31T00:00:00.000Z")
        }
      ],
      deleteByChatId: async () => {
        callOrder.push("attachments-delete");
      }
    } as never,
    {
      deleteWebChatSession: async (input: {
        assistantId: string;
        chatId: string;
        surfaceThreadKey: string;
      }) => {
        callOrder.push("runtime-delete");
        assert.deepEqual(input, {
          assistantId: "assistant-1",
          chatId: "chat-1",
          surfaceThreadKey: "thread-1"
        });
      },
      deleteChatMediaBatch: async () => {
        callOrder.push("runtime-media-delete");
      }
    } as never,
    {
      resolveByAssistantId: async (assistantId: string) => {
        assert.equal(assistantId, "assistant-1");
        return "free_shared_restricted";
      }
    } as never,
    {
      releaseMediaStorage: async (input: { sizeBytes: bigint }) => {
        releasedBytes.push(input.sizeBytes);
      },
      refreshActiveWebChatsUsage: async (input: {
        source: string;
        activeWebChatsCurrent: number;
      }) => {
        callOrder.push(`quota-${input.source}-${String(input.activeWebChatsCurrent)}`);
      }
    } as never,
    {
      buildChatPrefix(input: { assistantId: string; chatId: string }) {
        assert.deepEqual(input, { assistantId: "assistant-1", chatId: "chat-1" });
        return "assistant-media/assistants/assistant-1/chats/chat-1/";
      },
      async deletePrefix(prefix: string) {
        callOrder.push(`object-storage-delete:${prefix}`);
      }
    } as never
  );

  await service.hardDeleteChat("user-1", "chat-1", { confirmText: "DELETE" });
  assert.deepEqual(callOrder, [
    "runtime-delete",
    "object-storage-delete:assistant-media/assistants/assistant-1/chats/chat-1/",
    "attachments-delete",
    "repo-delete",
    "quota-web_chat_hard_delete-0"
  ]);
  assert.deepEqual(releasedBytes, [BigInt(5)]);
}

void run();
