import assert from "node:assert/strict";
import { TelegramWebhookProxyController } from "../src/modules/workspace-management/interface/http/telegram-webhook-proxy.controller";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

type MockResponse = {
  statusCode: number | null;
  headers: Record<string, string>;
  jsonBody: unknown;
  sentBody: string | null;
  status(code: number): MockResponse;
  setHeader(key: string, value: string): void;
  json(payload: unknown): void;
  send(body: string): void;
};

function applyEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED: "http://openclaw-free.test",
    OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED: "http://openclaw-paid-shared.test",
    OPENCLAW_BASE_URL_PAID_ISOLATED: "http://openclaw-paid-isolated.test",
    OPENCLAW_GATEWAY_TOKEN: "gateway-token",
    PERSAI_INTERNAL_API_TOKEN: "internal-api-token"
  };
}

function createResponse(): MockResponse {
  return {
    statusCode: null,
    headers: {},
    jsonBody: null,
    sentBody: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    json(payload: unknown) {
      this.jsonBody = payload;
    },
    send(body: string) {
      this.sentBody = body;
    }
  };
}

async function run(): Promise<void> {
  applyEnv();

  const passThroughController = new TelegramWebhookProxyController({
    async resolveByAssistantId() {
      return "paid_shared_restricted";
    }
  } as never);

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "http://openclaw-paid-shared.test/telegram-webhook/assistant-1");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer gateway-token");
    assert.equal(
      (init?.headers as Record<string, string>)["x-telegram-bot-api-secret-token"],
      "tg-secret"
    );
    assert.equal(init?.body, JSON.stringify({ update_id: 123 }));
    return new Response("upstream unavailable", {
      status: 503,
      headers: { "content-type": "text/plain", "x-upstream-test": "yes" }
    });
  }) as typeof fetch;

  const passThroughRes = createResponse();
  await passThroughController.proxy(
    "assistant-1",
    {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "tg-secret" },
      body: { update_id: 123 }
    },
    passThroughRes
  );
  assert.equal(passThroughRes.statusCode, 503);
  assert.equal(passThroughRes.headers["content-type"], "text/plain");
  assert.equal(passThroughRes.headers["x-upstream-test"], "yes");
  assert.equal(passThroughRes.sentBody, "upstream unavailable");

  const timeoutController = new TelegramWebhookProxyController({
    async resolveByAssistantId() {
      return "free_shared_restricted";
    }
  } as never);

  globalThis.fetch = (async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }) as typeof fetch;
  const timeoutRes = createResponse();
  await timeoutController.proxy(
    "assistant-timeout",
    { method: "POST", headers: {}, body: { update_id: 1 } },
    timeoutRes
  );
  assert.equal(timeoutRes.statusCode, 504);
  assert.deepEqual(timeoutRes.jsonBody, { ok: false, error: "upstream_timeout" });

  const networkErrorController = new TelegramWebhookProxyController({
    async resolveByAssistantId() {
      return "free_shared_restricted";
    }
  } as never);

  globalThis.fetch = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;
  const networkErrorRes = createResponse();
  await networkErrorController.proxy(
    "assistant-network-error",
    { method: "POST", headers: {}, body: { update_id: 2 } },
    networkErrorRes
  );
  assert.equal(networkErrorRes.statusCode, 502);
  assert.deepEqual(networkErrorRes.jsonBody, { ok: false, error: "upstream_error" });

  const unknownAssistantController = new TelegramWebhookProxyController({
    async resolveByAssistantId() {
      throw new Error("not found");
    }
  } as never);
  const unknownAssistantRes = createResponse();
  await unknownAssistantController.proxy(
    "missing-assistant",
    { method: "POST", headers: {}, body: { update_id: 3 } },
    unknownAssistantRes
  );
  assert.equal(unknownAssistantRes.statusCode, 200);
  assert.deepEqual(unknownAssistantRes.jsonBody, { ok: false, error: "unknown_assistant" });
}

void run()
  .finally(() => {
    process.env = ORIGINAL_ENV;
    globalThis.fetch = ORIGINAL_FETCH;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
