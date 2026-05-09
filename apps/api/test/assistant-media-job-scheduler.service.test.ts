import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantMediaJobSchedulerService } from "../src/modules/workspace-management/application/assistant-media-job-scheduler.service";

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
            toolInvocations: [{ name: "image_generate", iteration: 1, ok: true }],
            rawText: "Your image is ready."
          }
        }
    } as never,
    {
      processPendingBatch: async () => 0
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

  test("passes direct tool execution payloads through to runtime", async () => {
    let capturedRunInput: Record<string, unknown> | null = null;
    const { service } = createService({
      queryRows: [
        {
          id: "job-direct-1",
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
});
