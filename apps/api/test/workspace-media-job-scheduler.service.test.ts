import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantMediaJobSchedulerService } from "../src/modules/workspace-management/application/workspace-media-job-scheduler.service";

class FakeSchedulerLeaseService {
  acquireResult: { token: string } | null = { token: "lease-media-1" };
  heartbeatResults: boolean[] = [];
  releaseCalls: Array<{ key: string; token: string }> = [];
  leaseState: { holderId: string; expiresAt: Date } | null = {
    holderId: "",
    expiresAt: new Date(Date.now() - 1)
  };

  async getLeaseState() {
    return this.leaseState;
  }

  async acquire() {
    return this.acquireResult;
  }

  async heartbeat() {
    return this.heartbeatResults.shift() ?? true;
  }

  async release(key: string, token: string) {
    this.releaseCalls.push({ key, token });
  }
}

class FakeBackgroundSchedulerMetricsService {
  tickAcquired: Array<{ key: string; durationMs: number; candidatesProcessed: number }> = [];
  tickSkipped: string[] = [];
  leaseLost: string[] = [];
  leaseExpiredRecovered: string[] = [];

  recordTickAcquired(key: string, durationMs: number, candidatesProcessed: number): void {
    this.tickAcquired.push({ key, durationMs, candidatesProcessed });
  }

  recordTickSkipped(key: string): void {
    this.tickSkipped.push(key);
  }

  recordLeaseLost(key: string): void {
    this.leaseLost.push(key);
  }

  recordLeaseExpiredRecovered(key: string): void {
    this.leaseExpiredRecovered.push(key);
  }
}

function createService(overrides?: {
  queryRows?: Array<Record<string, unknown>>;
  recoveredFiles?: Array<Record<string, unknown>>;
  runResult?: Awaited<
    ReturnType<InstanceType<typeof AssistantMediaJobSchedulerService>["processDueJobsBatch"]>
  >;
  runtimeOutcome?:
    | {
        ok: true;
        result: {
          assistantText: string;
          artifacts: Array<Record<string, unknown>>;
          usage: null;
          billingFacts?: Record<string, unknown> | null;
          toolInvocations: Array<Record<string, unknown>>;
          rawText: string | null;
        };
      }
    | {
        ok: false;
        retryable: boolean;
        status: number | null;
        code: string | null;
        message: string;
      };
  schedulerLeaseService?: FakeSchedulerLeaseService;
  backgroundSchedulerMetricsService?: FakeBackgroundSchedulerMetricsService;
}) {
  const txUpdates: Array<Record<string, unknown>> = [];
  const finalUpdates: Array<Record<string, unknown>> = [];
  const createdMessages: Array<Record<string, unknown>> = [];
  const releaseCalls: Array<Record<string, unknown>> = [];
  const outboundCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
      callback({
        $queryRaw: async () =>
          overrides?.queryRows ?? [
            {
              id: "job-1",
              assistantId: "assistant-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              chatId: "chat-1",
              surface: "web",
              kind: "image",
              sourceUserMessageId: "user-message-1",
              requestJson: {
                attachments: [],
                sourceUserMessageText: "draw a sunset",
                sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                directToolExecution: {
                  toolCode: "image_generate",
                  request: {
                    toolCode: "image_generate",
                    prompt: "draw a sunset",
                    count: 1,
                    filename: null,
                    size: "1024x1024",
                    background: "auto"
                  }
                }
              },
              attemptCount: 0,
              maxAttempts: 5
            }
          ],
        assistantMediaJob: {
          update: async (input: Record<string, unknown>) => {
            txUpdates.push(input);
          }
        },
        assistantFile: {
          findMany: async () => overrides?.recoveredFiles ?? []
        }
      }),
    assistantMediaJob: {
      updateMany: async (input: Record<string, unknown>) => {
        finalUpdates.push(input);
        return { count: 1 };
      }
    },
    assistantFile: {
      findMany: async () => overrides?.recoveredFiles ?? []
    }
  };

  const service = new AssistantMediaJobSchedulerService(
    prisma as never,
    {
      findById: async () => ({ id: "assistant-1" })
    } as never,
    {
      createMessage: async (input: Record<string, unknown>) => {
        createdMessages.push(input);
        return {
          id: `assistant-message-${createdMessages.length}`,
          chatId: input.chatId,
          assistantId: input.assistantId,
          content: input.content,
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        };
      }
    } as never,
    {
      resolveCurrent: async () => ({
        runtimeBundleDocument: JSON.stringify({
          metadata: {
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            publishedVersionId: "version-1"
          },
          runtime: {},
          promptConstructor: {},
          userContext: { locale: "en", timezone: "UTC" }
        })
      })
    } as never,
    {
      resolveByAssistantId: async () => ({
        runtimeTier: "paid_shared_restricted"
      })
    } as never,
    {
      run: async () =>
        overrides?.runtimeOutcome ?? {
          ok: true,
          result: {
            assistantText: "Your image is ready.",
            artifacts: [{ artifactId: "artifact-1", kind: "image" }],
            usage: null,
            billingFacts: {
              providerKey: "openai",
              modelKey: "gpt-image-1",
              capability: "image",
              occurredAt: "2026-05-05T09:05:00.000Z",
              metering: {
                meteringKind: "token_metered",
                inputTokens: 30,
                cachedInputTokens: null,
                outputTokens: 60,
                totalTokens: 90,
                dimensions: { operation: "generate" }
              }
            },
            toolInvocations: [{ name: "image_generate", iteration: 1, ok: true }],
            rawText: "Your image is ready."
          }
        }
    } as never,
    {
      processPendingBatch: async () => 0
    } as never,
    {
      maybeFrameFailure: async () => null
    } as never,
    (overrides?.schedulerLeaseService ?? new FakeSchedulerLeaseService()) as never,
    (overrides?.backgroundSchedulerMetricsService ??
      new FakeBackgroundSchedulerMetricsService()) as never,
    {
      async recordPersistedBillingFactsEvent() {
        return 0;
      }
    } as never,
    {
      async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
        releaseCalls.push(input);
      }
    } as never,
    {
      async deliverPersistedAssistantMessageBestEffort(input: Record<string, unknown>) {
        outboundCalls.push(input);
        return undefined;
      }
    } as never
  );

  return { service, txUpdates, finalUpdates, createdMessages, releaseCalls, outboundCalls };
}

describe("AssistantMediaJobSchedulerService", () => {
  test("claims queued jobs and moves successful runs to completion_pending", async () => {
    const { service, txUpdates, finalUpdates, releaseCalls } = createService();

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(txUpdates.length, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.where?.id, "job-1");
    assert.equal(finalUpdates[0]?.data?.status, "completion_pending");
    // ADR-105 §5: success path is resolved by the delivery loop, never by
    // failJob — the scheduler must NOT release on success.
    assert.equal(releaseCalls.length, 0);
    assert.equal(finalUpdates[0]?.data?.resultText, "Your image is ready.");
    assert.deepEqual(finalUpdates[0]?.data?.artifactsJson, [
      { artifactId: "artifact-1", kind: "image" }
    ]);
    assert.deepEqual(finalUpdates[0]?.data?.billingFactsJson, {
      providerKey: "openai",
      modelKey: "gpt-image-1",
      capability: "image",
      occurredAt: "2026-05-05T09:05:00.000Z",
      metering: {
        meteringKind: "token_metered",
        inputTokens: 30,
        cachedInputTokens: null,
        outputTokens: 60,
        totalTokens: 90,
        dimensions: { operation: "generate" }
      }
    });
  });

  test("persists video billing facts unchanged for audio-capable provider rows", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-video-success-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "video",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "make a storm clip with natural audio",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                prompt: "make a storm clip with natural audio",
                filename: null,
                size: "1280x720",
                seconds: 4,
                audioMode: "provider_native_audio",
                inputMode: "text",
                referenceImageAlias: null
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: true,
        result: {
          assistantText: "",
          artifacts: [{ artifactId: "artifact-video-1", kind: "video" }],
          usage: null,
          billingFacts: {
            providerKey: "runway",
            modelKey: "veo3.1",
            capability: "video",
            occurredAt: "2026-06-02T18:00:00.000Z",
            metering: {
              meteringKind: "time_metered",
              durationMs: 4_000,
              durationSeconds: 4
            }
          },
          toolInvocations: [{ name: "video_generate", iteration: 1, ok: true }],
          rawText: null
        }
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "completion_pending");
    assert.deepEqual(finalUpdates[0]?.data?.billingFactsJson, {
      providerKey: "runway",
      modelKey: "veo3.1",
      capability: "video",
      occurredAt: "2026-06-02T18:00:00.000Z",
      metering: {
        meteringKind: "time_metered",
        durationMs: 4_000,
        durationSeconds: 4
      }
    });
    assert.equal(releaseCalls.length, 0);
  });

  test("requeues retryable runtime failures with backoff", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      runtimeOutcome: {
        ok: false,
        retryable: true,
        status: 503,
        code: "runtime_unavailable",
        message: "runtime temporarily unavailable"
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "queued");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "runtime_unavailable");
    assert.ok(finalUpdates[0]?.data?.nextRetryAt instanceof Date);
    // ADR-105 §5: a retryable requeue holds the reservation across attempts —
    // the scheduler must NOT release here (that would multi-release the shared
    // aggregate counter across retries).
    assert.equal(releaseCalls.length, 0);
  });

  test("requeues accepted primary video tasks without fallback and persists recovery task state", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-video-accepted-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "video",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "make a clip",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                prompt: "make a clip",
                filename: null,
                size: "1280x720",
                seconds: 4,
                referenceImageAlias: null
              }
            }
          },
          attemptCount: 1,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: false,
        retryable: true,
        status: 503,
        code: "accepted_primary_unconfirmed",
        message:
          'Provider accepted the video task. PERSAI_VIDEO_ACCEPTED_PRIMARY_UNCONFIRMED::{"providerTaskId":"task_kling_accepted_1","provider":"kling","model":"kling-v3","acceptedAt":"2026-06-02T12:00:00.000Z","providerStage":"accepted","code":"accepted_primary_unconfirmed","reason":"provider accepted but polling transport lost","message":"fetch failed","taskKind":"image2video"}',
        providerStatus: {
          providerTaskId: "task_kling_accepted_1",
          provider: "kling",
          model: "kling-v3",
          acceptedAt: "2026-06-02T12:00:00.000Z",
          providerStage: "accepted",
          code: "accepted_primary_unconfirmed",
          reason: "provider accepted but polling transport lost",
          message: "fetch failed",
          taskKind: "image2video"
        }
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "queued");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "accepted_primary_unconfirmed");
    assert.equal(releaseCalls.length, 0);
    const requestJson = finalUpdates[0]?.data?.requestJson as
      | {
          directToolExecution?: {
            request?: {
              acceptedProviderTask?: { providerTaskId?: string; providerStage?: string };
            };
          };
        }
      | undefined;
    assert.equal(
      requestJson?.directToolExecution?.request?.acceptedProviderTask?.providerTaskId,
      "task_kling_accepted_1"
    );
    assert.equal(
      requestJson?.directToolExecution?.request?.acceptedProviderTask?.providerStage,
      "accepted"
    );
  });

  test("requeues accepted primary HeyGen video tasks and persists recovery task state", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-video-accepted-heygen-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "video",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "make a talking avatar clip",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                mode: "talking_avatar",
                prompt: "Talking-avatar render",
                speechText: "PersAI demo",
                portraitImageAlias: "portrait-1"
              }
            }
          },
          attemptCount: 1,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: false,
        retryable: true,
        status: 503,
        code: "accepted_primary_unconfirmed",
        message:
          'Provider accepted the video task. PERSAI_VIDEO_ACCEPTED_PRIMARY_UNCONFIRMED::{"providerTaskId":"task_heygen_accepted_1","provider":"heygen","model":"avatar_v","acceptedAt":"2026-06-02T12:00:00.000Z","providerStage":"accepted","code":"accepted_primary_unconfirmed","reason":"provider accepted but polling transport lost","message":"fetch failed","taskKind":"talking_avatar"}',
        providerStatus: {
          providerTaskId: "task_heygen_accepted_1",
          provider: "heygen",
          model: "avatar_v",
          acceptedAt: "2026-06-02T12:00:00.000Z",
          providerStage: "accepted",
          code: "accepted_primary_unconfirmed",
          reason: "provider accepted but polling transport lost",
          message: "fetch failed",
          taskKind: "talking_avatar"
        }
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "queued");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "accepted_primary_unconfirmed");
    assert.equal(releaseCalls.length, 0);
    const requestJson = finalUpdates[0]?.data?.requestJson as
      | {
          directToolExecution?: {
            request?: {
              acceptedProviderTask?: {
                providerTaskId?: string;
                providerStage?: string;
                provider?: string;
              };
            };
          };
        }
      | undefined;
    assert.equal(
      requestJson?.directToolExecution?.request?.acceptedProviderTask?.providerTaskId,
      "task_heygen_accepted_1"
    );
    assert.equal(
      requestJson?.directToolExecution?.request?.acceptedProviderTask?.providerStage,
      "accepted"
    );
    assert.equal(
      requestJson?.directToolExecution?.request?.acceptedProviderTask?.provider,
      "heygen"
    );
  });

  test("fails jobs immediately when runtime returns no deliverable artifacts", async () => {
    const { service, finalUpdates, createdMessages, releaseCalls } = createService({
      runtimeOutcome: {
        ok: true,
        result: {
          assistantText: "",
          artifacts: [],
          usage: null,
          billingFacts: null,
          toolInvocations: [{ name: "image_edit", iteration: 1, ok: true }],
          rawText: null
        }
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "media_job_artifacts_missing");
    assert.equal(finalUpdates[0]?.data?.completionAssistantMessageId, "assistant-message-1");
    assert.match(
      String(createdMessages[0]?.content),
      /couldn't finish the image request in the background/i
    );
    // ADR-105 §5: worker-execution terminal failure — failJob releases the full
    // reserved N (= count = 1) exactly once. The worker no longer releases.
    assert.equal(releaseCalls.length, 1);
    assert.deepEqual(releaseCalls[0], {
      assistant: { id: "assistant-1" },
      toolCode: "image_generate",
      units: 1
    });
  });

  test("moves partial artifact outcomes to completion_pending instead of terminal failure", async () => {
    const { service, finalUpdates, createdMessages, releaseCalls } = createService({
      runtimeOutcome: {
        ok: true,
        result: {
          assistantText: "",
          artifacts: [
            { artifactId: "artifact-1", kind: "image" },
            { artifactId: "artifact-2", kind: "image" }
          ],
          usage: null,
          billingFacts: null,
          toolInvocations: [{ name: "image_edit", iteration: 1, ok: true }],
          rawText: null
        }
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "completion_pending");
    assert.deepEqual(finalUpdates[0]?.data?.artifactsJson, [
      { artifactId: "artifact-1", kind: "image" },
      { artifactId: "artifact-2", kind: "image" }
    ]);
    assert.equal(createdMessages.length, 0);
    assert.equal(releaseCalls.length, 0);
  });

  test("creates a user-visible policy explanation when the provider blocks the background job", async () => {
    const { service, finalUpdates, createdMessages, releaseCalls } = createService({
      runtimeOutcome: {
        ok: false,
        retryable: false,
        status: 400,
        code: "content_policy_violation",
        message: "Blocked by provider safety policy."
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "content_policy_violation");
    assert.equal(finalUpdates[0]?.data?.completionAssistantMessageId, "assistant-message-1");
    assert.match(
      String(createdMessages[0]?.content),
      /blocked the request under its safety policy/i
    );
    // ADR-105 §5: terminal worker failure (incl. content_policy_violation /
    // image_provider_safety_rejected) releases the reserved N once via failJob.
    assert.equal(releaseCalls.length, 1);
    assert.deepEqual(releaseCalls[0], {
      assistant: { id: "assistant-1" },
      toolCode: "image_generate",
      units: 1
    });
  });

  test("releases the full reserved count once on a pre-execution invalid payload failure", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-invalid-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          // Missing sourceUserMessageText / sourceUserMessageCreatedAt -> parse
          // fails -> invalid_request_payload. directToolExecution still carries
          // the reserved count so failJob can release exactly N.
          requestJson: {
            attachments: [],
            directToolExecution: {
              toolCode: "image_generate",
              request: {
                toolCode: "image_generate",
                prompt: "draw three sunsets",
                count: 3,
                filename: null,
                size: "1024x1024",
                background: "auto"
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ]
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "invalid_request_payload");
    // ADR-105 §5: pre-execution failure (worker never ran) releases the full
    // reserved N (= count = 3) exactly once.
    assert.equal(releaseCalls.length, 1);
    assert.deepEqual(releaseCalls[0], {
      assistant: { id: "assistant-1" },
      toolCode: "image_generate",
      units: 3
    });
  });

  test("ADR-108 Slice 8 — video_generate no longer reserves a monthly unit, so terminal failure releases nothing", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-video-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "video",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "make a clip",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                prompt: "make a clip",
                filename: null,
                size: "720x1280",
                seconds: 4,
                referenceImageAlias: null
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: false,
        retryable: false,
        status: 500,
        code: "video_generation_failed",
        message: "provider exploded"
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    // ADR-108 Slice 8 — `video_generate` is VC-priced; no monthly unit
    // is reserved at enqueue, so a terminal failure has nothing to
    // release on the legacy unit-counter path.
    assert.equal(releaseCalls.length, 0);
  });

  test("fails unsupported video audio/input requests terminally instead of requeueing them", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-video-unsupported-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "video",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "make a narrated teaser with built-in speech",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                prompt: "make a narrated teaser with built-in speech",
                filename: null,
                size: "1280x720",
                seconds: 5,
                audioMode: "provider_native_audio",
                inputMode: "text",
                referenceImageAlias: null
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: false,
        retryable: false,
        status: 400,
        code: "requested_mode_unsupported",
        message:
          "The selected video model does not support provider-native audio, so this request cannot be run honestly as an audio-capable video."
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "requested_mode_unsupported");
    assert.equal(finalUpdates[0]?.data?.nextRetryAt, undefined);
    // ADR-108 Slice 8 — `video_generate` no longer reserves a monthly
    // unit, so a terminal-mode-unsupported failure has nothing to
    // release on the legacy unit-counter path.
    assert.equal(releaseCalls.length, 0);
  });

  test("does not process claimed rows when userId is missing from the claim query", async () => {
    const { service, txUpdates } = createService({
      queryRows: [
        {
          id: "job-missing-user",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "draw a sunset",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "image_generate",
              request: { prompt: "sunset" }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ]
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 0);
    assert.equal(txUpdates.length, 1);
    assert.equal(txUpdates[0]?.data?.status, "running");
  });

  test("passes direct tool execution payloads through to runtime", async () => {
    let capturedRunInput: Record<string, unknown> | null = null;
    const { service } = createService({
      queryRows: [
        {
          id: "job-direct-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "draw a sunset",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "image_generate",
              request: {
                toolCode: "image_generate",
                prompt: "draw a sunset",
                count: 1,
                filename: null,
                size: "1024x1024",
                background: "auto"
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: true,
        result: {
          assistantText: "",
          artifacts: [{ artifactId: "artifact-1", kind: "image" }],
          usage: null,
          billingFacts: null,
          toolInvocations: [{ name: "image_generate", iteration: 1, ok: true }],
          rawText: null
        }
      }
    });
    (
      service as unknown as {
        internalRuntimeMediaJobClientService: {
          run: (input: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).internalRuntimeMediaJobClientService.run = async (input: Record<string, unknown>) => {
      capturedRunInput = input;
      return {
        ok: true,
        result: {
          assistantText: "",
          artifacts: [{ artifactId: "artifact-1", kind: "image" }],
          usage: null,
          billingFacts: null,
          toolInvocations: [{ name: "image_generate", iteration: 1, ok: true }],
          rawText: null
        }
      };
    };

    await service.processDueJobsBatch();

    assert.equal(
      capturedRunInput?.directToolExecution &&
        (capturedRunInput.directToolExecution as { toolCode?: string }).toolCode,
      "image_generate"
    );
  });

  test("tick exits silently when another leader owns the lease", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = null;
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const { service } = createService({
      schedulerLeaseService: leaseService,
      backgroundSchedulerMetricsService: metricsService
    });

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueJobsBatch: () => Promise<number> }).processDueJobsBatch =
      async () => {
        throw new Error("tick should not process jobs when another leader owns the lease");
      };

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.deepEqual(metricsService.tickSkipped, ["media_job"]);
    assert.equal(leaseService.releaseCalls.length, 0);
  });

  test("tick aborts further drain after lease loss", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = { token: "lease-media-1" };
    leaseService.heartbeatResults = [false];
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const { service } = createService({
      schedulerLeaseService: leaseService,
      backgroundSchedulerMetricsService: metricsService
    });
    let batchCalls = 0;

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueJobsBatch: () => Promise<number> }).processDueJobsBatch =
      async () => {
        batchCalls += 1;
        if (batchCalls === 1) {
          (
            service as unknown as {
              leaseLost: boolean;
            }
          ).leaseLost = true;
          metricsService.recordLeaseLost("media_job");
        }
        return 4;
      };
    (
      service as unknown as {
        assistantMediaJobCompletionDeliveryService: { processPendingBatch: () => Promise<number> };
      }
    ).assistantMediaJobCompletionDeliveryService.processPendingBatch = async () => 0;

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.equal(batchCalls, 1);
    assert.deepEqual(metricsService.leaseLost, ["media_job"]);
    assert.equal(metricsService.tickAcquired[0]?.candidatesProcessed, 4);
    assert.deepEqual(leaseService.releaseCalls, [{ key: "media_job", token: "lease-media-1" }]);
  });

  test("ADR-127 W4 — storagePath attachment is accepted by scheduler validator", async () => {
    const { service, finalUpdates } = createService({
      queryRows: [
        {
          id: "job-w4-sp",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [
              {
                attachmentId: "att-sp-1",
                kind: "image",
                storagePath: "/shared/input/photo.jpg",
                mimeType: "image/jpeg",
                displayName: "photo.jpg",
                sizeBytes: 1024
              }
            ],
            sourceUserMessageText: "edit this photo",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "image_generate",
              request: {
                toolCode: "image_generate",
                prompt: "draw a sunset",
                count: 1,
                filename: null,
                size: "1024x1024",
                background: "auto"
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ]
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(
      finalUpdates[0]?.data?.status,
      "completion_pending",
      "ADR-127 W4: storagePath attachment must pass scheduler validator"
    );
  });

  test("ADR-127 W4 — objectKey-only attachment is rejected by scheduler validator", async () => {
    const { service, finalUpdates, releaseCalls } = createService({
      queryRows: [
        {
          id: "job-w4-ok",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [
              {
                attachmentId: "att-ok-1",
                kind: "image",
                objectKey: "assistant-media/foo.jpg",
                mimeType: "image/jpeg",
                displayName: "foo.jpg",
                sizeBytes: 1024
              }
            ],
            sourceUserMessageText: "edit this photo",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "image_generate",
              request: {
                toolCode: "image_generate",
                prompt: "draw a sunset",
                count: 1,
                filename: null,
                size: "1024x1024",
                background: "auto"
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ]
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(
      finalUpdates[0]?.data?.status,
      "failed",
      "ADR-127 W4: objectKey-only attachment must fail scheduler validation"
    );
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "invalid_request_payload");
    assert.equal(releaseCalls.length, 1, "failJob releases the reserved unit on invalid payload");
  });

  test("ADR-127 W4 — mixed attachments (one valid, one objectKey-only) are rejected by scheduler validator", async () => {
    const { service, finalUpdates } = createService({
      queryRows: [
        {
          id: "job-w4-mixed",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          surface: "web",
          kind: "image",
          sourceUserMessageId: "user-message-1",
          requestJson: {
            attachments: [
              {
                attachmentId: "att-mixed-good",
                kind: "image",
                storagePath: "/shared/input/good.jpg",
                mimeType: "image/jpeg",
                displayName: "good.jpg",
                sizeBytes: 1024
              },
              {
                attachmentId: "att-mixed-bad",
                kind: "image",
                objectKey: "assistant-media/bad.jpg",
                mimeType: "image/jpeg",
                displayName: "bad.jpg",
                sizeBytes: 2048
              }
            ],
            sourceUserMessageText: "combine these",
            sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
            directToolExecution: {
              toolCode: "image_generate",
              request: {
                toolCode: "image_generate",
                prompt: "draw a sunset",
                count: 1,
                filename: null,
                size: "1024x1024",
                background: "auto"
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ]
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(
      finalUpdates[0]?.data?.status,
      "failed",
      "ADR-127 W4: any objectKey-only element must fail scheduler validation"
    );
    assert.equal(finalUpdates[0]?.data?.lastErrorCode, "invalid_request_payload");
  });

  test("pushes telegram failure notice when scheduler failJob runs on telegram surface", async () => {
    const { service, finalUpdates, outboundCalls } = createService({
      queryRows: [
        {
          id: "job-tg-fail-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          chatId: "chat-telegram-fail-1",
          surface: "telegram",
          kind: "video",
          sourceUserMessageId: "user-message-tg-fail-1",
          requestJson: {
            attachments: [],
            sourceUserMessageText: "сделай talking avatar",
            sourceUserMessageCreatedAt: "2026-06-13T09:00:00.000Z",
            directToolExecution: {
              toolCode: "video_generate",
              request: {
                toolCode: "video_generate",
                prompt: "сделай talking avatar",
                provider: "heygen",
                durationSeconds: 8
              }
            }
          },
          attemptCount: 0,
          maxAttempts: 5
        }
      ],
      runtimeOutcome: {
        ok: false,
        retryable: false,
        status: 500,
        code: "heygen_job_failed",
        message: "Avatar generation failed."
      }
    });

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates[0]?.data?.status, "failed");
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0]?.assistantMessageId, "assistant-message-1");
    assert.equal(outboundCalls[0]?.chatId, "chat-telegram-fail-1");
    assert.match(String(outboundCalls[0]?.text), /видео|video|couldn't|не удалось/i);
  });
});
