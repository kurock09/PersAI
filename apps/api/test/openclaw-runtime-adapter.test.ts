import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { AssistantRuntimeAdapterError } from "../src/modules/workspace-management/application/assistant-runtime-adapter.types";
import { OpenClawRuntimeAdapter } from "../src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function applyBaseEnv(overrides: NodeJS.ProcessEnv = {}): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    OPENCLAW_ADAPTER_ENABLED: "true",
    OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED: "http://openclaw-free.test",
    OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED: "http://openclaw-paid-shared.test",
    OPENCLAW_BASE_URL_PAID_ISOLATED: "http://openclaw-paid-isolated.test",
    OPENCLAW_GATEWAY_TOKEN: "gateway-token",
    PERSAI_INTERNAL_API_TOKEN: "internal-api-token",
    OPENCLAW_ADAPTER_TIMEOUT_MS: "1000",
    OPENCLAW_ADAPTER_MAX_RETRIES: "0",
    ...overrides
  };
}

async function run(): Promise<void> {
  applyBaseEnv();

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: false }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  const adapter = new OpenClawRuntimeAdapter();
  const preflight = await adapter.preflight();
  assert.deepEqual(preflight.live, true);
  assert.deepEqual(preflight.ready, false);

  applyBaseEnv({
    OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED: "http://openclaw-free.test"
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.startsWith("http://openclaw-free.test/"));
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;
  const freeTierPreflight = await adapter.preflight("free_shared_restricted");
  assert.equal(freeTierPreflight.ready, true);

  applyBaseEnv({
    OPENCLAW_BASE_URL_PAID_ISOLATED: "http://openclaw-paid-isolated.test"
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.startsWith("http://openclaw-paid-isolated.test/"));
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;
  const paidFallbackPreflight = await adapter.preflight("paid_isolated");
  assert.equal(paidFallbackPreflight.ready, true);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/web")) {
      const request = input instanceof Request ? input : new Request(input);
      const payload = JSON.parse(await request.text()) as Record<string, unknown>;
      assert.equal(payload.providerOverride, "openai");
      assert.equal(payload.modelOverride, "gpt-5.4-mini");
      return new Response(JSON.stringify({ ok: false, error: "runtime missing applied spec" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/channel")) {
      return new Response(
        JSON.stringify({
          assistantMessage: "Telegram reply",
          respondedAt: "2026-03-31T00:00:00.000Z"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () =>
      adapter.sendWebChatTurn({
        assistantId: "assistant-1",
        publishedVersionId: "pub-1",
        providerOverride: "openai",
        modelOverride: "gpt-5.4-mini",
        chatId: "chat-1",
        surfaceThreadKey: "thread-1",
        userMessageId: "msg-1",
        userMessage: "hello"
      }),
    (error: unknown) =>
      error instanceof AssistantRuntimeAdapterError && error.code === "runtime_unreachable"
  );

  const channelResult = await adapter.sendChannelTurn({
    assistantId: "assistant-1",
    publishedVersionId: "pub-1",
    surface: "telegram",
    threadId: "chat-telegram-1",
    userMessage: "hello"
  });
  assert.deepEqual(channelResult, {
    assistantMessage: "Telegram reply",
    respondedAt: "2026-03-31T00:00:00.000Z",
    media: []
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/web/preview")) {
      return new Response(
        JSON.stringify({
          assistantMessage: "Preview reply",
          respondedAt: "2026-04-03T12:00:00.000Z"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  const previewResult = await adapter.previewSetupTurn({
    assistantId: "assistant-1",
    userMessage: "Introduce yourself",
    openclawBootstrap: { bootstrap: true },
    openclawWorkspace: { workspace: true }
  });
  assert.deepEqual(previewResult, {
    assistantMessage: "Preview reply",
    respondedAt: "2026-04-03T12:00:00.000Z",
    media: []
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/v1/runtime/workspace/bootstrap/consume")) {
      return new Response(JSON.stringify({ ok: true, deleted: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/web/session/delete")) {
      return new Response(JSON.stringify({ ok: true, removedSessions: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  await adapter.consumeBootstrapWorkspace("assistant-1");
  await adapter.deleteWebChatSession({
    assistantId: "assistant-1",
    chatId: "chat-1",
    surfaceThreadKey: "thread-1"
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/web/stream")) {
      return new Response(
        [
          JSON.stringify({
            type: "failed",
            code: "tool_daily_limit_reached",
            message: 'Daily tool usage limit reached for "web_search".'
          })
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson" }
        }
      );
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    async () => {
      for await (const chunk of adapter.streamWebChatTurn({
        assistantId: "assistant-1",
        publishedVersionId: "pub-1",
        chatId: "chat-1",
        surfaceThreadKey: "thread-1",
        userMessageId: "msg-1",
        userMessage: "hello"
      })) {
        void chunk;
      }
    },
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "tool_daily_limit_reached"
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });
