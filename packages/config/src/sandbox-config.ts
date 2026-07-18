import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
}, z.string().min(1).optional());

const baseSandboxConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3013),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  PERSAI_MEDIA_BUCKET_NAME: optionalNonEmptyString,
  // See note in runtime-config.ts: same default keeps the namespace addressable
  // even if the helm env block forgets the variable. Live regression 2026-06-25.
  // ADR-127 D9 (2026-06-25): default changed from "assistant-media" to "fs".
  PERSAI_MEDIA_OBJECT_PREFIX: z.string().min(1).default("fs"),
  PERSAI_INTERNAL_API_TOKEN: optionalNonEmptyString,
  SCRIPT_BROWSER_BROKER_REDIS_URL: optionalNonEmptyString,
  SANDBOX_MAX_PENDING_JOBS: z.coerce.number().int().positive().default(16),
  SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE: z.coerce.number().int().positive().default(4),
  SANDBOX_MAX_POLL_WAIT_MS: z.coerce.number().int().positive().default(1_500),
  SANDBOX_QUEUED_JOB_STALE_AFTER_MS: z.coerce.number().int().positive().default(45_000),
  SANDBOX_RUNNING_JOB_GRACE_MS: z.coerce.number().int().positive().default(15_000),
  SANDBOX_EXEC_NAMESPACE: z.string().min(1).default("persai-dev"),
  SANDBOX_EXEC_IMAGE: z.string().min(1).default("busybox:1.36"),
  SANDBOX_EXEC_RUNTIME_CLASS_NAME: z.string().min(1).default("gvisor"),
  SANDBOX_EXEC_NODE_SELECTOR_VALUE: z.string().min(1).default("sandbox"),
  // Dedicated identity-less KSA for untrusted execution pods. It intentionally
  // has no RBAC or Workload Identity annotation; token automount remains false.
  SANDBOX_EXEC_SERVICE_ACCOUNT_NAME: z.string().min(1).default("sandbox-exec-sa"),
  // Non-secret proxy URL injected into exec pod env. Empty string = no proxy.
  SANDBOX_EXEC_EGRESS_PROXY_URL: z.string().default(""),
  // Comma-separated list of hosts/CIDRs to bypass the proxy (NO_PROXY convention).
  SANDBOX_EXEC_NO_PROXY: z.string().default(""),
  // How long a session exec pod may sit idle before the reaper deletes it (ms). Default 15 min.
  SANDBOX_EXEC_SESSION_IDLE_TTL_MS: z.coerce.number().int().positive().default(900_000),
  // How often the idle-TTL reaper sweeps for stale session pods (ms). Default 2 min.
  SANDBOX_EXEC_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  // Max time allowed for a *cold-start* exec pod to reach Running. This is a
  // pod-PROVISIONING budget (cluster autoscaler bringing up a sandbox node + pulling
  // the multi-GB Python/Chromium exec image), which is unrelated to — and far larger
  // than — the per-command runtime cap (`maxProcessRuntimeMs`). Conflating the two
  // (using maxProcessRuntimeMs as the pod-ready deadline) made the first command on a
  // cold sandbox pool fail with process_timeout. Default 4 min; with a warm node +
  // pre-pulled image this budget is almost never approached.
  SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: z.coerce.number().int().positive().default(240_000),
  // Per-(assistantId, workspaceId) warm-pool size. v1: 1 = pre-create the session pod
  // in parallel with lease wait so cold pod-provisioning overlaps lease acquisition.
  // 0 = disable pre-warm (job's runInPod still creates lazily as before).
  SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: z.coerce.number().int().min(0).max(1).default(1),
  // ADR-128 Slice 4 — size of the flat `/workspace/` and `/tmp/` emptyDir
  // volumes mounted into every session pod. GCS remains durable truth; emptyDir
  // is the hot POSIX working copy. Default 512 MiB matches the workspace quota.
  SANDBOX_SHARED_EMPTYDIR_SIZE_MIB: z.coerce.number().int().positive().default(512),
  // ADR-126 Slice 3 — interval between WorkspaceGcService sweeps over
  // `sandbox_workspace_gc_lease` rows whose `scheduledAt <= now() AND purgedAt IS NULL`.
  // Default 5 minutes. The chat-scratch path also calls the reaper in-process after
  // a `hardDeleteChat` commit so the user does not wait for the next tick.
  SANDBOX_GC_INTERVAL_MS: z.coerce.number().int().positive().default(300_000)
});

const localSandboxConfigSchema = baseSandboxConfigSchema.extend({
  APP_ENV: z.literal("local")
});

const devSandboxConfigSchema = baseSandboxConfigSchema.extend({
  APP_ENV: z.literal("dev"),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1)
});

const sandboxConfigSchema = z.discriminatedUnion("APP_ENV", [
  localSandboxConfigSchema,
  devSandboxConfigSchema
]);

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadSandboxConfig(env: NodeJS.ProcessEnv): SandboxConfig {
  const parsed = sandboxConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid sandbox environment configuration: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}
