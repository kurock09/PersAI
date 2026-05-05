import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeMediaJobCompletionRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeMediaJobCompletionService } from "../src/modules/turns/runtime-media-job-completion.service";

describe("RuntimeMediaJobCompletionService", () => {
  test("builds an idempotent bounded completion framing request", async () => {
    let acceptedRequest: RuntimeTurnRequest | null = null;
    let providerRequest: ProviderGatewayTextGenerateRequest | null = null;
    let finalizedResult: RuntimeTurnResult | null = null;

    const service = new RuntimeMediaJobCompletionService(
      {
        generateText: async (input: ProviderGatewayTextGenerateRequest) => {
          providerRequest = input;
          return {
            text: JSON.stringify({ assistantText: "Fresh completion framing." }),
            usage: null
          };
        }
      } as never,
      {
        acceptTurn: async (input: RuntimeTurnRequest) => {
          acceptedRequest = input;
          return {
            outcome: "accepted",
            conversationKey: "conversation-key",
            session: {
              sessionId: "session-1",
              runtimeTier: "paid_shared_restricted",
              conversation: input.conversation,
              publishedVersionId: "version-1",
              bundleHash: "bundle-hash",
              currentTokens: null,
              currentCostMicros: null,
              totalTurns: 0,
              lastTurnAt: null,
              createdAt: "2026-05-05T09:00:00.000Z",
              updatedAt: "2026-05-05T09:00:00.000Z"
            },
            receipt: {
              requestId: input.requestId,
              sessionId: "session-1",
              publishedVersionId: "version-1",
              status: "accepted",
              bundleHash: "bundle-hash",
              resultPayload: null,
              errorCode: null,
              errorMessage: null,
              completedAt: null
            },
            lease: {} as never
          };
        }
      } as never,
      {
        completeAcceptedTurn: async (_acceptedTurn: unknown, result: RuntimeTurnResult) => {
          finalizedResult = result;
          return {
            receiptStatus: "completed",
            session: {} as never,
            leaseReleased: true
          };
        },
        failAcceptedTurn: async () => {
          throw new Error("should not fail");
        }
      } as never
    );

    const result = await service.complete({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeTier: "paid_shared_restricted",
      runtimeBundleDocument: JSON.stringify({
        metadata: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          publishedVersionId: "version-1"
        },
        runtime: {
          runtimeProviderRouting: {
            modelSlots: {
              premiumReply: {
                providerKey: "openai",
                modelKey: "gpt-5.4-medium"
              }
            }
          }
        },
        promptConstructor: {
          ordinary: {
            systemPrompt: "You are PersAI.",
            sections: {
              heartbeat: "Stay calm and helpful."
            }
          }
        },
        persona: {
          displayName: "PersAI"
        },
        userContext: {
          locale: "en",
          timezone: "UTC"
        }
      }),
      job: {
        id: "job-1",
        surface: "telegram",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "draw a skyline",
        sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
      },
      currentHistory: [
        {
          author: "user",
          content: "Please draw a skyline at dusk.",
          createdAt: "2026-05-05T09:00:00.000Z"
        },
        {
          author: "assistant",
          content: "I queued the image for you.",
          createdAt: "2026-05-05T09:00:02.000Z"
        }
      ],
      workerResult: {
        assistantText: "Your image is ready.",
        artifacts: [{ type: "image", filename: "skyline.png", fileRef: "file-ref-1" }]
      }
    } satisfies RuntimeMediaJobCompletionRequest);

    assert.equal(result.assistantText, "Fresh completion framing.");
    assert.ok(acceptedRequest);
    const recordedAcceptance = acceptedRequest as RuntimeTurnRequest;
    assert.equal(recordedAcceptance.conversation.channel, "telegram");
    assert.match(recordedAcceptance.requestId, /^media-job-completion:job-1:/);
    assert.ok(providerRequest);
    const recordedProviderRequest = providerRequest as ProviderGatewayTextGenerateRequest;
    assert.equal(recordedProviderRequest.requestMetadata?.classification, "media_job_completion");
    assert.match(JSON.stringify(recordedProviderRequest.messages), /Please draw a skyline at dusk/);
    assert.match(JSON.stringify(recordedProviderRequest.messages), /Your image is ready/);
    assert.ok(finalizedResult);
    const recordedFinalizedResult = finalizedResult as RuntimeTurnResult;
    assert.equal(recordedFinalizedResult.assistantText, "Fresh completion framing.");
    assert.equal(recordedFinalizedResult.artifacts.length, 0);
  });
});
