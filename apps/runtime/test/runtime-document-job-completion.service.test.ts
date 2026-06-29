import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeDocumentJobCompletionRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeDocumentJobCompletionService } from "../src/modules/turns/runtime-document-job-completion.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";

describe("RuntimeDocumentJobCompletionService", () => {
  test("builds an idempotent bounded document completion framing request", async () => {
    let acceptedRequest: RuntimeTurnRequest | null = null;
    let providerRequest: ProviderGatewayTextGenerateRequest | null = null;
    let finalizedResult: RuntimeTurnResult | null = null;

    const service = new RuntimeDocumentJobCompletionService(
      {
        generateText: async (input: ProviderGatewayTextGenerateRequest) => {
          providerRequest = input;
          return {
            text: JSON.stringify({ assistantText: "Fresh document completion framing." }),
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
              createdAt: "2026-05-16T16:00:00.000Z",
              updatedAt: "2026-05-16T16:00:00.000Z"
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
      } as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService())
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
              normalReply: {
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
        docId: "doc-1",
        versionId: "version-1",
        surface: "web",
        chatId: "chat-1",
        outputFormat: "pdf",
        descriptorMode: "create_presentation",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "Create a concise business brief.",
        sourceUserMessageCreatedAt: "2026-05-16T16:00:00.000Z"
      },
      currentHistory: [
        {
          author: "user",
          content: "Please create a concise business brief.",
          createdAt: "2026-05-16T16:00:00.000Z"
        },
        {
          author: "assistant",
          content: "I started preparing that document.",
          createdAt: "2026-05-16T16:00:02.000Z"
        }
      ],
      workerResult: {
        assistantText: "Your document is ready.",
        artifacts: [{ type: "file", filename: "brief.pdf", storagePath: "file-ref-1" }]
      }
    } satisfies RuntimeDocumentJobCompletionRequest);

    assert.equal(result.assistantText, "Fresh document completion framing.");
    assert.ok(acceptedRequest);
    const recordedAcceptance = acceptedRequest as RuntimeTurnRequest;
    assert.equal(recordedAcceptance.conversation.channel, "web");
    assert.match(recordedAcceptance.requestId, /^document-job-completion:job-1:/);
    assert.equal(recordedAcceptance.modelRoleOverride, "system_tool");
    assert.match(
      recordedAcceptance.conversation.externalThreadKey,
      /^system:document-job-completion:job-1$/
    );

    assert.ok(providerRequest);
    const recordedProviderRequest = providerRequest as ProviderGatewayTextGenerateRequest;
    assert.equal(
      recordedProviderRequest.requestMetadata?.classification,
      "document_job_completion"
    );
    const serializedMessages = JSON.stringify(recordedProviderRequest.messages);
    assert.match(serializedMessages, /Create a concise business brief/);
    assert.match(serializedMessages, /Your document is ready/);
    assert.match(serializedMessages, /create_presentation/);
    assert.match(
      String(recordedProviderRequest.developerInstructions ?? ""),
      /Do not claim the file was already sent, attached, uploaded, or delivered/
    );
    assert.doesNotMatch(
      String(recordedProviderRequest.developerInstructions ?? ""),
      /Stay calm and helpful/
    );

    assert.ok(finalizedResult);
    const recordedFinalizedResult = finalizedResult as RuntimeTurnResult;
    assert.equal(recordedFinalizedResult.assistantText, "Fresh document completion framing.");
    assert.equal(recordedFinalizedResult.artifacts.length, 0);
  });

  test("builds a bounded document failure framing request", async () => {
    let acceptedRequest: RuntimeTurnRequest | null = null;
    let providerRequest: ProviderGatewayTextGenerateRequest | null = null;

    const service = new RuntimeDocumentJobCompletionService(
      {
        generateText: async (input: ProviderGatewayTextGenerateRequest) => {
          providerRequest = input;
          return {
            text: JSON.stringify({
              assistantText: "I couldn't finish that document request. Please try again."
            }),
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
              sessionId: "session-2",
              runtimeTier: "paid_shared_restricted",
              conversation: input.conversation,
              publishedVersionId: "version-1",
              bundleHash: "bundle-hash",
              currentTokens: null,
              currentCostMicros: null,
              totalTurns: 0,
              lastTurnAt: null,
              createdAt: "2026-05-16T16:10:00.000Z",
              updatedAt: "2026-05-16T16:10:00.000Z"
            },
            receipt: {
              requestId: input.requestId,
              sessionId: "session-2",
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
        completeAcceptedTurn: async () => ({
          receiptStatus: "completed",
          session: {} as never,
          leaseReleased: true
        }),
        failAcceptedTurn: async () => {
          throw new Error("should not fail");
        }
      } as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService())
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
              normalReply: {
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
        id: "job-failure-1",
        docId: "doc-1",
        versionId: "version-1",
        surface: "web",
        chatId: "chat-1",
        outputFormat: "pdf",
        descriptorMode: "create_presentation",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "Create a concise business brief.",
        sourceUserMessageCreatedAt: "2026-05-16T16:00:00.000Z"
      },
      currentHistory: [
        {
          author: "user",
          content: "Please create a concise business brief.",
          createdAt: "2026-05-16T16:00:00.000Z"
        }
      ],
      failure: {
        code: "document_delivery_failed",
        message: "Generated document could not be delivered to the chat.",
        attemptCount: 1,
        maxAttempts: 1,
        retryable: false,
        stage: "delivery"
      }
    } satisfies RuntimeDocumentJobCompletionRequest);

    assert.equal(
      result.assistantText,
      "I couldn't finish that document request. Please try again."
    );
    assert.ok(acceptedRequest);
    const recordedAcceptance = acceptedRequest as RuntimeTurnRequest;
    assert.equal(recordedAcceptance.modelRoleOverride, "system_tool");
    assert.match(
      recordedAcceptance.conversation.externalThreadKey,
      /^system:document-job-failure:job-failure-1$/
    );

    assert.ok(providerRequest);
    const recordedProviderRequest = providerRequest as ProviderGatewayTextGenerateRequest;
    const serializedMessages = JSON.stringify(recordedProviderRequest.messages);
    assert.match(serializedMessages, /document_failure_explanation/);
    assert.match(serializedMessages, /document_delivery_failed/);
    assert.match(serializedMessages, /Generated document could not be delivered to the chat/);
  });
});
