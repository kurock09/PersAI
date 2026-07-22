import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantAsyncJobContinuationSchedulerService } from "../src/modules/workspace-management/application/assistant-async-job-continuation-scheduler.service";

describe("persistOutputOnce delivery-bubble reuse", () => {
  test("writes catch-up narration into the media job completion bubble", async () => {
    const messageUpdates: Array<Record<string, unknown>> = [];
    const handleUpdates: Array<Record<string, unknown>> = [];
    let created = 0;

    const prisma = {
      $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
        callback({
          $queryRaw: async () => [{ messageId: null }],
          assistantMediaJob: {
            findUnique: async () => ({
              completionAssistantMessageId: "delivery-message-1"
            }),
            updateMany: async () => ({ count: 0 })
          },
          assistantDocumentRenderJob: {
            findUnique: async () => null
          },
          assistantChatMessage: {
            updateMany: async (input: Record<string, unknown>) => {
              messageUpdates.push(input);
              return { count: 1 };
            },
            create: async () => {
              created += 1;
              return { id: "should-not-create" };
            }
          },
          assistantAsyncJobHandle: {
            updateMany: async (input: Record<string, unknown>) => {
              handleUpdates.push(input);
              return { count: 1 };
            }
          }
        })
    };

    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await (
      service as unknown as {
        persistOutputOnce: (
          claim: { id: string; claimToken: string },
          context: {
            handle: {
              kind: "media";
              canonicalJobId: string;
              chatId: string;
              assistantId: string;
              continuationClientTurnId: string;
            };
            facts: Record<string, unknown>;
          },
          turnResult: { answerText: string }
        ) => Promise<{ outcome: string; messageId: string }>;
      }
    ).persistOutputOnce(
      { id: "handle-1", claimToken: "claim-1" },
      {
        handle: {
          kind: "media",
          canonicalJobId: "media-job-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          continuationClientTurnId: "async-cont:1"
        },
        facts: { jobRef: "jr1", queueOrdinal: 1, queueTotal: 1 }
      },
      { answerText: "Кот готов." }
    );

    assert.deepEqual(result, { outcome: "persisted", messageId: "delivery-message-1" });
    assert.equal(created, 0);
    assert.equal(messageUpdates.length, 1);
    assert.equal((messageUpdates[0]?.data as { content?: string })?.content, "Кот готов.");
    assert.equal(
      (handleUpdates[0]?.data as { continuationAssistantMessageId?: string })
        ?.continuationAssistantMessageId,
      "delivery-message-1"
    );
  });

  test("claims a new bubble as media completion when delivery has not pinned yet", async () => {
    const mediaPins: Array<Record<string, unknown>> = [];
    const prisma = {
      $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
        callback({
          $queryRaw: async () => [{ messageId: null }],
          assistantMediaJob: {
            findUnique: async () => ({ completionAssistantMessageId: null }),
            updateMany: async (input: Record<string, unknown>) => {
              mediaPins.push(input);
              return { count: 1 };
            }
          },
          assistantDocumentRenderJob: {
            findUnique: async () => null
          },
          assistantChatMessage: {
            updateMany: async () => ({ count: 0 }),
            create: async () => ({ id: "continuation-message-1" })
          },
          assistantAsyncJobHandle: {
            updateMany: async () => ({ count: 1 })
          }
        })
    };

    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await (
      service as unknown as {
        persistOutputOnce: (
          claim: { id: string; claimToken: string },
          context: {
            handle: {
              kind: "media";
              canonicalJobId: string;
              chatId: string;
              assistantId: string;
              continuationClientTurnId: string;
            };
            facts: Record<string, unknown>;
          },
          turnResult: { answerText: string }
        ) => Promise<{ outcome: string; messageId: string }>;
      }
    ).persistOutputOnce(
      { id: "handle-2", claimToken: "claim-2" },
      {
        handle: {
          kind: "media",
          canonicalJobId: "media-job-2",
          chatId: "chat-1",
          assistantId: "assistant-1",
          continuationClientTurnId: "async-cont:2"
        },
        facts: {}
      },
      { answerText: "Картинка готова." }
    );

    assert.deepEqual(result, { outcome: "persisted", messageId: "continuation-message-1" });
    assert.equal(mediaPins.length, 1);
    assert.equal(
      (mediaPins[0]?.data as { completionAssistantMessageId?: string })
        ?.completionAssistantMessageId,
      "continuation-message-1"
    );
  });
});
