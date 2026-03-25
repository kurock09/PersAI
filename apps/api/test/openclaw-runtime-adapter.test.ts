import assert from "node:assert/strict";
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
    OPENCLAW_BASE_URL: "http://openclaw.test",
    OPENCLAW_GATEWAY_TOKEN: "gateway-token",
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
      return new Response(JSON.stringify({ ok: false, error: "runtime missing applied spec" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () =>
      adapter.sendWebChatTurn({
        assistantId: "assistant-1",
        publishedVersionId: "pub-1",
        chatId: "chat-1",
        surfaceThreadKey: "thread-1",
        userMessageId: "msg-1",
        userMessage: "hello"
      }),
    (error: unknown) =>
      error instanceof AssistantRuntimeAdapterError && error.code === "runtime_degraded"
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
