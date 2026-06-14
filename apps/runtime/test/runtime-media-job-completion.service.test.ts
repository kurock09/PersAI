import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeMediaJobCompletionRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { RuntimeMediaJobCompletionService } from "../src/modules/turns/runtime-media-job-completion.service";

const noopMediaObjectStorage = {
  async downloadObject() {
    return null;
  }
} as never;

function createCompletionService(overrides?: {
  generateText?: (input: ProviderGatewayTextGenerateRequest) => Promise<{
    text: string;
    usage: null;
  }>;
  downloadObject?: (objectKey: string) => Promise<Buffer | null>;
}) {
  let acceptedRequest: RuntimeTurnRequest | null = null;
  let providerRequest: ProviderGatewayTextGenerateRequest | null = null;
  let finalizedResult: RuntimeTurnResult | null = null;

  const service = new RuntimeMediaJobCompletionService(
    {
      generateText:
        overrides?.generateText ??
        (async (input: ProviderGatewayTextGenerateRequest) => {
          providerRequest = input;
          return {
            text: JSON.stringify({ assistantText: "Fresh completion framing." }),
            usage: null
          };
        })
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
    } as never,
    new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
    {
      downloadObject:
        overrides?.downloadObject ??
        (async () => {
          return null;
        })
    } as never
  );

  return {
    service,
    get acceptedRequest() {
      return acceptedRequest;
    },
    get providerRequest() {
      return providerRequest;
    },
    get finalizedResult() {
      return finalizedResult;
    }
  };
}

describe("RuntimeMediaJobCompletionService", () => {
  test("builds an idempotent bounded completion framing request", async () => {
    const ctx = createCompletionService();

    const result = await ctx.service.complete({
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
        },
        governance: {
          toolPolicies: []
        }
      }),
      job: {
        id: "job-1",
        surface: "telegram",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "draw a skyline",
        sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
        toolCode: "image_generate"
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
        artifacts: [
          {
            type: "image",
            filename: "skyline.png",
            fileRef: "file-ref-1",
            objectKey: null
          }
        ]
      }
    } satisfies RuntimeMediaJobCompletionRequest);

    assert.equal(result.assistantText, "Fresh completion framing.");
    assert.ok(ctx.acceptedRequest);
    const recordedAcceptance = ctx.acceptedRequest as RuntimeTurnRequest;
    assert.equal(recordedAcceptance.conversation.channel, "telegram");
    assert.match(recordedAcceptance.requestId, /^media-job-completion:job-1:/);
    assert.equal(recordedAcceptance.modelRoleOverride, "system_tool");
    assert.ok(ctx.providerRequest);
    const recordedProviderRequest = ctx.providerRequest as ProviderGatewayTextGenerateRequest;
    assert.equal(recordedProviderRequest.requestMetadata?.classification, "media_job_completion");
    assert.match(JSON.stringify(recordedProviderRequest.messages), /Please draw a skyline at dusk/);
    assert.match(JSON.stringify(recordedProviderRequest.messages), /Your image is ready/);
    assert.match(
      String(recordedProviderRequest.developerInstructions ?? ""),
      /You MUST return a non-empty assistantText/
    );
    assert.ok(ctx.finalizedResult);
    const recordedFinalizedResult = ctx.finalizedResult as RuntimeTurnResult;
    assert.equal(recordedFinalizedResult.assistantText, "Fresh completion framing.");
    assert.equal(recordedFinalizedResult.artifacts.length, 0);
  });

  test("authors a failure explanation when failure context is supplied instead of workerResult", async () => {
    let acceptedRequest: RuntimeTurnRequest | null = null;
    let providerRequest: ProviderGatewayTextGenerateRequest | null = null;

    const service = new RuntimeMediaJobCompletionService(
      {
        generateText: async (input: ProviderGatewayTextGenerateRequest) => {
          providerRequest = input;
          return {
            text: JSON.stringify({
              assistantText:
                "Не получилось дорисовать ваш закат: провайдер заблокировал запрос по политике."
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
              sessionId: "session-failure-1",
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
              sessionId: "session-failure-1",
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
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      noopMediaObjectStorage
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
          locale: "ru",
          timezone: "Europe/Moscow"
        },
        governance: {
          toolPolicies: []
        }
      }),
      job: {
        id: "job-fail-1",
        surface: "web",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "нарисуй откровенный закат",
        sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
      },
      currentHistory: [
        {
          author: "user",
          content: "Нарисуй откровенный закат.",
          createdAt: "2026-05-05T09:00:00.000Z"
        }
      ],
      failure: {
        code: "image_generate_blocked",
        message: "OpenAI moderation blocked the prompt as explicit content.",
        attemptCount: 1,
        maxAttempts: 3,
        retryable: false,
        stage: "execution"
      }
    } satisfies RuntimeMediaJobCompletionRequest);

    assert.equal(
      result.assistantText,
      "Не получилось дорисовать ваш закат: провайдер заблокировал запрос по политике."
    );
    assert.ok(acceptedRequest);
    const recordedAcceptance = acceptedRequest as RuntimeTurnRequest;
    assert.match(recordedAcceptance.requestId, /^media-job-completion-failure:job-fail-1:/);
    assert.equal(recordedAcceptance.modelRoleOverride, "system_tool");
    assert.match(
      recordedAcceptance.conversation.externalThreadKey,
      /^system:media-job-failure:job-fail-1$/
    );
    assert.ok(providerRequest);
    const recordedProviderRequest = providerRequest as ProviderGatewayTextGenerateRequest;
    assert.equal(
      recordedProviderRequest.requestMetadata?.classification,
      "media_job_failure_explanation"
    );
    const serializedMessages = JSON.stringify(recordedProviderRequest.messages);
    assert.match(serializedMessages, /failure_explanation/);
    assert.match(serializedMessages, /OpenAI moderation blocked the prompt/);
    assert.match(serializedMessages, /image_generate_blocked/);
    assert.equal(serializedMessages.includes("workerResult"), false);
    assert.doesNotMatch(
      String(recordedProviderRequest.developerInstructions ?? ""),
      /Stay calm and helpful/
    );
    assert.match(
      String(recordedProviderRequest.developerInstructions ?? ""),
      /explaining to the user that an async PersAI media job did NOT finish successfully/
    );
  });

  test("rejects requests that supply both workerResult and failure", async () => {
    const service = new RuntimeMediaJobCompletionService(
      { generateText: async () => ({ text: "{}", usage: null }) } as never,
      { acceptTurn: async () => ({ outcome: "accepted" }) } as never,
      {
        completeAcceptedTurn: async () => ({
          receiptStatus: "completed",
          session: {} as never,
          leaseReleased: true
        }),
        failAcceptedTurn: async () => undefined
      } as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      noopMediaObjectStorage
    );

    await assert.rejects(
      service.complete({
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
              sections: {}
            }
          },
          persona: { displayName: "PersAI" },
          userContext: { locale: "en", timezone: "UTC" }
        }),
        job: {
          id: "job-conflict-1",
          surface: "web",
          kind: "image",
          chatId: "chat-1",
          sourceUserMessageId: "user-message-1",
          sourceUserMessageText: "skyline",
          sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
        },
        currentHistory: [],
        workerResult: {
          assistantText: "ready",
          artifacts: [{ type: "image", filename: null, fileRef: null, objectKey: null }]
        },
        failure: {
          code: null,
          message: "blocked",
          attemptCount: 1,
          maxAttempts: 3,
          retryable: false,
          stage: "execution"
        }
      } as RuntimeMediaJobCompletionRequest),
      /cannot carry both workerResult and failure/
    );
  });

  test("attaches vision image blocks when plan enables mediaCompletionVisionEnabled", async () => {
    const ctx = createCompletionService({
      downloadObject: async (objectKey: string) => {
        return objectKey === "runtime-output/out.png" ? Buffer.from("png-bytes") : null;
      }
    });

    const result = await ctx.service.complete({
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
              systemTool: {
                providerKey: "openai",
                modelKey: "gpt-5.4-medium"
              }
            }
          }
        },
        promptConstructor: {
          ordinary: {
            systemPrompt: "You are PersAI.",
            sections: {}
          }
        },
        persona: { displayName: "PersAI" },
        userContext: { locale: "en", timezone: "UTC" },
        governance: {
          toolPolicies: [
            {
              toolCode: "image_edit",
              mediaCompletionVisionEnabled: true
            }
          ]
        }
      }),
      job: {
        id: "job-vision-1",
        surface: "web",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "make the sky brighter",
        sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
        toolCode: "image_edit"
      },
      currentHistory: [],
      workerResult: {
        assistantText: "",
        artifacts: [
          {
            type: "image",
            filename: "out.png",
            fileRef: "file-out-1",
            objectKey: "runtime-output/out.png",
            mimeType: "image/png",
            role: "output"
          }
        ]
      }
    } satisfies RuntimeMediaJobCompletionRequest);

    assert.equal(result.assistantText, "Fresh completion framing.");
    assert.ok(ctx.providerRequest);
    const recordedProviderRequest = ctx.providerRequest as ProviderGatewayTextGenerateRequest;
    assert.equal(
      recordedProviderRequest.requestMetadata?.classification,
      "media_job_completion_vision"
    );
    const serializedMessages = JSON.stringify(recordedProviderRequest.messages);
    assert.match(serializedMessages, /"type":"image"/);
    assert.match(String(recordedProviderRequest.developerInstructions ?? ""), /job outputs only/);
    assert.equal(recordedProviderRequest.maxOutputTokens, 1000);
  });
});
