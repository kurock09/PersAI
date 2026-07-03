import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { describe, test } from "node:test";
import type {
  ProviderGatewayToolCall,
  RuntimeMediaJobRunRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { RuntimeMediaJobRunService } from "../src/modules/turns/runtime-media-job-run.service";

describe("RuntimeMediaJobRunService", () => {
  test("executes direct media tool requests without a second LLM run", async () => {
    let capturedToolCall: ProviderGatewayToolCall | null = null;
    let capturedSessionId: string | null = null;
    let acceptedRequest: RuntimeTurnRequest | null = null;
    let finalizedResult: RuntimeTurnResult | null = null;
    const service = new RuntimeMediaJobRunService(
      {
        executeToolCall: async (input: Record<string, unknown>) => {
          capturedToolCall = input.toolCall as ProviderGatewayToolCall;
          capturedSessionId = input.sessionId as string;
          return {
            payload: {
              toolCode: "image_generate",
              executionMode: "worker",
              provider: "openai",
              model: "gpt-image-1",
              prompt: "draw a sunset",
              revisedPrompt: null,
              requestedCount: 1,
              size: "1024x1024",
              artifacts: [{ artifactId: "artifact-1", kind: "image" }],
              usage: null,
              action: "generated",
              reason: null,
              warning: null
            },
            artifacts: [{ artifactId: "artifact-1", kind: "image" }],
            isError: false
          };
        }
      } as never,
      {} as never,
      {} as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => {
          acceptedRequest = input;
          return createAcceptedTurn(input);
        }
      } as never,
      {
        completeAcceptedTurn: async (_acceptedTurn: unknown, result: RuntimeTurnResult) => {
          finalizedResult = result;
          return { receiptStatus: "completed", session: {} as never, leaseReleased: true };
        },
        failAcceptedTurn: async () => {
          throw new Error("should not fail");
        }
      } as never
    );

    const result = await service.run(createRunRequest("draw a sunset"));

    assert.equal(result.assistantText, "");
    assert.deepEqual(result.artifacts, [{ artifactId: "artifact-1", kind: "image" }]);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0]?.name, "image_generate");
    assert.ok(acceptedRequest);
    const recordedAcceptedRequest = acceptedRequest as RuntimeTurnRequest;
    assert.match(recordedAcceptedRequest.requestId, /^media-job-run:job-1:/);
    assert.ok(capturedToolCall);
    const recordedToolCall = capturedToolCall as ProviderGatewayToolCall;
    assert.equal(recordedToolCall.name, "image_generate");
    assert.equal(capturedSessionId, "runtime-session-1");
    assert.ok(finalizedResult);
    const recordedFinalizedResult = finalizedResult as RuntimeTurnResult;
    assert.deepEqual(recordedFinalizedResult.artifacts, [
      { artifactId: "artifact-1", kind: "image" }
    ]);
  });

  test("fails image jobs honestly on provider safety rejection", async () => {
    const service = new RuntimeMediaJobRunService(
      {
        executeToolCall: async () => ({
          payload: {
            toolCode: "image_generate",
            executionMode: "worker",
            provider: "openai",
            model: "gpt-image-1",
            prompt: "make me superman",
            revisedPrompt: null,
            requestedCount: 1,
            size: "1024x1024",
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: "image_provider_safety_rejected",
            warning:
              "The provider rejected the original image prompt under its safety system. Request id req_safety_123."
          },
          artifacts: [],
          isError: true
        })
      } as never,
      {} as never,
      {} as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => createAcceptedTurn(input)
      } as never,
      {
        completeAcceptedTurn: async () => {
          throw new Error("should not complete");
        },
        failAcceptedTurn: async () => ({
          receiptStatus: "failed",
          session: {} as never,
          leaseReleased: true
        })
      } as never
    );

    await assert.rejects(
      () => service.run(createRunRequest("make me superman")),
      (error) => {
        assert.ok(error instanceof BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          error?: { code?: string; message?: string };
        };
        assert.equal(response.error?.code, "image_provider_safety_rejected");
        assert.match(response.error?.message ?? "", /safety system/i);
        return true;
      }
    );
  });

  test("replays a completed run result without re-executing the tool path", async () => {
    let executed = 0;
    const service = new RuntimeMediaJobRunService(
      {
        executeToolCall: async () => {
          executed += 1;
          throw new Error("should not execute");
        }
      } as never,
      {} as never,
      {} as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => ({
          outcome: "replayed",
          conversationKey: "conversation-key",
          session: createAcceptedTurn(input).session,
          receipt: {
            requestId: input.requestId,
            sessionId: "session-1",
            publishedVersionId: "version-1",
            status: "completed",
            bundleHash: "bundle-hash",
            resultPayload: {
              requestId: input.requestId,
              sessionId: "session-1",
              assistantText: "",
              artifacts: [
                {
                  artifactId: "artifact-1",
                  kind: "image",
                  billingFacts: {
                    providerKey: "openai",
                    modelKey: "gpt-image-1",
                    capability: "image",
                    occurredAt: "2026-05-05T09:00:01.000Z",
                    metering: {
                      meteringKind: "fixed_operation"
                    }
                  }
                }
              ],
              respondedAt: "2026-05-05T09:00:01.000Z",
              usage: null,
              toolInvocations: [
                { name: "image_generate", iteration: 1, ok: true, executionMode: "worker" }
              ]
            },
            errorCode: null,
            errorMessage: null,
            completedAt: "2026-05-05T09:00:01.000Z"
          }
        })
      } as never,
      {} as never
    );

    const result = await service.run(createRunRequest("draw a sunset"));

    assert.equal(executed, 0);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.billingFacts?.providerKey, "openai");
    assert.equal(result.rawText, null);
  });

  test("returns in-flight conflict instead of running a duplicate execution", async () => {
    let executed = 0;
    const service = new RuntimeMediaJobRunService(
      {
        executeToolCall: async () => {
          executed += 1;
          throw new Error("should not execute");
        }
      } as never,
      {} as never,
      {} as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async () => ({
          outcome: "in_flight",
          conversationKey: "conversation-key",
          session: createAcceptedTurn(createRunRequest("draw a sunset") as never).session,
          requestId: "media-job-run:job-1:existing"
        })
      } as never,
      {} as never
    );

    await assert.rejects(
      () => service.run(createRunRequest("draw a sunset")),
      (error) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.match(error.message, /already in flight/i);
        return true;
      }
    );
    assert.equal(executed, 0);
  });

  test("propagates accepted_primary_unconfirmed for video jobs to recovery path", async () => {
    const service = new RuntimeMediaJobRunService(
      {} as never,
      {} as never,
      {
        executeToolCall: async () => ({
          payload: {
            toolCode: "video_generate",
            executionMode: "worker",
            provider: "kling",
            model: "kling-v3",
            prompt: "make a teaser",
            requestedSeconds: 4,
            requestedAudioMode: "silent",
            requestedInputMode: "text",
            size: "1280x720",
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "accepted_primary_unconfirmed",
            warning: "Provider accepted the video task, but polling continuity was lost.",
            providerStatus: {
              providerTaskId: "task_kling_123",
              provider: "kling",
              model: "kling-v3",
              acceptedAt: "2026-06-02T12:00:00.000Z",
              providerStage: "accepted"
            }
          },
          artifacts: [],
          isError: true
        })
      } as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => createAcceptedTurn(input)
      } as never,
      {
        completeAcceptedTurn: async () => {
          throw new Error("should not complete");
        },
        failAcceptedTurn: async () => ({
          receiptStatus: "failed",
          session: {} as never,
          leaseReleased: true
        })
      } as never
    );

    const request = createRunRequest("make a teaser");
    request.job.kind = "video";
    request.directToolExecution = {
      toolCode: "video_generate",
      request: {
        toolCode: "video_generate",
        prompt: "make a teaser",
        filename: null,
        size: "1280x720",
        seconds: 4,
        referenceImageAlias: null
      }
    };

    await assert.rejects(
      () => service.run(request),
      (error) => {
        assert.ok(error instanceof ServiceUnavailableException);
        const response = (error as ServiceUnavailableException).getResponse() as {
          error?: { code?: string; providerStatus?: { providerTaskId?: string } };
        };
        assert.equal(response.error?.code, "accepted_primary_unconfirmed");
        assert.equal(response.error?.providerStatus?.providerTaskId, "task_kling_123");
        return true;
      }
    );
  });

  test("treats requested_mode_unsupported video jobs as honest bad requests", async () => {
    const service = new RuntimeMediaJobRunService(
      {} as never,
      {} as never,
      {
        executeToolCall: async () => ({
          payload: {
            toolCode: "video_generate",
            executionMode: "worker",
            provider: "runway",
            model: "gen4_turbo",
            prompt: "make a narrated teaser",
            requestedSeconds: 5,
            requestedAudioMode: "provider_native_audio",
            requestedInputMode: "text",
            size: "1280x720",
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "requested_mode_unsupported",
            warning:
              "The selected video model does not support provider-native audio, so this request cannot be run honestly as an audio-capable video."
          },
          artifacts: [],
          isError: true
        })
      } as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => createAcceptedTurn(input)
      } as never,
      {
        completeAcceptedTurn: async () => {
          throw new Error("should not complete");
        },
        failAcceptedTurn: async () => ({
          receiptStatus: "failed",
          session: {} as never,
          leaseReleased: true
        })
      } as never
    );

    const request = createRunRequest("make a narrated teaser");
    request.job.kind = "video";
    request.directToolExecution = {
      toolCode: "video_generate",
      request: {
        toolCode: "video_generate",
        prompt: "make a narrated teaser",
        filename: null,
        size: "1280x720",
        seconds: 5,
        audioMode: "provider_native_audio",
        inputMode: "text",
        referenceImageAlias: null
      }
    };

    await assert.rejects(
      () => service.run(request),
      (error) => {
        assert.ok(error instanceof BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          error?: { code?: string; message?: string };
        };
        assert.equal(response.error?.code, "requested_mode_unsupported");
        assert.match(response.error?.message ?? "", /does not support provider-native audio/i);
        return true;
      }
    );
  });

  test("treats invalid_arguments image jobs as non-retryable bad requests", async () => {
    // Mirrors the video NON_RETRYABLE_IMAGE_REASONS contract: a persisted
    // image job whose stored request shape no longer matches the parser
    // whitelist (e.g. ADR-117 cleanup dropped a legacy field) must surface as
    // a terminal 400 immediately instead of looping through the
    // exponential-backoff retry budget for ~7.5 min.
    const service = new RuntimeMediaJobRunService(
      {} as never,
      {
        executeToolCall: async () => ({
          payload: {
            toolCode: "image_edit",
            executionMode: "worker",
            provider: null,
            model: null,
            prompt: null,
            revisedPrompt: null,
            requestedCount: null,
            sourceImageAlias: null,
            referenceImageAliases: null,
            sourceFilename: null,
            referenceFilenames: null,
            size: null,
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: "invalid_arguments",
            warning: "Unexpected arguments: referenceImageAlias"
          },
          artifacts: [],
          isError: true
        })
      } as never,
      {} as never,
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        acceptTurn: async (input: RuntimeTurnRequest) => createAcceptedTurn(input)
      } as never,
      {
        completeAcceptedTurn: async () => {
          throw new Error("should not complete");
        },
        failAcceptedTurn: async () => ({
          receiptStatus: "failed",
          session: {} as never,
          leaseReleased: true
        })
      } as never
    );

    const request = createRunRequest("edit this image");
    request.directToolExecution = {
      toolCode: "image_edit",
      request: {
        toolCode: "image_edit",
        prompt: "edit this image",
        count: 1,
        filename: null,
        size: null,
        background: "auto",
        sourceImageAlias: "image #1",
        referenceImageAliases: null
      }
    };

    await assert.rejects(
      () => service.run(request),
      (error) => {
        assert.ok(
          error instanceof BadRequestException,
          "invalid_arguments image jobs must surface as non-retryable BadRequest"
        );
        const response = (error as BadRequestException).getResponse() as {
          error?: { code?: string; message?: string };
        };
        assert.equal(response.error?.code, "invalid_arguments");
        assert.match(response.error?.message ?? "", /Unexpected arguments/);
        return true;
      }
    );
  });

  test("treats model-correctable video request errors as non-retryable bad requests", async () => {
    for (const reason of ["invalid_arguments", "portrait_alias_unavailable"] as const) {
      const service = new RuntimeMediaJobRunService(
        {} as never,
        {} as never,
        {
          executeToolCall: async () => ({
            payload: {
              toolCode: "video_generate",
              executionMode: "worker",
              provider: "heygen",
              model: "avatar_v",
              prompt: "make an ordinary video",
              requestedSeconds: null,
              requestedAudioMode: null,
              requestedInputMode: null,
              requestedMode: "talking_avatar",
              requestedSpeechText: reason === "invalid_arguments" ? "" : "Hello.",
              requestedSpeechLanguage: "en-US",
              requestedPersonaId: null,
              requestedPortraitImageAlias: "image #99",
              requestedVoiceKey: "voice-1",
              requestedTalkingAvatarAspectRatio: "9:16",
              size: null,
              referenceImageAlias: null,
              referenceFilename: null,
              artifact: null,
              usage: null,
              action: "skipped",
              reason,
              warning:
                reason === "invalid_arguments"
                  ? "speechText must be a non-empty string when provided."
                  : 'Portrait alias "image #99" does not match any available image attachment.'
            },
            artifacts: [],
            isError: true
          })
        } as never,
        new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
        {
          acceptTurn: async (input: RuntimeTurnRequest) => createAcceptedTurn(input)
        } as never,
        {
          completeAcceptedTurn: async () => {
            throw new Error("should not complete");
          },
          failAcceptedTurn: async () => ({
            receiptStatus: "failed",
            session: {} as never,
            leaseReleased: true
          })
        } as never
      );

      const request = createRunRequest("make an ordinary video");
      request.job.kind = "video";
      request.directToolExecution = {
        toolCode: "video_generate",
        request: {
          toolCode: "video_generate",
          prompt: "make an ordinary video",
          filename: null,
          size: null,
          seconds: null,
          referenceImageAlias: null,
          mode: "talking_avatar",
          speechText: reason === "invalid_arguments" ? "" : "Hello.",
          speechLanguage: "en-US",
          portraitImageAlias: "image #99",
          voiceKey: "voice-1"
        }
      };

      await assert.rejects(
        () => service.run(request),
        (error) => {
          assert.ok(error instanceof BadRequestException);
          const response = (error as BadRequestException).getResponse() as {
            error?: { code?: string; message?: string };
          };
          assert.equal(response.error?.code, reason);
          assert.match(response.error?.message ?? "", /speechText|Portrait alias/);
          return true;
        }
      );
    }
  });
});

function createRunRequest(prompt: string): RuntimeMediaJobRunRequest {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    runtimeSessionId: "runtime-session-1",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: JSON.stringify({
      metadata: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        publishedVersionId: "version-1"
      },
      runtime: {},
      promptConstructor: {},
      userContext: {
        locale: "en",
        timezone: "UTC"
      }
    }),
    job: {
      id: "job-1",
      surface: "web",
      kind: "image",
      chatId: "chat-1",
      sourceUserMessageId: "user-message-1",
      sourceUserMessageText: prompt,
      sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
    },
    attachments: [],
    directToolExecution: {
      toolCode: "image_generate",
      request: {
        toolCode: "image_generate",
        prompt,
        count: 1,
        filename: null,
        size: "1024x1024",
        background: "auto"
      }
    }
  };
}

function createAcceptedTurn(input: RuntimeTurnRequest) {
  return {
    outcome: "accepted" as const,
    conversationKey: "conversation-key",
    session: {
      sessionId: "session-1",
      runtimeTier: "paid_shared_restricted" as const,
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
      status: "accepted" as const,
      bundleHash: "bundle-hash",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    },
    lease: {} as never
  };
}
