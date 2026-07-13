import assert from "node:assert/strict";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../src/modules/workspace-management/domain/safety-policy.types";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { PrepareAssistantInboundTurnService } from "../src/modules/workspace-management/application/prepare-assistant-inbound-turn.service";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

function createNoopSafetyGate() {
  return {
    async enforceActiveSafetyRestriction() {
      return;
    }
  } as never;
}

function createNoopSafetyFollowThrough() {
  return {
    async enforce() {
      return;
    }
  } as never;
}

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
    sandboxEgressMode: "restricted",
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  };

  const createdMessages: Array<{ chatId: string; content: string }> = [];
  const runtimeDeletes: string[] = [];
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
            chatMode: "project",
            deepModeEnabled: true,
            skillDecisionState: null,
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
      },
      async getChatListMetadata() {
        return {
          messageCount: 0,
          lastMessagePreview: null
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
    createNoopSafetyGate(),
    createNoopSafetyFollowThrough(),
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async resolveMessagesPerChatLimit() {
        return null;
      },
      async refreshActiveWebChatsUsage() {
        return;
      }
    } as never,
    {
      $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
      runtimeSession: {
        findMany: async () => [{ id: "stale-runtime-session-1" }],
        deleteMany: async (args: Record<string, unknown>) => {
          runtimeDeletes.push(`session:${JSON.stringify(args)}`);
          return { count: 1 };
        }
      },
      runtimeTurnReceipt: {
        deleteMany: async (args: Record<string, unknown>) => {
          runtimeDeletes.push(`receipt:${JSON.stringify(args)}`);
          return { count: 1 };
        }
      },
      runtimeSessionCompaction: {
        deleteMany: async (args: Record<string, unknown>) => {
          runtimeDeletes.push(`compaction:${JSON.stringify(args)}`);
          return { count: 1 };
        }
      },
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
        return [
          {
            id: "att-1",
            messageId: "msg-1",
            chatId: "chat-1",
            assistantId: assistant.id,
            workspaceId: assistant.workspaceId,
            attachmentType: "document",
            storagePath: `${SESSION_ROOT}/brief.txt`,
            originalFilename: "brief.txt",
            mimeType: "text/plain",
            sizeBytes: BigInt(12),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            billingFacts: null,
            metadata: null,
            clientTurnId: null,
            clientAttachmentId: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z")
          }
        ];
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
  assert.equal(prepared.userMessage.attachments.length, 1);
  assert.equal(prepared.userMessage.attachments[0]?.path, `${SESSION_ROOT}/brief.txt`);
  assert.deepEqual(runtimeDeletes, [
    'receipt:{"where":{"assistantId":"assistant-1","channel":"web","externalThreadKey":"thread-1"}}',
    'compaction:{"where":{"runtimeSessionId":{"in":["stale-runtime-session-1"]},"assistantId":"assistant-1"}}',
    'session:{"where":{"id":{"in":["stale-runtime-session-1"]},"assistantId":"assistant-1","channel":"web","externalThreadKey":"thread-1"}}'
  ]);

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
        createNoopSafetyGate(),
        createNoopSafetyFollowThrough(),
        {
          async resolveActiveWebChatsLimit() {
            return 20;
          },
          async resolveMessagesPerChatLimit() {
            return null;
          }
        } as never,
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

  await assert.rejects(
    () =>
      new PrepareAssistantInboundTurnService(
        {
          async findChatBySurfaceThread() {
            return {
              id: "chat-2",
              assistantId: assistant.id,
              userId: assistant.userId,
              workspaceId: assistant.workspaceId,
              surface: "web" as const,
              surfaceThreadKey: "thread-2",
              title: "Existing chat",
              archivedAt: null,
              lastMessageAt: null,
              createdAt: new Date("2026-04-06T00:00:00.000Z"),
              updatedAt: new Date("2026-04-06T00:00:00.000Z")
            };
          },
          async countActiveChatsByAssistantIdAndSurface() {
            return 1;
          },
          async getChatListMetadata() {
            return {
              messageCount: 12,
              lastMessagePreview: "latest"
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
        createNoopSafetyGate(),
        createNoopSafetyFollowThrough(),
        {
          async resolveMessagesPerChatLimit() {
            return 12;
          },
          async refreshActiveWebChatsUsage() {
            return;
          }
        } as never,
        {
          runtimeSession: {
            findMany: async () => []
          },
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
        {} as never,
        {
          async listByMessageId() {
            return [];
          }
        } as never
      ).execute({
        userId: "user-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-2",
        message: "blocked by per-chat limit"
      }),
    (error: unknown) =>
      error instanceof Error &&
      "errorObject" in error &&
      typeof error.errorObject === "object" &&
      error.errorObject !== null &&
      "code" in error.errorObject &&
      error.errorObject.code === "chat_message_limit_reached"
  );

  await assert.rejects(
    () =>
      new PrepareAssistantInboundTurnService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
          async resolveByUserId() {
            throw new ApiErrorHttpException(409, {
              code: "assistant_activating",
              category: "conflict",
              message: "Assistant settings are still activating."
            });
          }
        } as never,
        {} as never,
        {} as never,
        {} as never
      ).execute({
        userId: "user-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-3",
        message: "blocked by activation"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "assistant_activating" &&
      error.errorObject.message === "Assistant settings are still activating."
  );

  const inboundOrder: string[] = [];
  await assert.rejects(
    () =>
      new PrepareAssistantInboundTurnService(
        {
          async findChatBySurfaceThread() {
            return null;
          },
          async countActiveChatsByAssistantIdAndSurface() {
            return 0;
          },
          async getOrCreateWebChatBySurfaceThreadUnderCap() {
            throw new Error("should not reach chat reservation");
          }
        } as never,
        {
          async enforceInboundTurn() {
            inboundOrder.push("quota");
            throw new ApiErrorHttpException(409, {
              code: "quota_blocked",
              category: "conflict",
              message: "quota blocked"
            });
          }
        } as never,
        {
          async enforceAndRegisterAttempt() {
            inboundOrder.push("abuse");
          }
        } as never,
        {
          async enforceActiveSafetyRestriction() {
            inboundOrder.push("safety");
          }
        } as never,
        {
          async enforce() {
            inboundOrder.push("precheck");
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
        {} as never,
        {} as never
      ).execute({
        userId: "user-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-order",
        message: "order check"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "quota_blocked"
  );
  assert.deepEqual(inboundOrder, ["safety", "abuse", "precheck", "quota"]);

  await assert.rejects(
    () =>
      new PrepareAssistantInboundTurnService(
        {} as never,
        {
          async enforceInboundTurn() {
            throw new Error("quota should not run when safety blocks");
          }
        } as never,
        {
          async enforceAndRegisterAttempt() {
            throw new Error("abuse should not run when safety blocks");
          }
        } as never,
        {
          async enforceActiveSafetyRestriction() {
            throw new ApiErrorHttpException(403, {
              code: "safety_restricted",
              category: "forbidden",
              message: SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
              details: { reasonCode: "violence_extremism" }
            });
          }
        } as never,
        createNoopSafetyFollowThrough(),
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
        {} as never,
        {} as never
      ).execute({
        userId: "user-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-safety",
        message: "blocked by safety"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "safety_restricted" &&
      error.errorObject.details?.reasonCode === "violence_extremism"
  );
}

void run();
