import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { SendNativeWebChatTurnService } from "../src/modules/workspace-management/application/send-native-web-chat-turn.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";

const ORIGINAL_ENV = process.env;

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_NATIVE_RUNTIME_WEB_SYNC_ENABLED: "true",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_TURN_TIMEOUT_MS: "9000",
    ...overrides
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("SendNativeWebChatTurnService", () => {
  test("builds a native runtime sync turn request and maps the result", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
      return new Response(
        JSON.stringify({
          requestId: "runtime-request-1",
          sessionId: "runtime-session-1",
          assistantText: "native hello",
          artifacts: [],
          respondedAt: "2026-04-11T13:00:00.000Z",
          usage: null,
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
      const service = new SendNativeWebChatTurnService({
        findByPublishedVersionId: async () => ({
          id: "spec-1",
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          sourceAction: "publish",
          algorithmVersion: 72,
          materializedAtConfigGeneration: 1,
          layers: {},
          runtimeBundle: {},
          openclawBootstrap: {},
          openclawWorkspace: {},
          layersDocument: "{}",
          runtimeBundleDocument: "{}",
          runtimeBundleHash: "bundle-hash-1",
          openclawBootstrapDocument: "{}",
          openclawWorkspaceDocument: "{}",
          contentHash: "content-hash-1",
          createdAt: new Date("2026-04-11T12:59:00.000Z")
        })
      } as AssistantMaterializedSpecRepository);

      assert.equal(service.isEnabled(), true);

      const result = await service.execute({
        assistantId: "assistant-1",
        publishedVersionId: "version-1",
        runtimeTier: "paid_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        userMessageId: "user-msg-1",
        userMessage: "hello native",
        userTimezone: "UTC",
        currentTimeIso: "2026-04-11T13:00:00.000Z",
        providerOverride: "anthropic",
        modelOverride: "claude-sonnet-4-5"
      });

      assert.equal(capturedUrl, "http://runtime.local/api/v1/turns/create");
      assert.equal(capturedBody?.idempotencyKey, "user-msg-1");
      assert.equal(capturedBody?.providerOverride, "anthropic");
      assert.equal(capturedBody?.modelOverride, "claude-sonnet-4-5");
      assert.equal((capturedBody?.bundle as Record<string, unknown>)?.bundleId, "spec-1");
      assert.equal(
        ((capturedBody?.conversation as Record<string, unknown>)?.externalUserKey as string) ?? null,
        "user-1"
      );
      assert.equal(result.assistantMessage, "native hello");
      assert.equal(result.media.length, 0);
      assert.equal(result.runtimeTrace?.status, "completed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces native runtime conflicts as inbound conflicts", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 409,
          message: "Turn \"request-1\" is already in flight.",
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
      const service = new SendNativeWebChatTurnService({
        findByPublishedVersionId: async () => ({
          id: "spec-1",
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          sourceAction: "publish",
          algorithmVersion: 72,
          materializedAtConfigGeneration: 1,
          layers: {},
          runtimeBundle: {},
          openclawBootstrap: {},
          openclawWorkspace: {},
          layersDocument: "{}",
          runtimeBundleDocument: "{}",
          runtimeBundleHash: "bundle-hash-1",
          openclawBootstrapDocument: "{}",
          openclawWorkspaceDocument: "{}",
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
            userMessage: "hello native"
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

  test("fails clearly when the runtime base url is missing while the flag is enabled", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new SendNativeWebChatTurnService({
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
          userMessage: "hello native"
        }),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        error.message.includes("PERSAI_RUNTIME_BASE_URL")
    );
  });
});
