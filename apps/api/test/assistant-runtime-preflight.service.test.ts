import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { AssistantRuntimePreflightService } from "../src/modules/workspace-management/application/assistant-runtime-preflight.service";

const ORIGINAL_ENV = process.env;

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    ...overrides
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  setApiEnv();
  let fetchCalls = 0;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    fetchCalls += 1;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "http://runtime.local/health") {
      return new Response(
        JSON.stringify({
          live: true,
          ready: true,
          checkedAt: "2026-04-17T00:00:00.000Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "http://runtime.local/ready") {
      return new Response(
        JSON.stringify({
          ready: true,
          checkedAt: "2026-04-17T00:00:00.000Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    throw new Error(`Unexpected preflight url: ${url}`);
  }) as typeof fetch;

  try {
    const service = new AssistantRuntimePreflightService();
    const healthy = await service.execute("paid_shared_restricted");
    assert.equal(fetchCalls, 2);
    assert.equal(healthy.live, true);
    assert.equal(healthy.ready, true);
    assert.match(healthy.checkedAt, /^\d{4}-\d{2}-\d{2}T/);

    setApiEnv({ PERSAI_RUNTIME_BASE_URL: undefined });
    fetchCalls = 0;
    const unconfigured = await service.execute("free_shared_restricted");
    assert.equal(fetchCalls, 0);
    assert.deepEqual(
      { live: unconfigured.live, ready: unconfigured.ready },
      { live: false, ready: false }
    );

    setApiEnv();
    globalThis.fetch = (async () => {
      throw new Error("runtime unavailable");
    }) as typeof fetch;
    const unavailable = await service.execute();
    assert.deepEqual(
      { live: unavailable.live, ready: unavailable.ready },
      { live: false, ready: false }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
