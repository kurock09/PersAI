import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxConfig } from "@persai/config";
import { SandboxMetricsService } from "../src/sandbox-metrics.service";
import { SandboxObservabilityService } from "../src/sandbox-observability.service";

function createConfig(): SandboxConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3013,
    LOG_LEVEL: "info",
    PERSAI_INTERNAL_API_TOKEN: "sandbox-token",
    SANDBOX_MAX_PENDING_JOBS: 16,
    SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE: 4,
    SANDBOX_MAX_POLL_WAIT_MS: 1_500,
    SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 45_000,
    SANDBOX_RUNNING_JOB_GRACE_MS: 15_000,
    SANDBOX_EXEC_NAMESPACE: "persai-dev",
    SANDBOX_EXEC_IMAGE: "busybox:1.36",
    SANDBOX_EXEC_RUNTIME_CLASS_NAME: "gvisor",
    SANDBOX_EXEC_NODE_SELECTOR_VALUE: "sandbox",
    SANDBOX_EXEC_EGRESS_PROXY_URL: "",
    SANDBOX_EXEC_NO_PROXY: "",
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 1_800_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 240_000
  };
}

test("SandboxMetricsService renders backlog and long-poll metrics", async () => {
  const observability = new SandboxObservabilityService();
  observability.recordSubmittedJob();
  observability.recordSubmittedJob();
  observability.recordBacklogRejected("global");
  observability.recordBacklogRejected("workspace");
  observability.recordLongPoll(800);
  observability.recordStaleFailure("queued");

  const metrics = await new SandboxMetricsService(
    {
      sandboxJob: {
        async count(input: { where: { status: string } }) {
          if (input.where.status === "queued") {
            return 3;
          }
          if (input.where.status === "running") {
            return 2;
          }
          if (input.where.status === "blocked") {
            return 1;
          }
          return 0;
        }
      }
    } as never,
    observability,
    createConfig()
  ).renderMetrics();

  assert.match(metrics, /^sandbox_jobs_pending 5$/m);
  assert.match(metrics, /^sandbox_jobs_submitted_total 2$/m);
  assert.match(metrics, /^sandbox_job_backlog_rejections_total\{scope="global"\} 1$/m);
  assert.match(metrics, /^sandbox_job_backlog_rejections_total\{scope="workspace"\} 1$/m);
  assert.match(metrics, /^sandbox_stale_job_failures_total\{status="queued"\} 1$/m);
  assert.match(metrics, /^sandbox_job_status_long_poll_requests_total 1$/m);
  assert.match(metrics, /^sandbox_job_status_long_poll_wait_ms_sum 800\.00$/m);
});
