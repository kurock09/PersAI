import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendWebChatTurnService } from "../src/modules/workspace-management/application/send-web-chat-turn.service";

function createOverviewLatencyTraceServiceMock() {
  return {
    start() {
      return {
        stage() {
          return undefined;
        },
        isEnabled() {
          return false;
        },
        getTraceId() {
          return "trace-test";
        },
        attachExternalTrace() {
          return undefined;
        },
        finish() {
          return undefined;
        }
      };
    }
  };
}

describe("SendWebChatTurnService", () => {
  test("replays duplicate clientTurnId without starting a second sync runtime turn", async () => {
    let runtimeCalls = 0;
    const completedState = {
      clientTurnId: "turn-1",
      chatId: "chat-1",
      userMessageId: "user-msg-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-04-05T12:00:01.000Z",
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      completedAt: "2026-04-05T12:00:02.000Z"
    };

    const service = new SendWebChatTurnService(
      {
        findChatById: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:02.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:02.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: messageId === "user-msg-1" ? "user" : "assistant",
          content: messageId === "user-msg-1" ? "hello" : "hi back",
          createdAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        claimWebTurnProcessing: async () => "duplicate_handled",
        getCompletedWebTurnProcessing: async () => completedState
      } as never,
      {
        sendWebChatTurn: async () => {
          runtimeCalls += 1;
          return {
            assistantMessage: "live",
            respondedAt: "2026-04-05T12:00:01.000Z",
            media: []
          };
        }
      } as never,
      {
        execute: async () => {
          throw new Error("prepare should not be called for replay");
        }
      } as never,
      {
        resolveByUserId: async () => ({
          assistantId: "assistant-1"
        })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-1"
    });

    assert.equal(runtimeCalls, 0);
    assert.equal(result.userMessage.id, "user-msg-1");
    assert.equal(result.assistantMessage.id, "assistant-msg-1");
    assert.equal(result.assistantMessage.content, "hi back");
  });
});
