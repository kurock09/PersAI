import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { WebRuntimeStreamClientService } from "../src/modules/workspace-management/application/web-runtime-stream-client.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";

const ORIGINAL_ENV = process.env;
const WEB_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/session-1";

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_STREAM_TIMEOUT_MS: "9000",
    ...overrides
  };
}

function createMaterializedSpec() {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish",
    algorithmVersion: 72,
    materializedAtConfigGeneration: 1,
    layers: {},
    runtimeBundle: {},
    assistantConfig: {},
    assistantWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: "{}",
    runtimeBundleHash: "bundle-hash-1",
    assistantConfigDocument: "{}",
    assistantWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    createdAt: new Date("2026-04-11T12:59:00.000Z")
  };
}

async function collectChunks(
  generator: AsyncGenerator<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("WebRuntimeStreamClientService", () => {
  test("builds a web runtime stream request and maps runtime events", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedBody = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : null;
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1"
          }),
          JSON.stringify({
            type: "text_delta",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            delta: "hello",
            accumulatedText: "hello"
          }),
          JSON.stringify({
            type: "tool_started",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            toolCallId: "tool-1",
            toolName: "summarize_context"
          }),
          JSON.stringify({
            type: "tool_finished",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            toolCallId: "tool-1",
            toolName: "summarize_context",
            isError: false
          }),
          JSON.stringify({
            type: "artifact",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            artifact: {
              artifactId: "artifact-1",
              kind: "image",
              storagePath: `${WEB_SESSION_ROOT}/stream.png`,
              mimeType: "image/png",
              filename: "stream.png",
              sizeBytes: 64,
              voiceNote: false
            }
          }),
          JSON.stringify({
            type: "completed",
            result: {
              requestId: "runtime-request-1",
              sessionId: "runtime-session-1",
              assistantText: "hello native",
              artifacts: [
                {
                  artifactId: "artifact-1",
                  kind: "image",
                  storagePath: `${WEB_SESSION_ROOT}/stream.png`,
                  mimeType: "image/png",
                  filename: "stream.png",
                  sizeBytes: 64,
                  voiceNote: false
                }
              ],
              respondedAt: "2026-04-11T13:00:00.000Z",
              usage: null,
              trace: {
                scope: "turn",
                status: "completed",
                totalMs: 123,
                stages: [{ key: "provider", durationMs: 120 }]
              }
            }
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      const chunks = await collectChunks(
        service.execute({
          requestId: "trace-request-1",
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "user-msg-1",
          userMessage: "hello native",
          attachments: [],
          openMediaJobs: [
            {
              jobId: "job-1",
              kind: "image",
              toolCode: "image_generate",
              status: "queued",
              createdAt: "2026-04-11T12:58:00.000Z",
              startedAt: null,
              updatedAt: "2026-04-11T12:59:00.000Z"
            }
          ],
          userTimezone: "UTC",
          currentTimeIso: "2026-04-11T13:00:00.000Z",
          modelRoleOverride: "premium_reply",
          providerOverride: "anthropic",
          modelOverride: "claude-sonnet-4-5"
        })
      );

      assert.equal(capturedUrl, "http://runtime.local/api/v1/turns/stream");
      assert.equal(capturedBody?.requestId, "trace-request-1");
      assert.equal(capturedBody?.idempotencyKey, "user-msg-1");
      assert.equal(capturedBody?.modelRoleOverride, "premium_reply");
      assert.equal(capturedBody?.providerOverride, "anthropic");
      assert.equal(capturedBody?.modelOverride, "claude-sonnet-4-5");
      assert.equal((capturedBody?.bundle as Record<string, unknown>)?.bundleId, "spec-1");
      assert.deepEqual(
        ((capturedBody?.message as Record<string, unknown>)?.attachments as unknown[]) ?? [],
        []
      );
      assert.deepEqual(capturedBody?.openMediaJobs, [
        {
          jobId: "job-1",
          kind: "image",
          toolCode: "image_generate",
          status: "queued",
          createdAt: "2026-04-11T12:58:00.000Z",
          startedAt: null,
          updatedAt: "2026-04-11T12:59:00.000Z"
        }
      ]);
      assert.deepEqual(chunks, [
        { type: "delta", delta: "hello", accumulated: "hello" },
        {
          type: "tool",
          toolPhase: "start",
          toolName: "summarize_context",
          toolCallId: "tool-1"
        },
        {
          type: "tool",
          toolPhase: "end",
          toolName: "summarize_context",
          toolCallId: "tool-1",
          isError: false
        },
        {
          type: "media",
          media: [
            {
              source: "persai_object_storage",
              objectKey: `${WEB_SESSION_ROOT}/stream.png`,
              type: "image",
              mimeType: "image/png",
              filename: "stream.png",
              sizeBytes: 64
            }
          ]
        },
        {
          type: "done",
          respondedAt: "2026-04-11T13:00:00.000Z",
          finalAnswer: "hello native",
          workingNotes: [],
          runtimeTrace: {
            scope: "turn",
            status: "completed",
            totalMs: 123,
            stages: [{ key: "provider", durationMs: 120 }]
          }
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps project activity and reasoning summary runtime events", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1"
          }),
          JSON.stringify({
            type: "project_activity",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            stage: "plan",
            status: "started",
            summary: "Planning the analysis pass"
          }),
          JSON.stringify({
            type: "project_reasoning_summary",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            kind: "plan",
            summary: "Building a bounded plan."
          }),
          JSON.stringify({
            type: "completed",
            result: {
              requestId: "runtime-request-1",
              sessionId: "runtime-session-1",
              assistantText: "done",
              artifacts: [],
              respondedAt: "2026-04-11T13:00:00.000Z",
              usage: null
            }
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      const chunks = await collectChunks(
        service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "user-msg-1",
          userMessage: "project analysis",
          attachments: [],
          chatMode: "project"
        })
      );

      assert.ok(
        chunks.some(
          (chunk) =>
            chunk.type === "project_activity" &&
            chunk.projectStage === "plan" &&
            chunk.projectStatus === "started"
        )
      );
      assert.ok(
        chunks.some(
          (chunk) =>
            chunk.type === "project_reasoning_summary" && chunk.projectReasoningKind === "plan"
        )
      );
      assert.ok(chunks.some((chunk) => chunk.type === "done"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("includes chatMode on web runtime stream request body", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedBody = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : null;
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1"
          }),
          JSON.stringify({
            type: "completed",
            result: {
              requestId: "runtime-request-1",
              sessionId: "runtime-session-1",
              assistantText: "done",
              artifacts: [],
              respondedAt: "2026-04-11T13:00:00.000Z",
              usage: null
            }
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      for await (const _chunk of service.execute({
        assistantId: "assistant-1",
        publishedVersionId: "version-1",
        runtimeTier: "paid_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        userMessageId: "user-msg-1",
        userMessage: "project analysis",
        attachments: [],
        chatMode: "project",
        deepMode: true
      })) {
        void _chunk;
      }

      assert.equal(capturedBody?.chatMode, "project");
      assert.equal(capturedBody?.deepMode, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("ignores blank keepalive lines in the runtime NDJSON stream", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1"
          }),
          "",
          JSON.stringify({
            type: "tool_finished",
            requestId: "runtime-request-1",
            sessionId: "runtime-session-1",
            toolCallId: "tool-1",
            toolName: "files",
            isError: false
          }),
          "",
          JSON.stringify({
            type: "completed",
            result: {
              requestId: "runtime-request-1",
              sessionId: "runtime-session-1",
              assistantText: "",
              artifacts: [],
              respondedAt: "2026-04-11T13:00:00.000Z",
              usage: null
            }
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      const chunks = await collectChunks(
        service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "user-msg-1",
          userMessage: "hello native",
          attachments: [],
          userTimezone: "UTC",
          currentTimeIso: "2026-04-11T13:00:00.000Z"
        })
      );

      assert.deepEqual(chunks, [
        {
          type: "tool",
          toolPhase: "end",
          toolName: "files",
          toolCallId: "tool-1",
          isError: false
        },
        {
          type: "done",
          respondedAt: "2026-04-11T13:00:00.000Z",
          finalAnswer: "",
          workingNotes: []
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces web runtime stream conflicts as inbound conflicts", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 409,
          message: 'Turn "request-1" is already in flight.',
          error: "Conflict"
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
          collectChunks(
            service.execute({
              assistantId: "assistant-1",
              publishedVersionId: "version-1",
              runtimeTier: "paid_shared_restricted",
              surfaceThreadKey: "thread-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              userMessageId: "user-msg-1",
              userMessage: "hello native",
              attachments: []
            })
          ),
        (error) => {
          const row = error as { errorObject?: { code?: string } };
          return row.errorObject?.code === "native_runtime_conflict";
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps oversized web runtime payload responses to input validation", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 413,
          message: "Current-turn file payload is too large for direct model input.",
          error: "Payload Too Large"
        }),
        {
          status: 413,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
          collectChunks(
            service.execute({
              assistantId: "assistant-1",
              publishedVersionId: "version-1",
              runtimeTier: "paid_shared_restricted",
              surfaceThreadKey: "thread-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              userMessageId: "user-msg-1",
              userMessage: "hello native",
              attachments: []
            })
          ),
        (error) => {
          const row = error as {
            errorObject?: { code?: string; message?: string };
          };
          return (
            row.errorObject?.code === "native_runtime_request_invalid" &&
            row.errorObject?.message ===
              "Current-turn file payload is too large for direct model input."
          );
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails clearly when the runtime base url is missing while the web runtime stream client is enabled", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new WebRuntimeStreamClientService({
      findByPublishedVersionId: async () => {
        throw new Error("repository should not be called");
      }
    } as AssistantMaterializedSpecRepository);

    await assert.rejects(
      () =>
        collectChunks(
          service.execute({
            assistantId: "assistant-1",
            publishedVersionId: "version-1",
            runtimeTier: "paid_shared_restricted",
            surfaceThreadKey: "thread-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            userMessageId: "user-msg-1",
            userMessage: "hello native",
            attachments: []
          })
        ),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        error.message.includes("PERSAI_RUNTIME_BASE_URL")
    );
  });

  test("completes degraded web stream when runtime fails after emitting an artifact", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-4",
            sessionId: "runtime-session-4"
          }),
          JSON.stringify({
            type: "artifact",
            requestId: "runtime-request-4",
            sessionId: "runtime-session-4",
            artifact: {
              artifactId: "artifact-degraded-1",
              kind: "image",
              storagePath: `${WEB_SESSION_ROOT}/degraded.png`,
              mimeType: "image/png",
              filename: "degraded.png",
              sizeBytes: 512,
              voiceNote: false
            }
          }),
          JSON.stringify({
            type: "failed",
            requestId: "runtime-request-4",
            sessionId: "runtime-session-4",
            code: "provider_stream_failed",
            message: "Follow-up failed.",
            willRetry: false,
            artifacts: [
              {
                artifactId: "artifact-degraded-1",
                kind: "image",
                storagePath: `${WEB_SESSION_ROOT}/degraded.png`,
                mimeType: "image/png",
                filename: "degraded.png",
                sizeBytes: 512,
                voiceNote: false
              }
            ]
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      const chunks = await collectChunks(
        service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "user-msg-1",
          userMessage: "generate image",
          attachments: []
        })
      );

      assert.deepEqual(chunks, [
        {
          type: "media",
          media: [
            {
              source: "persai_object_storage",
              objectKey: `${WEB_SESSION_ROOT}/degraded.png`,
              type: "image",
              mimeType: "image/png",
              filename: "degraded.png",
              sizeBytes: 512
            }
          ]
        },
        {
          type: "delta",
          delta: "Tool completed, but follow-up text was interrupted.",
          accumulated: "Tool completed, but follow-up text was interrupted."
        },
        {
          type: "done",
          respondedAt: chunks.at(-1)?.respondedAt
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps provider context-window failures to a distinct runtime code", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        [
          JSON.stringify({
            type: "started",
            requestId: "runtime-request-5",
            sessionId: "runtime-session-5"
          }),
          JSON.stringify({
            type: "failed",
            requestId: "runtime-request-5",
            sessionId: "runtime-session-5",
            code: "provider_context_window_exceeded",
            message: "Your input exceeds the context window of this model.",
            willRetry: false
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeStreamClientService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
          collectChunks(
            service.execute({
              assistantId: "assistant-1",
              publishedVersionId: "version-1",
              runtimeTier: "paid_shared_restricted",
              surfaceThreadKey: "thread-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              userMessageId: "user-msg-1",
              userMessage: "use my skill and uploaded KB",
              attachments: []
            })
          ),
        (error) =>
          error instanceof AssistantRuntimeError &&
          error.code === "runtime_context_window_exceeded" &&
          error.message === "Your input exceeds the context window of this model."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
