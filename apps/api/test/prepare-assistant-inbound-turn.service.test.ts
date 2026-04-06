import assert from "node:assert/strict";
import { PrepareAssistantInboundTurnService } from "../src/modules/workspace-management/application/prepare-assistant-inbound-turn.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
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
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  };

  const createdMessages: Array<{ chatId: string; content: string }> = [];
  const service = new PrepareAssistantInboundTurnService(
    {
      async findChatBySurfaceThread() {
        return null;
      },
      async countActiveChatsByAssistantIdAndSurface() {
        return 19;
      },
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web" as const,
            surfaceThreadKey: "thread-1",
            title: "Hello there",
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage(input: { chatId: string; content: string }) {
        createdMessages.push(input);
        return {
          id: "msg-1",
          chatId: input.chatId,
          assistantId: assistant.id,
          author: "user" as const,
          content: input.content,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async enforceInboundTurn() {
        return { mode: "allow" as const };
      }
    } as never,
    {
      async enforceAndRegisterAttempt() {
        return;
      }
    } as never,
    {
      async refreshActiveWebChatsUsage() {
        return;
      }
    } as never,
    {
      workspace: {
        findUnique: async () => ({ timezone: "UTC" })
      }
    } as never,
    {
      async resolveByUserId() {
        return {
          assistant,
          publishedVersionId: "version-1",
          runtimeTier: "free_shared_restricted",
          quotaDegradeModelOverride: null
        };
      }
    } as never,
    {
      async mergeIntoUserMessage() {
        return;
      }
    } as never,
    {
      async listByMessageId() {
        return [];
      }
    } as never
  );

  const prepared = await service.execute({
    userId: "user-1",
    surface: "web_chat",
    surfaceThreadKey: "thread-1",
    message: "Hello there"
  });

  assert.equal(prepared.chat.id, "chat-1");
  assert.equal(createdMessages.length, 1);
  assert.equal(createdMessages[0]?.chatId, "chat-1");

  await assert.rejects(
    () =>
      new PrepareAssistantInboundTurnService(
        {
          async findChatBySurfaceThread() {
            return null;
          },
          async countActiveChatsByAssistantIdAndSurface() {
            return 19;
          },
          async getOrCreateWebChatBySurfaceThreadUnderCap() {
            return {
              outcome: "cap_reached" as const,
              activeCount: 20,
              limit: 20
            };
          }
        } as never,
        {
          async enforceInboundTurn() {
            return { mode: "allow" as const };
          }
        } as never,
        {
          async enforceAndRegisterAttempt() {
            return;
          }
        } as never,
        {} as never,
        {} as never,
        {
          async resolveByUserId() {
            return {
              assistant,
              publishedVersionId: "version-1",
              runtimeTier: "free_shared_restricted",
              quotaDegradeModelOverride: null
            };
          }
        } as never,
        {} as never,
        {} as never
      ).execute({
        userId: "user-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-2",
        message: "blocked"
      }),
    (error: unknown) =>
      error instanceof Error &&
      "errorObject" in error &&
      typeof error.errorObject === "object" &&
      error.errorObject !== null &&
      "code" in error.errorObject &&
      error.errorObject.code === "active_chat_cap_reached"
  );
}

void run();
