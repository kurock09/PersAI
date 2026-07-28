import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WebChatTurnAttemptService } from "../src/modules/workspace-management/application/web-chat-turn-attempt.service";

const noopChatWakeCoordinator = {
  async admitUserTurn() {
    return undefined;
  },
  async recordUserTurnTerminal() {
    return undefined;
  }
} as never;

describe("WebChatTurnAttemptService", () => {
  test("claim keeps a failed attempt immutable under the same clientTurnId", async () => {
    let updated = false;
    let created = false;
    const service = new WebChatTurnAttemptService(
      {
        assistantWebChatTurnAttempt: {
          findUnique: async () => ({
            id: "attempt-failed",
            status: "failed",
            errorCode: "web_turn_failed",
            errorMessage: "Original failure.",
            runningAt: new Date("2026-07-28T16:00:00.000Z"),
            acceptedAt: new Date("2026-07-28T15:59:59.000Z"),
            updatedAt: new Date("2026-07-28T16:00:01.000Z")
          }),
          update: async () => {
            updated = true;
            return {};
          },
          create: async () => {
            created = true;
            return {};
          }
        }
      } as never,
      { execute: async () => ({ assistantId: "assistant-1" }) } as never,
      noopChatWakeCoordinator
    );

    const result = await service.claim({
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-failed",
      claimedAt: new Date("2026-07-28T16:05:00.000Z"),
      staleAfterMs: 60_000
    });

    assert.deepEqual(result, {
      outcome: "duplicate_terminal",
      terminalStatus: "failed",
      errorCode: "web_turn_failed",
      errorMessage: "Original failure."
    });
    assert.equal(updated, false);
    assert.equal(created, false);
  });

  test("claim keeps an interrupted attempt immutable under the same clientTurnId", async () => {
    let updated = false;
    let created = false;
    const service = new WebChatTurnAttemptService(
      {
        assistantWebChatTurnAttempt: {
          findUnique: async () => ({
            id: "attempt-interrupted",
            status: "interrupted",
            errorCode: "web_turn_interrupted",
            errorMessage: "Stopped by user.",
            runningAt: new Date("2026-07-28T16:00:00.000Z"),
            acceptedAt: new Date("2026-07-28T15:59:59.000Z"),
            updatedAt: new Date("2026-07-28T16:00:01.000Z")
          }),
          update: async () => {
            updated = true;
            return {};
          },
          create: async () => {
            created = true;
            return {};
          }
        }
      } as never,
      { execute: async () => ({ assistantId: "assistant-1" }) } as never,
      noopChatWakeCoordinator
    );

    const result = await service.claim({
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-interrupted",
      claimedAt: new Date("2026-07-28T16:05:00.000Z"),
      staleAfterMs: 60_000
    });

    assert.deepEqual(result, {
      outcome: "duplicate_terminal",
      terminalStatus: "interrupted",
      errorCode: "web_turn_interrupted",
      errorMessage: "Stopped by user."
    });
    assert.equal(updated, false);
    assert.equal(created, false);
  });

  test("claim allows a deliberate retry with a new clientTurnId", async () => {
    const created: Array<Record<string, unknown>> = [];
    const service = new WebChatTurnAttemptService(
      {
        assistantWebChatTurnAttempt: {
          findUnique: async () => null,
          create: async (input: { data: Record<string, unknown> }) => {
            created.push(input.data);
            return {};
          }
        }
      } as never,
      { execute: async () => ({ assistantId: "assistant-1" }) } as never,
      noopChatWakeCoordinator
    );

    const result = await service.claim({
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-new-id",
      claimedAt: new Date("2026-07-28T16:05:00.000Z"),
      staleAfterMs: 60_000
    });

    assert.equal(result, "claimed");
    assert.equal(created.length, 1);
    assert.equal(created[0]?.clientTurnId, "turn-new-id");
    assert.equal(created[0]?.status, "accepted");
  });

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
        execute: async () => ({ assistantId: "assistant-1" })
      } as never,
      noopChatWakeCoordinator
    );

    const status = await service.getStatusForUser("user-1", "turn-1");

    assert.equal(status.status, "running");
    assert.deepEqual(status.currentActivity, attempt.currentActivity);
  });

  test("does not overwrite a completed attempt with later failed or interrupted writes", async () => {
    const attempt = {
      status: "running",
      assistantMessageId: null as string | null,
      errorCode: null as string | null,
      errorMessage: null as string | null,
      currentActivity: { type: "tool_use" }
    };
    const prisma = {
      assistantWebChatTurnAttempt: {
        updateMany: async (input: {
          where?: { status?: { in?: string[] } };
          data?: Record<string, unknown>;
        }) => {
          const allowedStatuses = input.where?.status?.in ?? [];
          if (!allowedStatuses.includes(attempt.status)) {
            return { count: 0 };
          }
          if (input.data?.status === "completed") {
            attempt.status = "completed";
            attempt.assistantMessageId = String(input.data.assistantMessageId ?? "");
            attempt.errorCode = null;
            attempt.errorMessage = null;
            attempt.currentActivity = null;
            return { count: 1 };
          }
          attempt.status = String(input.data?.status ?? attempt.status);
          attempt.assistantMessageId =
            input.data?.assistantMessageId === undefined
              ? attempt.assistantMessageId
              : (input.data.assistantMessageId as string | null);
          attempt.errorCode = (input.data?.errorCode as string | null) ?? null;
          attempt.errorMessage = (input.data?.errorMessage as string | null) ?? null;
          attempt.currentActivity = null;
          return { count: 1 };
        }
      }
    };
    const service = new WebChatTurnAttemptService(
      prisma as never,
      {
        execute: async () => ({ assistantId: "assistant-1" })
      } as never,
      noopChatWakeCoordinator
    );

    await service.markCompleted({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-04-29T13:00:00.000Z",
      terminalPayload: {
        clientTurnId: "turn-1",
        chatId: "chat-1",
        userMessageId: "user-message-1",
        assistantMessageId: "assistant-msg-1",
        respondedAt: "2026-04-29T13:00:00.000Z",
        degradedByQuotaFallback: false,
        quotaFallbackReason: null,
        quotaFallbackModel: null,
        completedAt: "2026-04-29T13:00:01.000Z"
      }
    });
    await service.markFailed({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      code: "late_failure",
      message: "should be ignored"
    });
    await service.markInterrupted({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      assistantMessageId: "assistant-msg-2",
      code: "late_interrupt",
      message: "should also be ignored"
    });

    assert.equal(attempt.status, "completed");
    assert.equal(attempt.assistantMessageId, "assistant-msg-1");
    assert.equal(attempt.errorCode, null);
    assert.equal(attempt.errorMessage, null);
    assert.equal(attempt.currentActivity, null);
  });

  test("async_continuation terminals do not stamp last_user_turn_terminal_at", async () => {
    const terminalStamps: string[] = [];
    const startedStamps: string[] = [];
    const prisma = {
      assistantWebChatTurnAttempt: {
        findFirst: async () => ({
          chatId: "chat-async",
          surfaceClient: "async_continuation"
        }),
        update: async () => ({}),
        updateMany: async () => ({ count: 1 })
      }
    };
    const coordinator = {
      recordUserTurnTerminal: async (chatId: string) => {
        terminalStamps.push(chatId);
      },
      recordUserTurnStarted: async (chatId: string) => {
        startedStamps.push(chatId);
      }
    };
    const service = new WebChatTurnAttemptService(
      prisma as never,
      { execute: async () => ({ assistantId: "assistant-1" }) } as never,
      coordinator as never
    );

    await service.markRunning({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "async-cont:job-1",
      chatId: "chat-async",
      userMessageId: null,
      surfaceClient: "async_continuation"
    });
    await service.markCompleted({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "async-cont:job-1",
      assistantMessageId: "assistant-msg-async",
      respondedAt: "2026-07-19T13:00:00.000Z",
      terminalPayload: {
        clientTurnId: "async-cont:job-1",
        chatId: "chat-async",
        userMessageId: null,
        assistantMessageId: "assistant-msg-async",
        respondedAt: "2026-07-19T13:00:00.000Z",
        degradedByQuotaFallback: false,
        quotaFallbackReason: null,
        quotaFallbackModel: null,
        completedAt: "2026-07-19T13:00:01.000Z"
      }
    });
    await service.markFailed({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "async-cont:job-2",
      code: "continuation_failed",
      message: "boom"
    });

    assert.deepEqual(startedStamps, []);
    assert.deepEqual(terminalStamps, []);
  });

  test("markRunning only updates an already-admitted attempt", async () => {
    const order: string[] = [];
    const service = new WebChatTurnAttemptService(
      {
        assistantWebChatTurnAttempt: {
          update: async () => {
            order.push("attempt_running");
            return {};
          }
        }
      } as never,
      { execute: async () => ({ assistantId: "assistant-1" }) } as never,
      {
        admitUserTurn: async () => {
          throw new Error("markRunning must not admit USER_TURN");
        }
      } as never,
      noopChatWakeCoordinator
    );
    await service.markRunning({
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-user",
      chatId: "chat-user",
      userMessageId: "message-user",
      surfaceClient: "web_chat"
    });
    assert.deepEqual(order, ["attempt_running"]);
  });

  test("returns unknown when the active assistant differs from the turn owner", async () => {
    let lookedUpAssistantId: string | null = null;
    const prisma = {
      assistantWebChatTurnAttempt: {
        findFirst: async (input: {
          where?: { assistantId?: string; userId?: string; clientTurnId?: string };
        }) => {
          lookedUpAssistantId = input.where?.assistantId ?? null;
          return null;
        }
      }
    };
    const service = new WebChatTurnAttemptService(
      prisma as never,
      {
        execute: async () => ({ assistantId: "assistant-2" })
      } as never,
      noopChatWakeCoordinator
    );

    const status = await service.getStatusForUser("user-1", "turn-1");

    assert.equal(lookedUpAssistantId, "assistant-2");
    assert.equal(status.status, "unknown");
    assert.equal(status.chat, null);
    assert.equal(status.userMessage, null);
    assert.equal(status.assistantMessage, null);
  });
});
