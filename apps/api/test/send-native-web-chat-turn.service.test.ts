import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { WebRuntimeTurnClientService } from "../src/modules/workspace-management/application/web-runtime-turn-client.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";

const ORIGINAL_ENV = process.env;

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_TURN_TIMEOUT_MS: "9000",
    ...overrides
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("WebRuntimeTurnClientService", () => {
  test("builds a web runtime sync turn request and maps the result", async () => {
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
        JSON.stringify({
          requestId: "runtime-request-1",
          sessionId: "runtime-session-1",
          assistantText: "native hello",
          artifacts: [
            {
              artifactId: "artifact-1",
              kind: "image",
              storagePath: "/workspace/one.png",
              mimeType: "image/png",
              filename: "one.png",
              sizeBytes: 128,
              voiceNote: false
            }
          ],
          respondedAt: "2026-04-11T13:00:00.000Z",
          usage: null,
          toolInvocations: [
            {
              name: "web_search",
              iteration: 0,
              ok: true,
              executionMode: "worker"
            }
          ],
          trace: {
            scope: "turn",
            status: "completed",
            totalMs: 123,
            stages: [{ key: "provider", durationMs: 120 }]
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new WebRuntimeTurnClientService({
        findByPublishedVersionId: async () => ({
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
        })
      } as AssistantMaterializedSpecRepository);

      const result = await service.execute({
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
            status: "running",
            createdAt: "2026-04-11T12:55:00.000Z",
            startedAt: "2026-04-11T12:56:00.000Z",
            updatedAt: "2026-04-11T12:59:30.000Z"
          }
        ],
        userTimezone: "UTC",
        currentTimeIso: "2026-04-11T13:00:00.000Z",
        modelRoleOverride: "premium_reply",
        providerOverride: "anthropic",
        modelOverride: "claude-sonnet-4-5"
      });

      assert.equal(capturedUrl, "http://runtime.local/api/v1/turns/create");
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
          status: "running",
          createdAt: "2026-04-11T12:55:00.000Z",
          startedAt: "2026-04-11T12:56:00.000Z",
          updatedAt: "2026-04-11T12:59:30.000Z"
        }
      ]);
      assert.equal(
        ((capturedBody?.conversation as Record<string, unknown>)?.externalUserKey as string) ??
          null,
        "user-1"
      );
      assert.equal(result.assistantMessage, "native hello");
      assert.deepEqual(result.media, [
        {
          source: "persai_object_storage",
          objectKey: "/workspace/one.png",
          type: "image",
          mimeType: "image/png",
          filename: "one.png",
          sizeBytes: 128
        }
      ]);
      assert.equal(result.runtimeTrace?.status, "completed");
      assert.deepEqual(result.toolInvocations, [
        {
          name: "web_search",
          iteration: 0,
          ok: true,
          executionMode: "worker"
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces web runtime conflicts as inbound conflicts", async () => {
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
      const service = new WebRuntimeTurnClientService({
        findByPublishedVersionId: async () => ({
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
        })
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
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
          }),
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
      const service = new WebRuntimeTurnClientService({
        findByPublishedVersionId: async () => ({
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
        })
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
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
          }),
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

  test("fails clearly when the runtime base url is missing while the web runtime client is enabled", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new WebRuntimeTurnClientService({
      findByPublishedVersionId: async () => {
        throw new Error("repository should not be called");
      }
    } as AssistantMaterializedSpecRepository);

    await assert.rejects(
      () =>
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
        }),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        error.message.includes("PERSAI_RUNTIME_BASE_URL")
    );
  });
});
