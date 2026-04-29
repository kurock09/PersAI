import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WebChatTurnAttemptService } from "../src/modules/workspace-management/application/web-chat-turn-attempt.service";

describe("WebChatTurnAttemptService", () => {
  test("returns current tool activity only for active web turns", async () => {
    const attempt = {
      id: "attempt-1",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      surfaceClient: null,
      status: "running",
      chatId: "chat-1",
      userMessageId: "user-message-1",
      assistantMessageId: null,
      respondedAt: null,
      currentActivity: {
        type: "tool_use",
        toolName: "web_search",
        toolCallId: "tool-1",
        phase: "start",
        isError: false,
        updatedAt: "2026-04-29T13:00:00.000Z"
      },
      terminalPayload: null,
      errorCode: null,
      errorMessage: null
    };
    const prisma = {
      assistantWebChatTurnAttempt: {
        findFirst: async () => attempt,
        findUnique: async () => attempt
      },
      assistantChat: {
        findUnique: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false,
          archivedAt: null,
          lastMessageAt: new Date("2026-04-29T13:00:00.000Z"),
          createdAt: new Date("2026-04-29T12:59:00.000Z"),
          updatedAt: new Date("2026-04-29T13:00:00.000Z")
        })
      },
      assistantChatMessage: {
        findUnique: async () => ({
          id: "user-message-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "search this",
          createdAt: new Date("2026-04-29T12:59:00.000Z")
        })
      },
      assistantChatMessageAttachment: {
        findMany: async () => []
      }
    };
    const service = new WebChatTurnAttemptService(
      prisma as never,
      {
        resolveByUserId: async () => ({ assistantId: "assistant-1" })
      } as never
    );

    const status = await service.getStatusForUser("user-1", "turn-1");

    assert.equal(status.status, "running");
    assert.deepEqual(status.currentActivity, attempt.currentActivity);
  });
});
