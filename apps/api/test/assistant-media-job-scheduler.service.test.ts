import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantMediaJobSchedulerService } from "../src/modules/workspace-management/application/assistant-media-job-scheduler.service";

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
        }
      }),
    assistantMediaJob: {
      updateMany: async (input: Record<string, unknown>) => {
        finalUpdates.push(input);
        return { count: 1 };
      }
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
    } as never
  );

  return { service, txUpdates, finalUpdates, createdMessages };
}

describe("AssistantMediaJobSchedulerService", () => {
  test("claims queued jobs and moves successful runs to completion_pending", async () => {
    const { service, txUpdates, finalUpdates } = createService();

    const processed = await service.processDueJobsBatch();

    assert.equal(processed, 1);
    assert.equal(txUpdates.length, 1);
    assert.equal(finalUpdates.length, 1);
    assert.equal(finalUpdates[0]?.where?.id, "job-1");
    assert.equal(finalUpdates[0]?.data?.status, "completion_pending");
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

  test("requeues retryable runtime failures with backoff", async () => {
    const { service, finalUpdates } = createService({
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
  });

  test("fails jobs immediately when runtime returns no deliverable artifacts", async () => {
    const { service, finalUpdates, createdMessages } = createService({
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
  });

  test("creates a user-visible policy explanation when the provider blocks the background job", async () => {
    const { service, finalUpdates, createdMessages } = createService({
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
});
