import assert from "node:assert/strict";
import { test } from "node:test";
import { UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import { SandboxController } from "../src/sandbox.controller";

function createConfig(token: string | undefined): SandboxConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3013,
    LOG_LEVEL: "info",
    PERSAI_INTERNAL_API_TOKEN: token,
    SANDBOX_MAX_PENDING_JOBS: 16,
    SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE: 4,
    SANDBOX_MAX_POLL_WAIT_MS: 1_500,
    SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 45_000,
    SANDBOX_RUNNING_JOB_GRACE_MS: 15_000,
    SANDBOX_EXEC_NAMESPACE: "persai-dev",
    SANDBOX_EXEC_IMAGE: "busybox:1.36",
    SANDBOX_EXEC_RUNTIME_CLASS_NAME: "gvisor",
    SANDBOX_EXEC_NODE_SELECTOR_VALUE: "sandbox",
    SANDBOX_EXEC_SERVICE_ACCOUNT_NAME: "sandbox-exec-sa",
    SANDBOX_EXEC_EGRESS_PROXY_URL: "",
    SANDBOX_EXEC_NO_PROXY: "",
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 900_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 240_000,
    SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 1,
    SANDBOX_SHARED_EMPTYDIR_SIZE_MIB: 512,
    SANDBOX_GC_INTERVAL_MS: 300_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media"
  };
}

test("sandbox egress reconcile endpoint requires internal token", async () => {
  const calls: unknown[] = [];
  const controller = new SandboxController(
    {
      async reconcileAssistantSandboxEgress(input: unknown) {
        calls.push(input);
        return { recycled: false, deletedPodCount: 0 };
      }
    } as never,
    {} as never,
    createConfig("secret-token")
  );

  await assert.rejects(
    () =>
      controller.reconcileAssistantSandboxEgress(undefined, "assistant-1", {
        mode: "restricted",
        scope: "all"
      }),
    (error: unknown) => error instanceof UnauthorizedException
  );
  await assert.rejects(
    () =>
      controller.reconcileAssistantSandboxEgress("Bearer wrong", "assistant-1", {
        mode: "restricted",
        scope: "all"
      }),
    (error: unknown) => error instanceof UnauthorizedException
  );
  assert.equal(calls.length, 0);

  const result = await controller.reconcileAssistantSandboxEgress(
    "Bearer secret-token",
    "assistant-1",
    { mode: "full_public", scope: "stale_only" }
  );
  assert.deepEqual(result, { recycled: false, deletedPodCount: 0 });
  assert.deepEqual(calls, [
    { assistantId: "assistant-1", mode: "full_public", scope: "stale_only" }
  ]);
});

test("sandbox egress reconcile endpoint rejects malformed body", async () => {
  const controller = new SandboxController(
    {
      async reconcileAssistantSandboxEgress() {
        return { recycled: false, deletedPodCount: 0 };
      }
    } as never,
    {} as never,
    createConfig("secret-token")
  );

  await assert.rejects(
    () =>
      controller.reconcileAssistantSandboxEgress("Bearer secret-token", "assistant-1", {
        mode: "open",
        scope: "all"
      }),
    (error: unknown) => error instanceof ServiceUnavailableException
  );
});
