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

  let healthCalls = 0;
  let readyCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      healthCalls += 1;
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      readyCalls += 1;
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
  const cachedPreflight = await adapter.preflight();
  assert.deepEqual(cachedPreflight.ready, false);
  assert.equal(healthCalls, 1);
  assert.equal(readyCalls, 1);

  healthCalls = 0;
  readyCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      healthCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      readyCalls += 1;
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;
  applyBaseEnv({ OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED: "http://openclaw-burst.test" });
  const burstAdapter = new OpenClawRuntimeAdapter();
  const [burstA, burstB] = await Promise.all([
    burstAdapter.preflight("free_shared_restricted"),
    burstAdapter.preflight("free_shared_restricted")
  ]);
  assert.equal(burstA.ready, true);
  assert.equal(burstB.ready, true);
  assert.equal(healthCalls, 1);
  assert.equal(readyCalls, 1);

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
  const freeTierAdapter = new OpenClawRuntimeAdapter();
  const freeTierPreflight = await freeTierAdapter.preflight("free_shared_restricted");
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
  const paidFallbackAdapter = new OpenClawRuntimeAdapter();
  const paidFallbackPreflight = await paidFallbackAdapter.preflight("paid_isolated");
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

  const degradedWebAdapter = new OpenClawRuntimeAdapter();
  await assert.rejects(
    () =>
      degradedWebAdapter.sendWebChatTurn({
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

  let invalidatedHealthCalls = 0;
  let invalidatedReadyCalls = 0;
  let invalidatedChatCalls = 0;
  applyBaseEnv({
    OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED: "http://openclaw-invalidate.test"
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      invalidatedHealthCalls += 1;
      return new Response(JSON.stringify({ ok: true, status: "live" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/readyz")) {
      invalidatedReadyCalls += 1;
      return new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/v1/runtime/chat/web")) {
      invalidatedChatCalls += 1;
      return new Response(JSON.stringify({ error: "temporary outage" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;
  const invalidationAdapter = new OpenClawRuntimeAdapter();
  await invalidationAdapter.preflight("free_shared_restricted");
  await assert.rejects(
    () =>
      invalidationAdapter.sendWebChatTurn({
        assistantId: "assistant-1",
        publishedVersionId: "pub-1",
        chatId: "chat-1",
        surfaceThreadKey: "thread-1",
        userMessageId: "msg-1",
        userMessage: "hello",
        runtimeTier: "free_shared_restricted"
      }),
    (error: unknown) =>
      error instanceof AssistantRuntimeAdapterError && error.code === "runtime_degraded"
  );
  await invalidationAdapter.preflight("free_shared_restricted");
  assert.equal(invalidatedChatCalls, 1);
  assert.equal(invalidatedHealthCalls, 2);
  assert.equal(invalidatedReadyCalls, 2);

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
      return new Response(
        JSON.stringify({
          assistantMessage: "",
          respondedAt: "2026-04-05T12:00:00.000Z",
          media: [
            {
              source: "runtime_url",
              url: "/tmp/reply.ogg",
              type: "audio",
              audioAsVoice: true
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  const mediaOnlyAdapter = new OpenClawRuntimeAdapter();
  const mediaOnlyWebResult = await mediaOnlyAdapter.sendWebChatTurn({
    assistantId: "assistant-1",
    publishedVersionId: "pub-1",
    chatId: "chat-1",
    surfaceThreadKey: "thread-1",
    userMessageId: "msg-1",
    userMessage: "hello"
  });
  assert.deepEqual(mediaOnlyWebResult, {
    assistantMessage: "",
    respondedAt: "2026-04-05T12:00:00.000Z",
    media: [
      {
        source: "runtime_url",
        url: "/tmp/reply.ogg",
        type: "audio",
        audioAsVoice: true
      }
    ]
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

  const previewAdapter = new OpenClawRuntimeAdapter();
  const previewResult = await previewAdapter.previewSetupTurn({
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

  const maintenanceAdapter = new OpenClawRuntimeAdapter();
  await maintenanceAdapter.consumeBootstrapWorkspace("assistant-1");
  await maintenanceAdapter.deleteWebChatSession({
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
      const streamAdapter = new OpenClawRuntimeAdapter();
      for await (const chunk of streamAdapter.streamWebChatTurn({
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
