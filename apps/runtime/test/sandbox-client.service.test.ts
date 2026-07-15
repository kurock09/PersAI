import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { SandboxClientService } from "../src/modules/turns/sandbox-client.service";

function createConfig(): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 32,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000,
    RUNTIME_SANDBOX_BASE_URL: "http://sandbox.local",
    RUNTIME_SANDBOX_TIMEOUT_MS: 30_000,
    RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: 240_000,
    PERSAI_INTERNAL_API_TOKEN: "sandbox-token",
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media",
    ORPHAN_RECEIPT_GRACE_MS: 1_200_000
  };
}

test("SandboxClientService waitForCompletion uses bounded long-poll status requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const service = new SandboxClientService(createConfig());
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          jobId: "job-1",
          status: "queued",
          toolCode: "files",
          reason: null,
          warning: null,
          violationCode: null,
          violationMessage: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null,
          files: []
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        jobId: "job-1",
        status: "completed",
        toolCode: "files",
        reason: null,
        warning: null,
        violationCode: null,
        violationMessage: null,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        content: null,
        files: []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await service.waitForCompletion({
      assistantId: "assistant-1",
      assistantHandle: "a-test",
      siblingHandles: [],
      workspaceId: "workspace-1",
      runtimeRequestId: "request-1",
      runtimeSessionId: "session-1",
      toolCode: "files",
      policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
      args: { action: "list" }
    });

    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2);
    assert.equal(requests[0], "http://sandbox.local/api/v1/jobs");
    assert.equal(requests[1], "http://sandbox.local/api/v1/jobs/job-1?waitMs=1500");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SandboxClientService completion budget includes cold-start pod provisioning", () => {
  const service = new SandboxClientService(createConfig());
  const access = service as unknown as {
    resolveCompletionTimeoutMs(request: { policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY }): number;
  };
  const timeout = access.resolveCompletionTimeoutMs({ policy: DEFAULT_RUNTIME_SANDBOX_POLICY });
  // A cold start (sandbox node autoscale + multi-GB image pull) is ~100s; the end-to-end
  // budget must include the 240s provision budget so the runtime does not abandon the job
  // before the pod is ready (the old ~40s budget surfaced a spurious timeout to the model).
  assert.ok(
    timeout >= 240_000,
    `completion timeout (${String(timeout)}ms) must include the pod provisioning budget`
  );
});

test("SandboxClientService pollJob omits wait query when waitMs is zero", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const service = new SandboxClientService(createConfig());
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);
    return new Response(
      JSON.stringify({
        jobId: "job-2",
        status: "completed",
        toolCode: "files",
        reason: null,
        warning: null,
        violationCode: null,
        violationMessage: null,
        exitCode: 0,
        stdout: null,
        stderr: null,
        content: null,
        files: []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await service.pollJob("job-2");
    assert.deepEqual(requests, ["http://sandbox.local/api/v1/jobs/job-2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
