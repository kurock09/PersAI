import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import {
  buildScriptResultMarker,
  computeScriptExecutableContentHash,
  computeScriptInputHash
} from "../src/script-execution-support";
import { SandboxObservabilityService } from "../src/sandbox-observability.service";
import { SandboxService } from "../src/sandbox.service";

/**
 * ADR-151 — focused coverage of `SandboxService.submitJob`'s `script.execute`
 * admission path: atomic create-by-`(assistantId, scriptInvocationKey)`
 * BEFORE preflight/backlog consumption, P2002-driven winner/loser
 * resolution, and stable `idempotency_conflict` on a same-key
 * version/input mismatch. Deliberately does not exercise real pod
 * execution — `pollJob` with the default `waitMs=0` returns immediately
 * after admission without waiting for the fire-and-forget background job,
 * so these tests observe purely the synchronous admission contract.
 */

const scriptVersionId1 = "11111111-1111-4111-8111-111111111111";
const scriptVersionId2 = "22222222-2222-4222-8222-222222222222";
const assistantId = "assistant-script-1";
const workspaceId = "workspace-script-1";
const skillId = "skill-script-1";
const roleId = "role-script-1";

function executableArtifact(versionId: string) {
  const executable = {
    code: "echo hi",
    runtime: "bash",
    entryCommand: "bash -lc 'echo hi'",
    manifest: { schemaVersion: 1 as const, workingDirectory: null, environment: {} },
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
      additionalProperties: false
    },
    limits: {
      timeoutMs: 1_000,
      maxMemoryMb: 128,
      maxCpuMillicores: 500,
      maxOutputBytes: 1_024
    }
  };
  return {
    id: versionId,
    scriptId: "script-1",
    version: versionId === scriptVersionId1 ? 1 : 2,
    status: "published" as const,
    contentHash: computeScriptExecutableContentHash(executable),
    ...executable,
    script: { key: "sample_script", status: "published" as const }
  };
}

function executableArtifactWithWorkingDirectory(versionId: string, workingDirectory: string) {
  const base = executableArtifact(versionId);
  const changed = {
    ...base,
    manifest: { ...base.manifest, workingDirectory }
  };
  return { ...changed, contentHash: computeScriptExecutableContentHash(changed) };
}

const expectedContentHash = executableArtifact(scriptVersionId1).contentHash;

function createSandboxConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
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
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 900_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 240_000,
    SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0,
    ...overrides
  } as SandboxConfig;
}

type StoredJob = {
  id: string;
  assistantId: string;
  workspaceId: string;
  scriptVersionId: string | null;
  scriptInvocationKey: string | null;
  status: string;
  policySnapshot: Record<string, unknown> | null;
  resultPayload: Record<string, unknown> | null;
  violationCode: string | null;
  violationMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  toolCode: string;
};

/**
 * A minimal in-memory `sandboxJob` + `scriptVersion` Prisma double that
 * reproduces exactly the unique-constraint race `submitScriptExecuteJob`
 * depends on: `create` throws a `P2002`-shaped error when a row with the
 * same `(assistantId, scriptInvocationKey)` already exists, mirroring
 * Postgres's own compound unique index.
 */
function createScriptExecuteHarness(
  input: {
    blockPreflight?: boolean;
    execPodBridgeService?: unknown;
    artifactForRead?: (readNumber: number, versionId: string) => unknown;
    skillLinkForRead?: (readNumber: number) => unknown;
  } = {}
) {
  const jobsById = new Map<string, StoredJob>();
  const jobsByKey = new Map<string, string>();
  let nextJobSeq = 0;
  let createCallCount = 0;
  let preflightCallCount = 0;
  let artifactReadCount = 0;
  let skillLinkReadCount = 0;
  const preflightCountWhere: unknown[] = [];

  const prisma = {
    assistant: {
      async findUnique() {
        return { roleId };
      }
    },
    assistantRoleSkill: {
      async findUnique() {
        return { skill: { status: "active", archivedAt: null } };
      }
    },
    skillScript: {
      async findUnique() {
        skillLinkReadCount += 1;
        const custom = input.skillLinkForRead?.(skillLinkReadCount);
        return custom === undefined ? { skillId } : custom;
      }
    },
    scriptVersion: {
      async findUnique(args: { where: { id: string } }) {
        artifactReadCount += 1;
        return (
          input.artifactForRead?.(artifactReadCount, args.where.id) ??
          executableArtifact(args.where.id)
        );
      }
    },
    sandboxJob: {
      async create(args: { data: Record<string, unknown> }) {
        createCallCount += 1;
        const key = `${String(args.data.assistantId)}:${String(args.data.scriptInvocationKey)}`;
        if (jobsByKey.has(key)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        nextJobSeq += 1;
        const id = `job-${String(nextJobSeq)}`;
        const row: StoredJob = {
          id,
          assistantId: String(args.data.assistantId),
          workspaceId: String(args.data.workspaceId),
          scriptVersionId: (args.data.scriptVersionId as string | undefined) ?? null,
          scriptInvocationKey: (args.data.scriptInvocationKey as string | undefined) ?? null,
          status: String(args.data.status),
          policySnapshot: (args.data.policySnapshot as Record<string, unknown> | null) ?? null,
          resultPayload: null,
          violationCode: null,
          violationMessage: null,
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
          toolCode: String(args.data.toolCode)
        };
        jobsById.set(id, row);
        jobsByKey.set(key, id);
        return { id };
      },
      async findUnique(args: {
        where: { id?: string; assistantId_scriptInvocationKey?: Record<string, string> };
      }) {
        if (args.where.assistantId_scriptInvocationKey) {
          const key = `${args.where.assistantId_scriptInvocationKey.assistantId}:${args.where.assistantId_scriptInvocationKey.scriptInvocationKey}`;
          const id = jobsByKey.get(key);
          return id ? (jobsById.get(id) ?? null) : null;
        }
        if (args.where.id) {
          return jobsById.get(args.where.id) ?? null;
        }
        return null;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const row = jobsById.get(args.where.id);
        if (row) {
          Object.assign(row, args.data);
        }
        return row;
      },
      async updateMany(args: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) {
        const row = jobsById.get(args.where.id);
        if (!row) {
          return { count: 0 };
        }
        if (args.where.status !== undefined && row.status !== args.where.status) {
          return { count: 0 };
        }
        Object.assign(row, args.data);
        return { count: 1 };
      },
      async count(args: { where: unknown }) {
        preflightCallCount += 1;
        preflightCountWhere.push(args.where);
        return 0;
      },
      async findMany() {
        preflightCallCount += 1;
        return [];
      }
    },
    assistantWorkspaceLease: {
      async create(args: { data: Record<string, unknown> }) {
        return {
          id: "lease-script-test",
          assistantId: String(args.data.assistantId),
          workspaceId: String(args.data.workspaceId),
          sandboxJobId: null,
          leaseToken: String(args.data.leaseToken),
          holderId: String(args.data.holderId),
          expiresAt: args.data.expiresAt as Date
        };
      },
      async updateMany() {
        return { count: 1 };
      }
    }
  };

  const service = new SandboxService(
    prisma as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(input.blockPreflight === true ? { SANDBOX_MAX_PENDING_JOBS: 0 } : {}),
    (input.execPodBridgeService ?? {}) as never,
    {} as never
  );

  return {
    service,
    jobsById,
    jobsByKey,
    getCreateCallCount: () => createCallCount,
    getPreflightCallCount: () => preflightCallCount,
    getArtifactReadCount: () => artifactReadCount,
    getSkillLinkReadCount: () => skillLinkReadCount,
    preflightCountWhere
  };
}

function scriptRequest(overrides: Record<string, unknown> = {}) {
  return {
    assistantId,
    assistantHandle: "assistant-handle",
    siblingHandles: [],
    workspaceId,
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolCode: "script.execute",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { input: { query: "hello" } },
    scriptVersionId: scriptVersionId1,
    scriptSkillId: skillId,
    scriptContentHash: expectedContentHash,
    scriptInvocationKey: "invocation-key-fixed",
    ...overrides
  };
}

void test("submitJob(script.execute): atomic create-by-(assistantId,scriptInvocationKey) admits exactly one winner row; a same-key retry replays it instead of creating a second row", async () => {
  const { service, jobsById } = createScriptExecuteHarness({ blockPreflight: true });

  const first = await service.submitJob(scriptRequest() as never);
  const second = await service.submitJob(scriptRequest() as never);

  assert.equal(first.jobId, second.jobId, "both calls must resolve to the exact same jobId");
  assert.equal(jobsById.size, 1, "only one job row must ever be persisted for the same key");
});

void test("submitJob(script.execute): atomic-create runs BEFORE preflight/backlog consumption — a same-key replay never re-runs preflight checks", async () => {
  const { service, getPreflightCallCount } = createScriptExecuteHarness({ blockPreflight: true });

  await service.submitJob(scriptRequest() as never);
  const preflightCallsAfterWinner = getPreflightCallCount();
  assert.ok(preflightCallsAfterWinner > 0, "the winner must run ordinary preflight/backlog checks");

  await service.submitJob(scriptRequest() as never);
  assert.equal(
    getPreflightCallCount(),
    preflightCallsAfterWinner,
    "a same-key loser must resolve via the winner's own admitted row without ever reaching preflight/backlog checks again"
  );
});

void test("submitJob(script.execute): winner row is excluded from backlog and daily-quota preflight counts", async () => {
  const { service, preflightCountWhere } = createScriptExecuteHarness({ blockPreflight: true });
  await service.submitJob(scriptRequest() as never);
  assert.ok(preflightCountWhere.length >= 2);
  for (const where of preflightCountWhere) {
    assert.deepEqual((where as { id?: unknown }).id, { not: "job-1" });
  }
});

void test("submitJob(script.execute): a same-key call pinned to a DIFFERENT scriptVersionId returns a stable idempotency_conflict, never a silent second execution", async () => {
  const { service, jobsById } = createScriptExecuteHarness({ blockPreflight: true });

  await service.submitJob(scriptRequest({ scriptVersionId: scriptVersionId1 }) as never);
  const conflicted = await service.submitJob(
    scriptRequest({ scriptVersionId: scriptVersionId2 }) as never
  );

  assert.equal(conflicted.reason, "idempotency_conflict");
  assert.equal(conflicted.violationCode, "idempotency_conflict");
  assert.equal(jobsById.size, 1, "the conflicting call must not create a second job row");
});

void test("submitJob(script.execute): a same-key call with DIFFERENT canonical input hash returns a stable idempotency_conflict", async () => {
  const { service, jobsById } = createScriptExecuteHarness({ blockPreflight: true });

  await service.submitJob(scriptRequest({ args: { input: { query: "hello" } } }) as never);
  const conflicted = await service.submitJob(
    scriptRequest({ args: { input: { query: "a completely different question" } } }) as never
  );

  assert.equal(conflicted.reason, "idempotency_conflict");
  assert.equal(jobsById.size, 1);
});

void test("submitJob(script.execute): a same-key call with the SAME scriptVersionId and SAME canonical input replays cleanly (no conflict)", async () => {
  const { service } = createScriptExecuteHarness({ blockPreflight: true });

  const first = await service.submitJob(
    scriptRequest({ args: { input: { limit: 10, query: "hello" } } }) as never
  );
  // Canonically-equal input with keys in a different order must hash identically.
  const second = await service.submitJob(
    scriptRequest({ args: { input: { query: "hello", limit: 10 } } }) as never
  );

  assert.equal(second.reason, first.reason);
  assert.notEqual(second.reason, "idempotency_conflict");
  assert.equal(second.jobId, first.jobId);
});

void test("submitJob(script.execute): a same-key retry against an already-terminal job with the SAME version+input replays the persisted terminal result verbatim, without re-executing", async () => {
  const { service, jobsById, jobsByKey, getCreateCallCount } = createScriptExecuteHarness({});
  const request = scriptRequest();
  const exactInputHash = computeScriptInputHash(request.args.input);

  // Seed a job row directly in the terminal "completed" state, as if the
  // winner's background execution had already finished — using the exact
  // canonical hash this request's input actually produces.
  jobsById.set("job-terminal", {
    id: "job-terminal",
    assistantId,
    workspaceId,
    scriptVersionId: scriptVersionId1,
    scriptInvocationKey: "invocation-key-fixed",
    status: "completed",
    policySnapshot: { scriptInputHash: exactInputHash },
    resultPayload: {
      reason: null,
      warning: null,
      exitCode: 0,
      stdout: null,
      stderr: null,
      content: '{"result":"ok"}'
    },
    violationCode: null,
    violationMessage: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    toolCode: "script.execute"
  });
  jobsByKey.set(`${assistantId}:invocation-key-fixed`, "job-terminal");

  const submitted = await service.submitJob(request as never);

  assert.equal(submitted.jobId, "job-terminal");
  assert.equal(submitted.status, "completed");
  assert.equal(submitted.content, '{"result":"ok"}');
  assert.equal(jobsById.size, 1, "no second job row must ever be created for the same key");
  assert.equal(getCreateCallCount(), 1, "the pre-seeded terminal row must not be re-created");
});

void test("submitJob(script.execute): a same-key retry against an already-terminal job with a DIFFERENT input still fails closed with idempotency_conflict rather than replaying a mismatched result", async () => {
  const { service, jobsById, jobsByKey } = createScriptExecuteHarness({});
  const request = scriptRequest({ args: { input: { query: "hello" } } });

  jobsById.set("job-terminal-mismatch", {
    id: "job-terminal-mismatch",
    assistantId,
    workspaceId,
    scriptVersionId: scriptVersionId1,
    scriptInvocationKey: "invocation-key-fixed",
    status: "completed",
    policySnapshot: {
      scriptInputHash: computeScriptInputHash({ query: "a totally different input" })
    },
    resultPayload: {
      reason: null,
      warning: null,
      exitCode: 0,
      stdout: null,
      stderr: null,
      content: "{}"
    },
    violationCode: null,
    violationMessage: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    toolCode: "script.execute"
  });
  jobsByKey.set(`${assistantId}:invocation-key-fixed`, "job-terminal-mismatch");

  const submitted = await service.submitJob(request as never);

  assert.equal(submitted.reason, "idempotency_conflict");
  assert.equal(submitted.jobId, "job-terminal-mismatch");
  assert.equal(jobsById.size, 1);
});

void test("submitJob(script.execute): only the winning admission actually executes the Script; a same-key loser observes the winner's real completion without triggering a second pod exec", async () => {
  const runInPodCalls: Array<{ jobId: string }> = [];
  const execPodBridgeService = {
    async runInPod(callInput: { jobId: string }) {
      runInPodCalls.push({ jobId: callInput.jobId });
      const binding = {
        jobId: callInput.jobId,
        assistantId,
        workspaceId,
        podName: "ses-script-test",
        podUid: "pod-uid",
        namespace: "default",
        mode: "ephemeral" as const,
        leaseToken: "lease-token",
        leaseHolderId: "holder"
      };
      return {
        exitCode: 0,
        stdout: `${buildScriptResultMarker("invocation-key-fixed")}\n{"result":"ok"}`,
        stderr: "",
        durationMs: 5,
        execPodName: "ses-script-test",
        execPodBinding: binding
      };
    },
    async cleanupBoundScriptTransientDirectory() {},
    async retireModelJobPod() {
      return { podName: "ses-script-test", retired: true };
    }
  };
  const { service, jobsById } = createScriptExecuteHarness({ execPodBridgeService });

  // No runtimeSessionId: keeps this test focused on admission/execution
  // counting without touching the (separately covered) session-snapshot path.
  const request = scriptRequest({ runtimeSessionId: null });

  const first = await service.submitJob(request as never);
  // Give the winner's fire-and-forget background execution a chance to run
  // to completion before the same-key loser is submitted.
  let attempts = 0;
  while (jobsById.get(first.jobId)?.status !== "completed" && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.equal(jobsById.get(first.jobId)?.status, "completed", "winner must reach completed");
  assert.equal(runInPodCalls.length, 1, "the winner must execute exactly once");

  const second = await service.submitJob(request as never);
  assert.equal(second.jobId, first.jobId, "the loser must observe the winner's own job");
  assert.equal(second.status, "completed");
  assert.equal(second.content, '{"result":"ok"}');
  assert.equal(
    runInPodCalls.length,
    1,
    "a same-key loser must never trigger a second pod execution"
  );
  assert.equal(jobsById.size, 1, "only one job row must exist for the shared key");
});

void test("submitJob(script.execute): sandbox re-authorizes immediately before execution and blocks an archive TOCTOU", async () => {
  let runCalls = 0;
  const { service, jobsById, getArtifactReadCount } = createScriptExecuteHarness({
    artifactForRead: (readNumber, versionId) => ({
      ...executableArtifact(versionId),
      script: {
        key: "sample_script",
        status: readNumber === 1 ? ("published" as const) : ("archived" as const)
      }
    }),
    execPodBridgeService: {
      async runInPod() {
        runCalls += 1;
        throw new Error("must not execute");
      }
    }
  });
  const submitted = await service.submitJob(scriptRequest({ runtimeSessionId: null }) as never);
  let attempts = 0;
  while (
    !["failed", "blocked", "cancelled"].includes(jobsById.get(submitted.jobId)?.status ?? "") &&
    attempts < 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.equal(getArtifactReadCount(), 2);
  assert.equal(runCalls, 0);
  assert.equal(jobsById.get(submitted.jobId)?.violationCode, "runtime_script_archived");
});

void test("submitJob(script.execute): sandbox re-authorizes immediately before execution and blocks an unlink TOCTOU", async () => {
  let runCalls = 0;
  const { service, jobsById, getSkillLinkReadCount } = createScriptExecuteHarness({
    skillLinkForRead: (readNumber) => (readNumber === 1 ? { skillId } : null),
    execPodBridgeService: {
      async runInPod() {
        runCalls += 1;
        throw new Error("must not execute");
      }
    }
  });
  const submitted = await service.submitJob(scriptRequest({ runtimeSessionId: null }) as never);
  let attempts = 0;
  while (
    !["failed", "blocked", "cancelled"].includes(jobsById.get(submitted.jobId)?.status ?? "") &&
    attempts < 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.equal(getSkillLinkReadCount(), 2);
  assert.equal(runCalls, 0);
  assert.equal(jobsById.get(submitted.jobId)?.violationCode, "runtime_script_unlinked");
});

void test("submitJob(script.execute): transient cleanup failure retires the bound pod fail closed", async () => {
  let retireCalls = 0;
  const binding = {
    jobId: "job-1",
    assistantId,
    workspaceId,
    podName: "ses-script-test",
    podUid: "pod-uid",
    namespace: "default",
    mode: "session" as const,
    leaseToken: "lease-token",
    leaseHolderId: "holder"
  };
  const { service, jobsById } = createScriptExecuteHarness({
    execPodBridgeService: {
      async runInPod(input: { onBound?: (value: typeof binding) => void }) {
        input.onBound?.(binding);
        return {
          exitCode: 0,
          stdout: `${buildScriptResultMarker("invocation-key-fixed")}\n{"result":"ok"}`,
          stderr: "",
          durationMs: 5,
          execPodName: binding.podName,
          execPodBinding: binding
        };
      },
      async cleanupBoundScriptTransientDirectory() {
        throw Object.assign(new Error("cleanup failed"), {
          code: "sandbox_script_transient_cleanup_failed",
          blocked: true
        });
      },
      async cleanupBoundSessionPod() {
        throw new Error("retired pod cannot be cleaned");
      },
      async retireModelJobPod() {
        retireCalls += 1;
        return { podName: binding.podName, podUid: binding.podUid, retired: true };
      }
    }
  });
  const submitted = await service.submitJob(scriptRequest({ runtimeSessionId: null }) as never);
  let attempts = 0;
  while (
    !["failed", "blocked", "cancelled"].includes(jobsById.get(submitted.jobId)?.status ?? "") &&
    attempts < 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.ok(retireCalls >= 1);
  assert.equal(
    jobsById.get(submitted.jobId)?.violationCode,
    "sandbox_script_transient_cleanup_failed"
  );
});

void test("submitJob(script.execute): direct stdout framing-budget overflow persists stdout_limit_exceeded instead of script_output_missing", async () => {
  const { service, jobsById } = createScriptExecuteHarness({
    execPodBridgeService: {
      async runInPod() {
        throw Object.assign(new Error("Sandbox stdout exceeded the effective output budget."), {
          code: "stdout_limit_exceeded",
          blocked: true
        });
      }
    }
  });
  const submitted = await service.submitJob(scriptRequest({ runtimeSessionId: null }) as never);
  let attempts = 0;
  while (
    !["failed", "blocked", "cancelled"].includes(jobsById.get(submitted.jobId)?.status ?? "") &&
    attempts < 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.equal(jobsById.get(submitted.jobId)?.violationCode, "stdout_limit_exceeded");
  assert.notEqual(jobsById.get(submitted.jobId)?.violationCode, "script_output_missing");
});

void test("submitJob(script.execute): manifest workingDirectory uses safe shell/exec cwd resolution for relative and full workspace paths", async () => {
  for (const [workingDirectory, expectedSuffix] of [
    ["reports", "/assistants/assistant-script-1/shared/reports"],
    ["/workspace/assistants/assistant-script-1/reports", "/assistants/assistant-script-1/reports"]
  ] as const) {
    const artifact = executableArtifactWithWorkingDirectory(scriptVersionId1, workingDirectory);
    let capturedCwd = "";
    const binding = {
      jobId: "job-1",
      assistantId,
      workspaceId,
      podName: "ses-script-cwd",
      podUid: "pod-uid",
      namespace: "default",
      mode: "ephemeral" as const,
      leaseToken: "lease-token",
      leaseHolderId: "holder"
    };
    const { service, jobsById } = createScriptExecuteHarness({
      artifactForRead: () => artifact,
      execPodBridgeService: {
        async runInPod(input: { absoluteCwd: string; onBound?: (value: typeof binding) => void }) {
          capturedCwd = input.absoluteCwd.replace(/\\/g, "/");
          input.onBound?.(binding);
          return {
            exitCode: 0,
            stdout: `${buildScriptResultMarker("invocation-key-fixed")}\n{"result":"ok"}`,
            stderr: "",
            durationMs: 5,
            execPodName: binding.podName,
            execPodBinding: binding
          };
        },
        async cleanupBoundScriptTransientDirectory() {},
        async retireModelJobPod() {
          return { podName: binding.podName, podUid: binding.podUid, retired: true };
        }
      }
    });
    const submitted = await service.submitJob(
      scriptRequest({
        runtimeSessionId: null,
        scriptContentHash: artifact.contentHash
      }) as never
    );
    let attempts = 0;
    while (jobsById.get(submitted.jobId)?.status !== "completed" && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      attempts += 1;
    }
    assert.ok(capturedCwd.endsWith(expectedSuffix), capturedCwd);
  }
});

void test("submitJob(script.execute): manifest workingDirectory traversal is rejected before pod execution", async () => {
  const artifact = executableArtifactWithWorkingDirectory(scriptVersionId1, "../escape");
  let runCalls = 0;
  const { service, jobsById } = createScriptExecuteHarness({
    artifactForRead: () => artifact,
    execPodBridgeService: {
      async runInPod() {
        runCalls += 1;
        throw new Error("must not execute");
      }
    }
  });
  const submitted = await service.submitJob(
    scriptRequest({
      runtimeSessionId: null,
      scriptContentHash: artifact.contentHash
    }) as never
  );
  let attempts = 0;
  while (
    !["failed", "blocked", "cancelled"].includes(jobsById.get(submitted.jobId)?.status ?? "") &&
    attempts < 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    attempts += 1;
  }
  assert.equal(runCalls, 0);
  assert.notEqual(jobsById.get(submitted.jobId)?.violationCode, null);
});
