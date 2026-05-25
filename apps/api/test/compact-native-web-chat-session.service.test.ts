import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { WebRuntimeCompactionClientService } from "../src/modules/workspace-management/application/web-runtime-compaction-client.service";

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

describe("WebRuntimeCompactionClientService", () => {
  test("posts the web runtime compaction request and returns the runtime result", async () => {
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
          compacted: true,
          reason: "compacted",
          tokensBefore: 18250,
          tokensAfter: null,
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
            compactionCount: 1,
            compactionHintTokens: 18250,
            providerKey: "openai",
            modelKey: "gpt-4.1",
            updatedAt: "2026-04-12T20:00:00.000Z"
          },
          toolResult: {
            toolCode: "compact_context",
            action: "compacted",
            reason: "compacted",
            sessionId: "runtime-session-1",
            compactionRecordId: "compaction-1",
            before: {
              sessionId: "runtime-session-1",
              currentTokens: 18250,
              compactionCount: 0,
              summarizedMessageCount: 8,
              preservedRecentMessageCount: 4
            },
            after: {
              sessionId: "runtime-session-1",
              currentTokens: null,
              compactionCount: 1,
              summarizedMessageCount: 8,
              preservedRecentMessageCount: 4
            },
            preservedRecentTurns: 4,
            summaryText: "Compacted summary text",
            summaryPayload: {
              schema: "persai.runtimeSessionCompaction.v1",
              summarizeToolCode: "summarize_context",
              toolCode: "compact_context",
              summaryText: "Compacted summary text"
            },
            reusableInLaterTurns: true
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
      const service = new WebRuntimeCompactionClientService();
      const result = await service.execute({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1",
        instructions: " keep project decisions "
      });

      assert.equal(capturedUrl, "http://runtime.local/api/v1/turns/compact");
      assert.deepEqual(capturedBody, {
        runtimeTier: "paid_shared_restricted",
        conversation: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "web",
          externalThreadKey: "thread-1",
          externalUserKey: "user-1",
          mode: "direct"
        },
        instructions: "keep project decisions"
      });
      assert.equal(result.compacted, true);
      assert.equal(result.reason, "compacted");
      assert.equal(result.session?.sessionId, "runtime-session-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps web runtime 409 responses to compaction_unavailable", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: 409,
          message: "Session is busy.",
          error: "Conflict"
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )) as typeof fetch;

    try {
      const service = new WebRuntimeCompactionClientService();
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
          error.code === "compaction_unavailable" &&
          error.message === "Session is busy."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails clearly when the web runtime base url is missing", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new WebRuntimeCompactionClientService();

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
