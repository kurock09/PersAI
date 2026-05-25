import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { WebRuntimeSessionStateClientService } from "../src/modules/workspace-management/application/web-runtime-session-state-client.service";

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

describe("WebRuntimeSessionStateClientService", () => {
  test("posts the web runtime session-state request and returns the runtime result", async () => {
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
          found: true,
          session: {
            sessionId: "runtime-session-1",
            conversation: {
              assistantId: "assistant-1",
              workspaceId: "workspace-1",
              channel: "web",
              externalThreadKey: "thread-1",
              externalUserKey: "user-1",
              mode: "direct"
            },
            currentTokens: 18250,
            totalTokensFresh: true,
            compactionCount: 0,
            compactionHintTokens: null,
            providerKey: "openai",
            modelKey: "gpt-4.1",
            updatedAt: "2026-04-12T22:00:00.000Z"
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
      const service = new WebRuntimeSessionStateClientService();
      const result = await service.execute({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1"
      });

      assert.equal(capturedUrl, "http://runtime.local/api/v1/turns/session/resolve");
      assert.deepEqual(capturedBody, {
        runtimeTier: "paid_shared_restricted",
        conversation: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "web",
          externalThreadKey: "thread-1",
          externalUserKey: "user-1",
          mode: "direct"
        }
      });
      assert.equal(result.found, true);
      assert.equal(result.session?.sessionId, "runtime-session-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails clearly when the web runtime base url is missing", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new WebRuntimeSessionStateClientService();

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          runtimeTier: "paid_shared_restricted",
          surfaceThreadKey: "thread-1",
          userId: "user-1"
        }),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        error.message.includes("PERSAI_RUNTIME_BASE_URL")
    );
  });
});
