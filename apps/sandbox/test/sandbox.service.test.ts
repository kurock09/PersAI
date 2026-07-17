import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SandboxConfig } from "@persai/config";
import {
  buildAssistantSessionRoot,
  DEFAULT_RUNTIME_SANDBOX_POLICY
} from "@persai/runtime-contract";
import { SandboxObservabilityService } from "../src/sandbox-observability.service";
import { SandboxService } from "../src/sandbox.service";

type SandboxServiceTestAccess = {
  executeQueuedJob(
    jobId: string,
    request: {
      assistantId: string;
      workspaceId: string;
      runtimeRequestId: string | null;
      runtimeSessionId: string | null;
      toolCode: string;
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY;
      args: Record<string, unknown>;
      assistantHandle?: string | null;
      siblingHandles?: readonly string[] | null;
    }
  ): Promise<void>;
  resolveWorkspaceRoot(workspaceId: string): string;
  saveSessionWorkspaceSnapshot(
    assistantId: string,
    runtimeSessionId: string,
    workspaceRoot: string
  ): Promise<void>;
  restoreSessionSnapshotOverlay(
    assistantId: string,
    runtimeSessionId: string,
    workspaceRoot: string
  ): Promise<void>;
};

async function listWorkspaceRelativeFiles(workspaceRoot: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (currentDir: string): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      output.push(absolutePath.slice(workspaceRoot.length + 1).replace(/\\/g, "/"));
    }
  };
  try {
    await visit(workspaceRoot);
  } catch {
    return [];
  }
  return output;
}

function createLeasePrismaStub() {
  return {
    sandboxJob: {
      async update(input: { where: { id: string }; data: Record<string, unknown> }) {
        return { id: input.where.id, ...input.data };
      },
      async updateMany() {
        return { count: 1 };
      },
      async findUnique() {
        return null;
      }
    },
    assistantWorkspaceLease: {
      async create(input: { data: Record<string, unknown> }) {
        return {
          id: "lease-1",
          assistantId: String(input.data.assistantId),
          workspaceId: String(input.data.workspaceId),
          sandboxJobId: null,
          leaseToken: String(input.data.leaseToken),
          holderId: String(input.data.holderId),
          expiresAt: input.data.expiresAt as Date
        };
      },
      async updateMany() {
        return { count: 1 };
      }
    }
  } as never;
}
const RETRYABLE_WINDOWS_RM_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

async function removePathWithRetries(path: string): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await fs.rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      if (!code || !RETRYABLE_WINDOWS_RM_CODES.has(code) || attempt === 20) {
        throw error;
      }
      // Windows can keep a just-killed child process directory briefly locked,
      // especially under the shared tmpdir sandbox root used across this suite.
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, attempt * 150)));
    }
  }
}

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
    SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 1,
    ...overrides
  } as SandboxConfig;
}

function createSandboxObservabilityService(): SandboxObservabilityService {
  return new SandboxObservabilityService();
}

async function run(): Promise<void> {
  const completedService = new SandboxService(
    {
      sandboxJob: {
        async findUnique(input: { where: { id: string } }) {
          assert.equal(input.where.id, "job-completed-1");
          return {
            id: "job-completed-1",
            status: "completed",
            toolCode: "render_html_to_pdf",
            violationCode: null,
            violationMessage: null,
            resultPayload: {
              reason: null,
              warning: null,
              exitCode: 0,
              stdout: null,
              stderr: null,
              content: null,
              producedFiles: [
                {
                  relativePath: "document.pdf",
                  displayName: "document.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 64,
                  logicalSizeBytes: 64,
                  storagePath:
                    "assistant-media/assistants/a1/sandbox/jobs/job-completed-1/document.pdf"
                }
              ]
            }
          };
        }
      }
    } as never,
    {} as never,
    createSandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const completedJob = await completedService.pollJob("job-completed-1");
  assert.equal(completedJob.status, "completed");
  assert.equal(
    completedJob.files[0]?.storagePath,
    "assistant-media/assistants/a1/sandbox/jobs/job-completed-1/document.pdf"
  );
  assert.equal(completedJob.files[0]?.displayName, "document.pdf");

  let storedJob: {
    id: string;
    toolCode: string;
    status: string;
    resultPayload: unknown;
    violationCode: string | null;
    violationMessage: string | null;
  } | null = null;
  const blockedService = new SandboxService(
    {
      sandboxJob: {
        async findMany() {
          return [];
        },
        async count(input: { where: Record<string, unknown> }) {
          if ("createdAt" in input.where) {
            return 1;
          }
          return 0;
        },
        async create(input: { data: Record<string, unknown> }) {
          storedJob = {
            id: "job-blocked-1",
            toolCode: String(input.data.toolCode),
            status: String(input.data.status),
            resultPayload: input.data.resultPayload ?? null,
            violationCode:
              typeof input.data.violationCode === "string" ? input.data.violationCode : null,
            violationMessage:
              typeof input.data.violationMessage === "string" ? input.data.violationMessage : null
          };
          return storedJob;
        },
        async findUnique() {
          return storedJob;
        }
      }
    } as never,
    {} as never,
    createSandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );

  const blockedJob = await blockedService.submitJob({
    assistantId: "assistant-1",
    assistantHandle: "a-test",
    siblingHandles: [],
    workspaceId: "workspace-1",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolCode: "files",
    policy: {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true,
      sandboxJobsPerDay: 1
    },
    args: {
      action: "write",
      path: "outputs/report.txt",
      content: "daily quota should block this job"
    },
    scriptVersionId: null,
    scriptSkillId: null,
    scriptContentHash: null,
    scriptInvocationKey: null
  });

  assert.equal(blockedJob.status, "blocked");
  assert.equal(blockedJob.reason, "sandbox_daily_job_limit_reached");

  let backlogStoredJob: {
    id: string;
    toolCode: string;
    status: string;
    resultPayload: unknown;
    violationCode: string | null;
    violationMessage: string | null;
  } | null = null;
  const backlogService = new SandboxService(
    {
      sandboxJob: {
        async findMany() {
          return [];
        },
        async count(input: { where: Record<string, unknown> }) {
          return "createdAt" in input.where ? 0 : 1;
        },
        async create(input: { data: Record<string, unknown> }) {
          backlogStoredJob = {
            id: "job-backlog-1",
            toolCode: String(input.data.toolCode),
            status: String(input.data.status),
            resultPayload: input.data.resultPayload ?? null,
            violationCode:
              typeof input.data.violationCode === "string" ? input.data.violationCode : null,
            violationMessage:
              typeof input.data.violationMessage === "string" ? input.data.violationMessage : null
          };
          return backlogStoredJob;
        },
        async findUnique() {
          return backlogStoredJob;
        }
      }
    } as never,
    {} as never,
    createSandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_MAX_PENDING_JOBS: 1 }),
    {} as never,
    {} as never
  );
  const backlogJob = await backlogService.submitJob({
    assistantId: "assistant-1",
    assistantHandle: "a-test",
    siblingHandles: [],
    workspaceId: "workspace-1",
    runtimeRequestId: "request-backlog",
    runtimeSessionId: "session-backlog",
    toolCode: "files",
    policy: {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true,
      sandboxJobsPerDay: null
    },
    args: {
      action: "write",
      path: "outputs/report.txt",
      content: "backlog should block this job"
    },
    scriptVersionId: null,
    scriptSkillId: null,
    scriptContentHash: null,
    scriptInvocationKey: null
  });
  assert.equal(backlogJob.status, "blocked");
  assert.equal(backlogJob.reason, "sandbox_backlog_full");

  const staleObservability = createSandboxObservabilityService();
  let staleJob = {
    id: "job-stale-queued-1",
    toolCode: "files",
    status: "queued",
    policySnapshot: DEFAULT_RUNTIME_SANDBOX_POLICY,
    resultPayload: null,
    violationCode: null,
    violationMessage: null,
    createdAt: new Date(Date.now() - 2_000),
    startedAt: null,
    completedAt: null
  };
  const staleService = new SandboxService(
    {
      sandboxJob: {
        async findUnique() {
          return staleJob;
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          staleJob = {
            ...staleJob,
            ...input.data
          };
          return { count: 1 };
        }
      }
    } as never,
    {} as never,
    staleObservability,
    createSandboxConfig({ SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 1_000 }),
    {} as never,
    {} as never
  );
  const staleResult = await staleService.pollJob("job-stale-queued-1", 25);
  assert.equal(staleResult.status, "failed");
  assert.equal(staleResult.reason, "sandbox_queue_timeout");
  assert.equal(staleObservability.getCounters().staleFailures.queued, 1);
}

void run();

// ---------------------------------------------------------------------------
// Session workspace snapshot tests
// ---------------------------------------------------------------------------

test("SandboxService: session snapshot key uses assistant+session identity", () => {
  const storedObjects = new Map<string, Buffer>();
  const objectStorageStub = {
    buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${input.relativePath}`;
    },
    buildSessionSnapshotKey(input: { assistantId: string; runtimeSessionId: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox-sessions/${input.runtimeSessionId}/workspace.tar`;
    },
    async saveObject(input: { objectKey: string; buffer: Buffer }) {
      storedObjects.set(input.objectKey, Buffer.from(input.buffer));
      return input.buffer.length;
    },
    async downloadObject(objectKey: string) {
      const stored = storedObjects.get(objectKey);
      if (!stored) {
        throw new Error(`Missing stored object "${objectKey}" in test store`);
      }
      return Buffer.from(stored);
    }
  };

  // buildSessionSnapshotKey encodes both assistantId and runtimeSessionId.
  const key = objectStorageStub.buildSessionSnapshotKey({
    assistantId: "asst-123",
    runtimeSessionId: "sess-abc"
  });
  assert.ok(key.includes("asst-123"), "key must contain assistantId");
  assert.ok(key.includes("sess-abc"), "key must contain runtimeSessionId");
  assert.ok(key.endsWith(".tar"), "key must end with .tar");

  // Different session → different key.
  const key2 = objectStorageStub.buildSessionSnapshotKey({
    assistantId: "asst-123",
    runtimeSessionId: "sess-xyz"
  });
  assert.notEqual(key, key2, "different sessions must produce different keys");

  // Different assistant → different key.
  const key3 = objectStorageStub.buildSessionSnapshotKey({
    assistantId: "asst-999",
    runtimeSessionId: "sess-abc"
  });
  assert.notEqual(key, key3, "different assistants must produce different keys");
});

test("SandboxService: saveSessionWorkspaceSnapshot writes to GCS with session key", async () => {
  const storedObjects = new Map<string, Buffer>();
  const saveCallKeys: string[] = [];

  const objectStorageStub = {
    buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${input.relativePath}`;
    },
    buildSessionSnapshotKey(input: { assistantId: string; runtimeSessionId: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox-sessions/${input.runtimeSessionId}/workspace.tar`;
    },
    async saveObject(input: { objectKey: string; buffer: Buffer }) {
      saveCallKeys.push(input.objectKey);
      storedObjects.set(input.objectKey, Buffer.from(input.buffer));
      return input.buffer.length;
    },
    async downloadObject(objectKey: string) {
      const stored = storedObjects.get(objectKey);
      if (!stored) {
        throw new Error(`Missing stored object "${objectKey}" in test store`);
      }
      return Buffer.from(stored);
    }
  };

  const service = new SandboxService(
    {} as never,
    objectStorageStub as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const access = service as unknown as SandboxServiceTestAccess;

  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-snap-save-"));
  try {
    await fs.writeFile(join(workspaceRoot, "hello.txt"), "world", "utf8");

    await access.saveSessionWorkspaceSnapshot("asst-save", "sess-save-1", workspaceRoot);

    const expectedKey =
      "assistant-media/assistants/asst-save/sandbox-sessions/sess-save-1/workspace.tar";
    assert.ok(
      saveCallKeys.some((k) => k === expectedKey),
      `saveObject must be called with session snapshot key, got: ${String(saveCallKeys)}`
    );
    assert.ok(storedObjects.has(expectedKey), "snapshot must be stored in GCS");

    const storedBuffer = storedObjects.get(expectedKey);
    assert.ok(
      storedBuffer !== undefined && storedBuffer.length > 0,
      "stored snapshot must be non-empty"
    );
  } finally {
    await removePathWithRetries(workspaceRoot);
  }
});

test("SandboxService: restoreSessionSnapshotOverlay is a no-op when no snapshot exists (first session)", async () => {
  const objectStorageStub = {
    buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${input.relativePath}`;
    },
    buildSessionSnapshotKey(input: { assistantId: string; runtimeSessionId: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox-sessions/${input.runtimeSessionId}/workspace.tar`;
    },
    async saveObject(input: { objectKey: string; buffer: Buffer }) {
      return input.buffer.length;
    },
    async downloadObject(objectKey: string) {
      // Simulate GCS 404 for missing snapshot.
      throw new Error(`Missing stored object "${objectKey}" in test store`);
    }
  };

  const service = new SandboxService(
    {} as never,
    objectStorageStub as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const access = service as unknown as SandboxServiceTestAccess;

  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-snap-restore-"));
  try {
    await fs.writeFile(join(workspaceRoot, "existing.txt"), "declared content", "utf8");

    // Must not throw even though no snapshot exists.
    await assert.doesNotReject(
      access.restoreSessionSnapshotOverlay("asst-restore", "sess-first", workspaceRoot)
    );

    // Existing declared file must be untouched.
    const content = await fs.readFile(join(workspaceRoot, "existing.txt"), "utf8");
    assert.equal(content, "declared content", "declared file must be preserved");
  } finally {
    await removePathWithRetries(workspaceRoot);
  }
});

test("SandboxService: session snapshot round-trip — save then restore adds ephemeral files", async () => {
  const storedObjects = new Map<string, Buffer>();
  const objectStorageStub = {
    buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${input.relativePath}`;
    },
    buildSessionSnapshotKey(input: { assistantId: string; runtimeSessionId: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox-sessions/${input.runtimeSessionId}/workspace.tar`;
    },
    async saveObject(input: { objectKey: string; buffer: Buffer }) {
      storedObjects.set(input.objectKey, Buffer.from(input.buffer));
      return input.buffer.length;
    },
    async downloadObject(objectKey: string) {
      const stored = storedObjects.get(objectKey);
      if (!stored) {
        throw new Error(`Missing stored object "${objectKey}" in test store`);
      }
      return Buffer.from(stored);
    }
  };

  const service = new SandboxService(
    {} as never,
    objectStorageStub as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const access = service as unknown as SandboxServiceTestAccess;

  // Source workspace: declared file + ephemeral file.
  const sourceRoot = await fs.mkdtemp(join(tmpdir(), "persai-snap-src-"));
  // Restore workspace: declared file already present (from hydration).
  const restoreRoot = await fs.mkdtemp(join(tmpdir(), "persai-snap-dst-"));
  try {
    await fs.writeFile(join(sourceRoot, "declared.txt"), "declared content", "utf8");
    await fs.writeFile(join(sourceRoot, "ephemeral.py"), "print('hello')", "utf8");

    // Save the snapshot (tars both files).
    await access.saveSessionWorkspaceSnapshot("asst-rt", "sess-rt", sourceRoot);

    // Restore destination already has declared.txt (from hydration).
    await fs.writeFile(join(restoreRoot, "declared.txt"), "declared content", "utf8");

    // Restore overlay should add ephemeral.py but not overwrite declared.txt.
    await access.restoreSessionSnapshotOverlay("asst-rt", "sess-rt", restoreRoot);

    const declaredContent = await fs.readFile(join(restoreRoot, "declared.txt"), "utf8");
    assert.equal(declaredContent, "declared content", "declared file must not be overwritten");

    const ephemeralContent = await fs.readFile(join(restoreRoot, "ephemeral.py"), "utf8");
    assert.equal(
      ephemeralContent,
      "print('hello')",
      "ephemeral file must be restored from snapshot"
    );
  } finally {
    await removePathWithRetries(sourceRoot);
    await removePathWithRetries(restoreRoot);
  }
});

test("SandboxService: control-plane workspace write can hydrate bytes from workspace storage", async () => {
  const assistantSharedRoot = "/workspace/assistants/writer";
  let downloadedObjectKey: string | null = null;
  let capturedWrite: { basename: string; contents: Buffer } | null = null;
  const service = new SandboxService(
    {} as never,
    {
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `fs/workspaces/${input.workspaceId}${input.workspaceRelPath}`;
      },
      async downloadObject(objectKey: string) {
        downloadedObjectKey = objectKey;
        return Buffer.from("csv-bytes", "utf8");
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {
      async writeWorkspaceFileControlPlane(
        _ctx: unknown,
        input: { basename: string; contents: Buffer }
      ) {
        capturedWrite = input;
        return {
          success: true,
          reason: null,
          latencyMs: 1,
          data: {
            workspaceRelPath: `${assistantSharedRoot}/${input.basename}`,
            absolutePath: `${assistantSharedRoot}/${input.basename}`,
            bytes: input.contents.length,
            mode: "written" as const
          }
        };
      }
    } as never
  );

  const result = await service.writeWorkspaceFileControlPlane({
    assistantId: "assistant-write-1",
    workspaceId: "workspace-write-1",
    assistantHandle: "writer",
    siblingHandles: [],
    basename: "LOG006.01 (2).csv",
    storagePath: `${assistantSharedRoot}/LOG006.01 (2).csv`,
    mimeType: "text/csv"
  });

  assert.deepEqual(result, {
    ok: true,
    mode: "written",
    workspaceRelPath: `${assistantSharedRoot}/LOG006.01 (2).csv`,
    sizeBytes: 9
  });
  assert.equal(
    downloadedObjectKey,
    `fs/workspaces/workspace-write-1${assistantSharedRoot}/LOG006.01 (2).csv`
  );
  assert.notEqual(capturedWrite, null);
  const write = capturedWrite as unknown as { basename: string; contents: Buffer };
  assert.equal(write.basename, "LOG006.01 (2).csv");
  assert.equal(write.contents.toString("utf8"), "csv-bytes");
});

test("SandboxService: control-plane workspace write forwards replace for explicit paths", async () => {
  const assistantSharedDocPath = "/workspace/assistants/writer/docs/report.pdf";
  let capturedWrite: {
    basename: string;
    path: string | null;
    contents: Buffer;
    replace?: boolean;
  } | null = null;
  const service = new SandboxService(
    {} as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {
      async writeWorkspaceFileControlPlane(
        _ctx: unknown,
        input: {
          basename: string;
          path?: string | null;
          contents: Buffer;
          replace?: boolean;
        }
      ) {
        capturedWrite = {
          basename: input.basename,
          path: input.path ?? null,
          contents: input.contents,
          ...(input.replace === undefined ? {} : { replace: input.replace })
        };
        return {
          success: true,
          reason: null,
          latencyMs: 1,
          data: {
            workspaceRelPath: assistantSharedDocPath,
            absolutePath: assistantSharedDocPath,
            bytes: input.contents.length,
            mode: "written" as const
          }
        };
      }
    } as never
  );

  const result = await service.writeWorkspaceFileControlPlane({
    assistantId: "assistant-write-3",
    workspaceId: "workspace-write-3",
    assistantHandle: "writer",
    siblingHandles: [],
    basename: "report.pdf",
    path: assistantSharedDocPath,
    contents: Buffer.from("pdf"),
    replace: true,
    mimeType: "application/pdf"
  });

  assert.deepEqual(result, {
    ok: true,
    mode: "written",
    workspaceRelPath: assistantSharedDocPath,
    sizeBytes: 3
  });
  assert.deepEqual(capturedWrite, {
    basename: "report.pdf",
    path: assistantSharedDocPath,
    contents: Buffer.from("pdf"),
    replace: true
  });
});

test("SandboxService: render_html_to_pdf runs weasyprint command and removes transient .render-input.html", async () => {
  const capturedRunInPodCalls: Array<{
    command: string;
    args: string[];
    jobId: string;
  }> = [];

  // Fake PDF bytes that the mock weasyprint writes into the workspace.
  const fakePdfBytes = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "utf8"),
    Buffer.alloc(500, "X"),
    Buffer.from("\n%%EOF", "utf8")
  ]);

  const storedObjects = new Map<string, Buffer>();

  const service = new SandboxService(
    createLeasePrismaStub(),
    {
      buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
        return `sandbox/${input.assistantId}/${input.jobId}/${input.relativePath}`;
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer }) {
        storedObjects.set(input.objectKey, Buffer.from(input.buffer));
        return input.buffer.length;
      },
      async downloadObject(objectKey: string) {
        const stored = storedObjects.get(objectKey);
        if (stored === undefined) {
          throw new Error(`Missing stored object "${objectKey}"`);
        }
        return Buffer.from(stored);
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {
      async runInPod(input: {
        jobId: string;
        command: string;
        args: string[];
        workspaceRoot: string;
        absoluteCwd: string;
        policy: unknown;
        runtimeSessionId: string | null;
      }) {
        capturedRunInPodCalls.push({
          command: input.command,
          args: input.args,
          jobId: input.jobId
        });
        const outputFile = input.args[1]!.replace("/workspace/", "");
        await fs.writeFile(join(input.workspaceRoot, outputFile), fakePdfBytes);
        return { exitCode: 0, stdout: null, stderr: null, durationMs: 100, execPodName: null };
      },
      async retireModelJobPod() {
        return { podName: "exec-render", retired: true };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("render-job-1", {
    assistantId: "assistant-render-1",
    workspaceId: "workspace-render-1",
    runtimeRequestId: "request-render-1",
    runtimeSessionId: null,
    toolCode: "render_html_to_pdf",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: {
      htmlContent: "<html><body><h1>Test Document</h1></body></html>",
      outputFileName: "document.pdf"
    }
  });

  // 1. weasyprint must have been called exactly once with correct args.
  assert.equal(capturedRunInPodCalls.length, 1, "runInPod must be called exactly once");
  const call = capturedRunInPodCalls[0]!;
  assert.equal(call.command, "weasyprint", "must invoke weasyprint command");
  assert.ok(
    call.args[0]?.endsWith(".render-input.html"),
    `first arg must be the render-input HTML path, got: ${String(call.args[0])}`
  );
  assert.ok(
    call.args[1]?.endsWith("document.pdf"),
    `second arg must be the output PDF path, got: ${String(call.args[1])}`
  );

  // 2. The transient .render-input.html must not appear as a produced file in the workspace.
  const workspaceRoot = access.resolveWorkspaceRoot("workspace-render-1");
  const filesAfter = await listWorkspaceRelativeFiles(workspaceRoot);
  const htmlInputPresent = filesAfter.some((relativePath) =>
    relativePath.includes(".render-input.html")
  );
  assert.equal(
    htmlInputPresent,
    false,
    "transient .render-input.html must be removed after render"
  );
});

// ADR-123 Slice 6 — execute_document_code: runs the model-authored program,
// mounts source files + OCR sidecars into /workspace/sources, removes the
// transient program and sources after the run, and persists the produced file.
test("SandboxService: execute_document_code mounts sources, runs python3, and cleans up transients", async () => {
  const capturedRunInPodCalls: Array<{ command: string; args: string[] }> = [];
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const sourcesAtRunTime: {
    sourcePdf: string | null;
    ocrSidecar: string | null;
    program: string | null;
  } = { sourcePdf: null, ocrSidecar: null, program: null };

  const sourcePdfBytes = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "utf8"),
    Buffer.alloc(400, "S"),
    Buffer.from("\n%%EOF", "utf8")
  ]);
  const fakeXlsxBytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(1024, 9)
  ]);

  const assistantHandle = "assistant-code";
  const assistantId = "assistant-code-1";
  const runtimeSessionId = "session-code";
  const sessionRoot = buildAssistantSessionRoot(assistantId, runtimeSessionId);
  const workspaceId = "workspace-code-1";
  const sourceStoragePath = `${sessionRoot}/source.pdf`;
  const workspaceObjectKey = `assistant-media/workspaces/${workspaceId}/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}/source.pdf`;
  const storedObjects = new Map<string, Buffer>([[workspaceObjectKey, sourcePdfBytes]]);

  const service = new SandboxService(
    {
      sandboxJob: {
        async update(input: { where: { id: string }; data: Record<string, unknown> }) {
          capturedJobUpdates.push(input.data);
          return { id: input.where.id, ...input.data };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          capturedJobUpdates.push(input.data);
          return { count: 1 };
        },
        async findUnique() {
          return null;
        }
      },
      assistantWorkspaceLease: {
        async create(input: { data: Record<string, unknown> }) {
          return {
            id: "lease-code-1",
            assistantId: String(input.data.assistantId),
            workspaceId: String(input.data.workspaceId),
            sandboxJobId: null,
            leaseToken: String(input.data.leaseToken),
            holderId: String(input.data.holderId),
            expiresAt: input.data.expiresAt as Date
          };
        },
        async updateMany() {
          return { count: 1 };
        }
      }
    } as never,
    {
      buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
        return `sandbox/${input.assistantId}/${input.jobId}/${input.relativePath}`;
      },
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `assistant-media/workspaces/${input.workspaceId}/workspace/${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer }) {
        storedObjects.set(input.objectKey, Buffer.from(input.buffer));
        return input.buffer.length;
      },
      async downloadObject(objectKey: string) {
        const stored = storedObjects.get(objectKey);
        if (stored === undefined) {
          throw new Error(`Missing stored object "${objectKey}"`);
        }
        return Buffer.from(stored);
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {
      async runInPod(input: {
        command: string;
        args: string[];
        workspaceRoot: string;
        absoluteCwd: string;
        stagingFiles?: Array<{ absolutePath: string; contents: Buffer }>;
      }) {
        capturedRunInPodCalls.push({ command: input.command, args: input.args });
        for (const file of input.stagingFiles ?? []) {
          if (file.absolutePath.endsWith("sources/source.pdf")) {
            sourcesAtRunTime.sourcePdf = file.contents.toString("utf8");
          }
          if (file.absolutePath.endsWith("sources/source.pdf.ocr.txt")) {
            sourcesAtRunTime.ocrSidecar = file.contents.toString("utf8");
          }
          if (file.absolutePath.endsWith(".document-code.py")) {
            sourcesAtRunTime.program = file.contents.toString("utf8");
          }
        }
        await fs.writeFile(join(input.absoluteCwd, "report.xlsx"), fakeXlsxBytes);
        return { exitCode: 0, stdout: null, stderr: null, durationMs: 50, execPodName: null };
      },
      async execShellInSessionPod() {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, execPodName: "ses-code" };
      },
      async retireModelJobPod() {
        return { podName: "ses-code", retired: true };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("code-job-1", {
    assistantId,
    workspaceId,
    runtimeRequestId: "request-code-1",
    runtimeSessionId,
    toolCode: "execute_document_code",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: {
      programSource: `import openpyxl\nopenpyxl.Workbook().save('${sessionRoot}/report.xlsx')\n`,
      outputFileName: "report.xlsx",
      sourceMounts: [{ storagePath: sourceStoragePath, mountPath: "sources/source.pdf" }],
      textSidecars: [{ mountPath: "sources/source.pdf.ocr.txt", text: "OCR TEXT" }]
    },
    assistantHandle
  });

  assert.equal(capturedRunInPodCalls.length, 1, "runInPod must be called exactly once");
  assert.equal(capturedRunInPodCalls[0]!.command, "python3");
  assert.equal(sourcesAtRunTime.sourcePdf?.startsWith("%PDF-1.4"), true);
  assert.equal(sourcesAtRunTime.ocrSidecar, "OCR TEXT");
  assert.equal(sourcesAtRunTime.program?.includes(`${sessionRoot}/report.xlsx`), true);

  const workspaceRoot = access.resolveWorkspaceRoot(workspaceId);
  const filesAfter = await listWorkspaceRelativeFiles(workspaceRoot);
  assert.equal(
    filesAfter.some((path) => path.includes(".document-code.py")),
    false
  );
  assert.equal(
    filesAfter.some((path) => path.startsWith("sources/")),
    false
  );

  const completed = capturedJobUpdates.find((update) => update.status === "completed");
  const payload = completed?.resultPayload as {
    producedFiles?: Array<{ relativePath: string; storagePath: string }>;
  };
  const produced = payload?.producedFiles?.find((file) => file.relativePath === "report.xlsx");
  assert.ok(produced, "report.xlsx must be staged in job producedFiles");
  assert.ok(produced!.storagePath.length > 0);
});

// ADR-123 Slice 7 — grep / glob workspace tools via pod exec.

function buildGrepGlobService(
  capturedJobUpdates: Array<Record<string, unknown>>,
  capturedShellCalls: Array<{ shellCommand: string }>,
  shellResult: {
    exitCode: number;
    stdout: string;
    stderr: string;
  }
): SandboxService {
  const service = new SandboxService(
    {
      sandboxJob: {
        async update(input: { where: { id: string }; data: Record<string, unknown> }) {
          capturedJobUpdates.push(input.data);
          return { id: input.where.id, ...input.data };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          capturedJobUpdates.push(input.data);
          return { count: 1 };
        },
        async findUnique() {
          return null;
        }
      },
      assistantWorkspaceLease: {
        async create(input: { data: Record<string, unknown> }) {
          return {
            id: "lease-search-1",
            assistantId: String(input.data.assistantId),
            workspaceId: String(input.data.workspaceId),
            sandboxJobId: null,
            leaseToken: String(input.data.leaseToken),
            holderId: String(input.data.holderId),
            expiresAt: input.data.expiresAt as Date
          };
        },
        async updateMany() {
          return { count: 1 };
        }
      }
    } as never,
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      },
      async downloadObject() {
        throw new Error("missing");
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {
      async runInPod() {
        throw new Error("grep/glob must NOT route through runInPod");
      },
      async execShellInSessionPod(input: { shellCommand: string }) {
        capturedShellCalls.push({ shellCommand: input.shellCommand });
        return {
          exitCode: shellResult.exitCode,
          stdout: shellResult.stdout,
          stderr: shellResult.stderr,
          durationMs: 1,
          execPodName: "ses-grep-test"
        };
      },
      async retireModelJobPod() {
        return { podName: "ses-grep-test", retired: false };
      }
    } as never,
    {} as never
  );
  return service;
}

// ADR-137 S4 — model grep/glob no longer dispatch sandbox jobs.

test("SandboxService: grep toolCode is rejected after storage-plane cutover", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const service = buildGrepGlobService(capturedJobUpdates, [], {
    exitCode: 0,
    stdout: "",
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("grep-job-rejected", {
    assistantId: "assistant-grep-1",
    workspaceId: "workspace-grep-1",
    runtimeRequestId: "request-grep-1",
    runtimeSessionId: "session-grep-1",
    toolCode: "grep",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "token" }
  });

  const rejected = capturedJobUpdates.find(
    (update) => update.violationCode === "tool_not_supported"
  );
  assert.ok(
    rejected,
    "grep sandbox job must reject tool_not_supported after storage-plane cutover"
  );
});

test("SandboxService: glob toolCode is rejected after storage-plane cutover", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const service = buildGrepGlobService(capturedJobUpdates, [], {
    exitCode: 0,
    stdout: "",
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("glob-job-rejected", {
    assistantId: "assistant-glob-1",
    workspaceId: "workspace-glob-1",
    runtimeRequestId: "request-glob-1",
    runtimeSessionId: "session-glob-1",
    toolCode: "glob",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "*.ts" }
  });

  const rejected = capturedJobUpdates.find(
    (update) => update.violationCode === "tool_not_supported"
  );
  assert.ok(
    rejected,
    "glob sandbox job must reject tool_not_supported after storage-plane cutover"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-126 Slice 1 — shell tool uses /bin/bash, warm-pool fire-and-forget.
// ─────────────────────────────────────────────────────────────────────────────

test("SandboxService: shell tool invokes /bin/bash -lc (not /bin/sh)", async () => {
  const capturedRunInPodCalls: Array<{ command: string; args: string[] }> = [];

  const service = new SandboxService(
    createLeasePrismaStub(),
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      },
      async downloadObject() {
        throw new Error("missing");
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async runInPod(input: { command: string; args: string[] }) {
        capturedRunInPodCalls.push({ command: input.command, args: [...input.args] });
        return { exitCode: 0, stdout: "hi", stderr: "", durationMs: 10, execPodName: "ses-test" };
      },
      async warmSessionPod() {
        return { podName: "ses-test", alreadyRunning: false };
      },
      async retireModelJobPod() {
        return { podName: "exec-shell", retired: true };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("shell-bash-job-1", {
    assistantId: "assistant-shell-1",
    workspaceId: "workspace-shell-1",
    runtimeRequestId: "request-shell-1",
    runtimeSessionId: null,
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo {a,b,c}" }
  });

  assert.equal(capturedRunInPodCalls.length, 1, "runInPod must be called exactly once for shell");
  const call = capturedRunInPodCalls[0]!;
  assert.equal(call.command, "/bin/bash", "shell tool must invoke /bin/bash (not /bin/sh)");
  assert.deepEqual(call.args, ["-lc", "echo {a,b,c}"], "shell args must be [-lc, <command>]");
});

test("SandboxService: warm-pool fires-and-forgets when runtimeSessionId is set and warm pool is enabled", async () => {
  const warmSessionPodCalls: Array<{ assistantId: string; workspaceId: string }> = [];
  let warmSessionPodResolveFn: (() => void) | null = null;

  const warmSessionPodPromise = new Promise<void>((resolve) => {
    warmSessionPodResolveFn = resolve;
  });

  const service = new SandboxService(
    createLeasePrismaStub(),
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      },
      async downloadObject() {
        throw new Error("missing");
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 1 }),
    {
      async runInPod() {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 5, execPodName: "ses-warm-test" };
      },
      async warmSessionPod(input: { assistantId: string; workspaceId: string }) {
        warmSessionPodCalls.push({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        });
        warmSessionPodResolveFn?.();
        return { podName: "ses-warm-test", alreadyRunning: false };
      },
      async retireModelJobPod() {
        return { podName: "ses-warm-test", retired: true };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;

  // With runtimeSessionId set and warm pool enabled (size=1), warmSessionPod must be called.
  await access.executeQueuedJob("warm-job-1", {
    assistantId: "assistant-warm-svc",
    workspaceId: "workspace-warm-svc",
    runtimeRequestId: "request-warm-1",
    runtimeSessionId: "session-warm-1",
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo warm" }
  });

  // Allow the fire-and-forget to settle.
  await warmSessionPodPromise;

  assert.equal(
    warmSessionPodCalls.length,
    1,
    "warmSessionPod must be called once when runtimeSessionId is set and pool size >= 1"
  );
  assert.equal(warmSessionPodCalls[0]?.assistantId, "assistant-warm-svc");
  assert.equal(warmSessionPodCalls[0]?.workspaceId, "workspace-warm-svc");

  // Now verify: with runtimeSessionId=null, warmSessionPod must NOT be called.
  const warmCallsBeforeNull = warmSessionPodCalls.length;
  await access.executeQueuedJob("warm-job-null", {
    assistantId: "assistant-warm-svc",
    workspaceId: "workspace-warm-svc",
    runtimeRequestId: "request-warm-null",
    runtimeSessionId: null,
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo warm-null" }
  });
  // Brief settle
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    warmSessionPodCalls.length,
    warmCallsBeforeNull,
    "warmSessionPod must NOT be called when runtimeSessionId is null"
  );
});

test("SandboxService: shell cwd accepts full /workspace/... path without doubling session root", async () => {
  const assistantId = "2f8cf38e-a6d9-4609-b83a-2b748246fcec";
  const runtimeSessionId = "6ea77d49-b361-4d9f-9733-a8e8f81748ed";
  const sessionVisibleRoot = buildAssistantSessionRoot(assistantId, runtimeSessionId);
  const capturedRunInPodCalls: Array<{ absoluteCwd: string }> = [];

  const service = new SandboxService(
    createLeasePrismaStub(),
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      },
      async downloadObject() {
        throw new Error("missing");
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async runInPod(input: { absoluteCwd: string }) {
        capturedRunInPodCalls.push({ absoluteCwd: input.absoluteCwd });
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 10,
          execPodName: "ses-cwd-test"
        };
      },
      async warmSessionPod() {
        return { podName: "ses-cwd-test", alreadyRunning: false };
      },
      async retireModelJobPod() {
        return { podName: "ses-cwd-test", retired: true };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;
  const workspaceRoot = access.resolveWorkspaceRoot("workspace-cwd-1");
  await fs.mkdir(join(workspaceRoot, "assistants", assistantId, "sessions", runtimeSessionId), {
    recursive: true
  });

  await access.executeQueuedJob("shell-cwd-job-1", {
    assistantId,
    workspaceId: "workspace-cwd-1",
    runtimeRequestId: "request-cwd-1",
    runtimeSessionId,
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "pwd", cwd: sessionVisibleRoot }
  });

  assert.equal(capturedRunInPodCalls.length, 1);
  const expectedHostCwd = join(
    workspaceRoot,
    "assistants",
    assistantId,
    "sessions",
    runtimeSessionId
  );
  assert.equal(capturedRunInPodCalls[0]!.absoluteCwd, expectedHostCwd);
});

test("SandboxService: pod retirement follows terminal persistence and precedes lease release", async () => {
  for (const outcome of ["success", "error", "timeout", "blocked", "terminal-rejected"] as const) {
    const events: string[] = [];
    const observability = new SandboxObservabilityService();
    const service = new SandboxService(
      {
        sandboxJob: {
          async update(input: { data: Record<string, unknown> }) {
            if (typeof input.data.status === "string") {
              events.push(`job:${input.data.status}`);
            }
            return input.data;
          },
          async updateMany(input: { data: Record<string, unknown> }) {
            if (
              outcome === "terminal-rejected" &&
              ["completed", "failed", "blocked"].includes(String(input.data.status))
            ) {
              return { count: 0 };
            }
            if (typeof input.data.status === "string") {
              events.push(`job:${input.data.status}`);
            }
            return { count: 1 };
          },
          async findUnique() {
            return null;
          }
        },
        assistantWorkspaceLease: {
          async create(input: { data: Record<string, unknown> }) {
            return {
              id: `lease-${outcome}`,
              assistantId: String(input.data.assistantId),
              workspaceId: String(input.data.workspaceId),
              sandboxJobId: null,
              leaseToken: String(input.data.leaseToken),
              holderId: String(input.data.holderId),
              expiresAt: input.data.expiresAt as Date
            };
          },
          async updateMany(input: { data: Record<string, unknown> }) {
            if (String(input.data.leaseToken ?? "").startsWith("released:")) {
              events.push("lease:released");
            }
            return { count: 1 };
          }
        }
      } as never,
      {
        buildSandboxObjectKey() {
          return "obj/key";
        },
        buildSessionSnapshotKey() {
          return "snap/key";
        },
        async saveObject(input: { buffer: Buffer }) {
          return input.buffer.length;
        }
      } as never,
      observability,
      createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
      {
        async runInPod() {
          const execPodBinding = {
            namespace: "persai-dev",
            podName: `exec-${outcome}`,
            podUid: `uid-${outcome}`,
            podResourceVersion: "1",
            leaseToken: `lease-token-${outcome}`,
            leaseHolderId: "holder-test",
            jobId: `job-${outcome}`,
            assistantId: `assistant-${outcome}`,
            workspaceId: `workspace-${outcome}`,
            assistantHandle: `assistant-${outcome}`,
            mode: outcome === "success" ? ("full_public" as const) : ("restricted" as const)
          };
          if (outcome === "error") {
            throw Object.assign(new Error("command failed"), { execPodBinding });
          }
          if (outcome === "timeout") {
            throw Object.assign(new Error("command timed out"), {
              code: "process_timeout",
              execPodBinding
            });
          }
          if (outcome === "blocked") {
            throw Object.assign(new Error("policy blocked"), {
              code: "sandbox_policy_blocked",
              blocked: true,
              execPodBinding
            });
          }
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 1,
            execPodName: `exec-${outcome}`,
            execPodBinding
          };
        },
        async retireModelJobPod() {
          events.push("pod:retired");
          return { podName: `exec-${outcome}`, podUid: `uid-${outcome}`, retired: true };
        }
      } as never,
      {} as never
    );

    await (service as unknown as SandboxServiceTestAccess).executeQueuedJob(`job-${outcome}`, {
      assistantId: `assistant-${outcome}`,
      workspaceId: `workspace-${outcome}`,
      runtimeRequestId: `request-${outcome}`,
      runtimeSessionId: null,
      toolCode: "shell",
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
      args: { command: "echo lifecycle" }
    });

    const expectedStatus =
      outcome === "success" ? "completed" : outcome === "blocked" ? "blocked" : "failed";
    const terminalIndex = events.findIndex((event) => event === `job:${expectedStatus}`);
    const retirementIndex = events.indexOf("pod:retired");
    const releaseIndex = events.indexOf("lease:released");
    const durations = observability.getEgressJobDuration();
    const duration = outcome === "success" ? durations.full_public : durations.restricted;
    if (outcome === "terminal-rejected") {
      assert.equal(terminalIndex, -1, "rejected terminal write must not claim persistence");
      assert.equal(duration.count, 0, "rejected terminal write must not emit duration");
      assert.equal(releaseIndex, -1, "rejected terminal write must withhold lease release");
    } else {
      assert.ok(terminalIndex >= 0, `${outcome}: terminal job state must persist`);
      assert.ok(retirementIndex > terminalIndex, `${outcome}: retirement must follow persistence`);
      assert.ok(releaseIndex > retirementIndex, `${outcome}: lease release must follow retirement`);
      assert.equal(duration.count, 1, `${outcome}: duration must record exactly once`);
      assert.equal(
        outcome === "success" ? durations.restricted.count : durations.full_public.count,
        0,
        `${outcome}: duration must use canonical bound mode only`
      );
    }
  }
});

test("SandboxService: session pod cleanup follows terminal persistence and precedes lease release", async () => {
  const events: string[] = [];
  const service = new SandboxService(
    {
      sandboxJob: {
        async updateMany(input: { data: Record<string, unknown> }) {
          if (typeof input.data.status === "string") {
            events.push(`job:${input.data.status}`);
          }
          return { count: 1 };
        }
      },
      assistantWorkspaceLease: {
        async create(input: { data: Record<string, unknown> }) {
          return {
            id: "lease-clean-session",
            assistantId: String(input.data.assistantId),
            workspaceId: String(input.data.workspaceId),
            sandboxJobId: null,
            leaseToken: String(input.data.leaseToken),
            holderId: String(input.data.holderId),
            expiresAt: input.data.expiresAt as Date
          };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          if (String(input.data.leaseToken ?? "").startsWith("released:")) {
            events.push("lease:released");
          }
          return { count: 1 };
        }
      }
    } as never,
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async runInPod() {
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 1,
          execPodName: "ses-clean-session",
          execPodBinding: {
            namespace: "persai-dev",
            podName: "ses-clean-session",
            podUid: "uid-clean-session",
            podResourceVersion: "1",
            leaseToken: "lease-token-clean-session",
            leaseHolderId: "holder-test",
            jobId: "job-clean-session",
            assistantId: "assistant-clean-session",
            workspaceId: "workspace-clean-session",
            assistantHandle: "assistant-clean-session",
            mode: "restricted"
          }
        };
      },
      async cleanupBoundSessionPod() {
        events.push("pod:clean");
        return { podName: "ses-clean-session", podUid: "uid-clean-session" };
      },
      async retireModelJobPod() {
        events.push("pod:retired");
        return { podName: "ses-clean-session", podUid: "uid-clean-session", retired: true };
      }
    } as never,
    {} as never
  );

  await (service as unknown as SandboxServiceTestAccess).executeQueuedJob("job-clean-session", {
    assistantId: "assistant-clean-session",
    workspaceId: "workspace-clean-session",
    runtimeRequestId: "request-clean-session",
    runtimeSessionId: "runtime-session-clean",
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo lifecycle" }
  });

  const terminalIndex = events.indexOf("job:completed");
  const cleanupIndex = events.indexOf("pod:clean");
  const retirementIndex = events.indexOf("pod:retired");
  const releaseIndex = events.indexOf("lease:released");
  assert.ok(terminalIndex >= 0, "terminal job state must persist");
  assert.ok(cleanupIndex > terminalIndex, "cleanup must follow persistence");
  assert.equal(retirementIndex, -1, "clean session pod must not retire");
  assert.ok(releaseIndex > cleanupIndex, "lease release must follow cleanup");
});

test("SandboxService: failed session pod cleanup falls back to retirement before lease release", async () => {
  const events: string[] = [];
  const service = new SandboxService(
    {
      sandboxJob: {
        async updateMany(input: { data: Record<string, unknown> }) {
          if (typeof input.data.status === "string") {
            events.push(`job:${input.data.status}`);
          }
          return { count: 1 };
        }
      },
      assistantWorkspaceLease: {
        async create(input: { data: Record<string, unknown> }) {
          return {
            id: "lease-cleanup-fallback",
            assistantId: String(input.data.assistantId),
            workspaceId: String(input.data.workspaceId),
            sandboxJobId: null,
            leaseToken: String(input.data.leaseToken),
            holderId: String(input.data.holderId),
            expiresAt: input.data.expiresAt as Date
          };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          if (String(input.data.leaseToken ?? "").startsWith("released:")) {
            events.push("lease:released");
          }
          return { count: 1 };
        }
      }
    } as never,
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async runInPod() {
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 1,
          execPodName: "ses-cleanup-fallback",
          execPodBinding: {
            namespace: "persai-dev",
            podName: "ses-cleanup-fallback",
            podUid: "uid-cleanup-fallback",
            podResourceVersion: "1",
            leaseToken: "lease-token-cleanup-fallback",
            leaseHolderId: "holder-test",
            jobId: "job-cleanup-fallback",
            assistantId: "assistant-cleanup-fallback",
            workspaceId: "workspace-cleanup-fallback",
            assistantHandle: "assistant-cleanup-fallback",
            mode: "restricted"
          }
        };
      },
      async cleanupBoundSessionPod() {
        events.push("pod:cleanup-failed");
        throw new Error("cleanup could not prove baseline");
      },
      async retireModelJobPod() {
        events.push("pod:retired");
        return { podName: "ses-cleanup-fallback", podUid: "uid-cleanup-fallback", retired: true };
      }
    } as never,
    {} as never
  );

  await (service as unknown as SandboxServiceTestAccess).executeQueuedJob("job-cleanup-fallback", {
    assistantId: "assistant-cleanup-fallback",
    workspaceId: "workspace-cleanup-fallback",
    runtimeRequestId: "request-cleanup-fallback",
    runtimeSessionId: "runtime-session-fallback",
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo lifecycle" }
  });

  const terminalIndex = events.indexOf("job:completed");
  const cleanupFailedIndex = events.indexOf("pod:cleanup-failed");
  const retirementIndex = events.indexOf("pod:retired");
  const releaseIndex = events.indexOf("lease:released");
  assert.ok(terminalIndex >= 0, "terminal job state must persist");
  assert.ok(cleanupFailedIndex > terminalIndex, "cleanup failure must follow persistence");
  assert.ok(retirementIndex > cleanupFailedIndex, "retirement must follow cleanup failure");
  assert.ok(releaseIndex > retirementIndex, "lease release must follow fail-closed retirement");
});

test("SandboxService: dependency contour permits large session package trees without poisoning ordinary file quota", () => {
  const service = new SandboxService(
    createLeasePrismaStub(),
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const access = service as unknown as {
    assertWorkspacePolicySnapshot(
      snapshot: ReadonlyMap<string, { kind: "file" | "directory"; sizeBytes: number }>,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      baselineSnapshot: ReadonlyMap<string, { kind: "file" | "directory"; sizeBytes: number }>,
      assistantId: string,
      runtimeSessionId: string | null
    ): void;
  };
  const assistantId = "assistant-deps";
  const runtimeSessionId = "session-deps";
  const snapshot = new Map<string, { kind: "file" | "directory"; sizeBytes: number }>();
  snapshot.set(buildAssistantSessionRoot(assistantId, runtimeSessionId), {
    kind: "directory",
    sizeBytes: 0
  });
  snapshot.set(`${buildAssistantSessionRoot(assistantId, runtimeSessionId)}/node_modules`, {
    kind: "directory",
    sizeBytes: 0
  });
  for (let index = 0; index < 1_600; index += 1) {
    snapshot.set(
      `${buildAssistantSessionRoot(assistantId, runtimeSessionId)}/node_modules/pkg-${String(index)}.js`,
      { kind: "file", sizeBytes: 128 }
    );
  }

  access.assertWorkspacePolicySnapshot(
    snapshot,
    {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      maxFileCountPerJob: 16,
      maxDirectoryCountPerJob: 16,
      maxWorkspaceBytesPerJob: 32 * 1024
    },
    new Map(),
    assistantId,
    runtimeSessionId
  );
});

test("SandboxService: dependency contour still rejects abusive dependency tree growth", () => {
  const service = new SandboxService(
    createLeasePrismaStub(),
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const access = service as unknown as {
    assertWorkspacePolicySnapshot(
      snapshot: ReadonlyMap<string, { kind: "file" | "directory"; sizeBytes: number }>,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      baselineSnapshot: ReadonlyMap<string, { kind: "file" | "directory"; sizeBytes: number }>,
      assistantId: string,
      runtimeSessionId: string | null
    ): void;
  };
  const assistantId = "assistant-deps-abuse";
  const runtimeSessionId = "session-deps-abuse";
  const snapshot = new Map<string, { kind: "file" | "directory"; sizeBytes: number }>();
  for (let index = 0; index <= 20_000; index += 1) {
    snapshot.set(
      `${buildAssistantSessionRoot(assistantId, runtimeSessionId)}/node_modules/pkg-${String(index)}.js`,
      { kind: "file", sizeBytes: 1 }
    );
  }

  assert.throws(
    () =>
      access.assertWorkspacePolicySnapshot(
        snapshot,
        DEFAULT_RUNTIME_SANDBOX_POLICY,
        new Map(),
        assistantId,
        runtimeSessionId
      ),
    /dependency files/i
  );
});

test("SandboxService: final retirement RV conflict withholds lease release", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let leaseReleased = false;
  const service = new SandboxService(
    {
      sandboxJob: {
        async update(input: { data: Record<string, unknown> }) {
          updates.push(input.data);
          return input.data;
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          updates.push(input.data);
          return { count: 1 };
        },
        async findUnique() {
          return null;
        }
      },
      assistantWorkspaceLease: {
        async create(input: { data: Record<string, unknown> }) {
          return {
            id: "lease-retire-fail",
            assistantId: String(input.data.assistantId),
            workspaceId: String(input.data.workspaceId),
            sandboxJobId: null,
            leaseToken: String(input.data.leaseToken),
            holderId: String(input.data.holderId),
            expiresAt: input.data.expiresAt as Date
          };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          if (String(input.data.leaseToken ?? "").startsWith("released:")) {
            leaseReleased = true;
          }
          return { count: 1 };
        }
      }
    } as never,
    {
      buildSandboxObjectKey() {
        return "obj/key";
      },
      buildSessionSnapshotKey() {
        return "snap/key";
      },
      async saveObject(input: { buffer: Buffer }) {
        return input.buffer.length;
      }
    } as never,
    new SandboxObservabilityService(),
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async runInPod() {
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 1,
          execPodName: "exec-retire-fail",
          execPodBinding: {
            namespace: "persai-dev",
            podName: "exec-retire-fail",
            podUid: "uid-retire-fail",
            podResourceVersion: "1",
            leaseToken: "lease-token-retire-fail",
            leaseHolderId: "holder-test",
            jobId: "job-retire-fail",
            assistantId: "assistant-retire-fail",
            workspaceId: "workspace-retire-fail",
            assistantHandle: "assistant-retire-fail",
            mode: "restricted"
          }
        };
      },
      async retireModelJobPod() {
        throw Object.assign(new Error("resourceVersion precondition conflict"), { code: 409 });
      }
    } as never,
    {} as never
  );

  await (service as unknown as SandboxServiceTestAccess).executeQueuedJob("job-retire-fail", {
    assistantId: "assistant-retire-fail",
    workspaceId: "workspace-retire-fail",
    runtimeRequestId: "request-retire-fail",
    runtimeSessionId: null,
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo lifecycle" }
  });

  assert.equal(leaseReleased, false);
  assert.equal(
    updates.some((update) => update.violationCode === "sandbox_job_pod_retirement_failed"),
    false
  );
  assert.ok(updates.some((update) => update.status === "completed"));
});

test("SandboxService: lease acquisition failure never retires a pod", async () => {
  let retirementCalls = 0;
  const observability = new SandboxObservabilityService();
  const service = new SandboxService(
    {
      sandboxJob: {
        async update(input: { data: Record<string, unknown> }) {
          return input.data;
        },
        async updateMany() {
          return { count: 1 };
        }
      }
    } as never,
    {} as never,
    observability,
    createSandboxConfig({ SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 0 }),
    {
      async retireModelJobPod() {
        retirementCalls += 1;
        throw new Error("must not be called");
      }
    } as never,
    {} as never
  );
  (
    service as unknown as {
      waitForWorkspaceLease(): Promise<never>;
    }
  ).waitForWorkspaceLease = async () => {
    throw Object.assign(new Error("lease unavailable"), {
      code: "workspace_lease_timeout",
      blocked: true
    });
  };

  await (service as unknown as SandboxServiceTestAccess).executeQueuedJob("job-no-lease", {
    assistantId: "assistant-no-lease",
    workspaceId: "workspace-no-lease",
    runtimeRequestId: "request-no-lease",
    runtimeSessionId: null,
    toolCode: "shell",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { command: "echo never" }
  });

  assert.equal(retirementCalls, 0);
  assert.equal(observability.getEgressJobDuration().restricted.count, 0);
  assert.equal(observability.getEgressJobDuration().full_public.count, 0);
});

test("SandboxService: stale recovery terminal truth cannot be overwritten by old worker", async () => {
  const stored = {
    status: "failed",
    resultPayload: { recovery: true },
    violationCode: "sandbox_stale_pod_generation_recovered"
  };
  const prisma = {
    sandboxJob: {
      async updateMany(input: { where: { status: string }; data: Record<string, unknown> }) {
        if (stored.status !== input.where.status) {
          return { count: 0 };
        }
        Object.assign(stored, input.data);
        return { count: 1 };
      }
    }
  };
  const service = new SandboxService(
    prisma as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const guard = {
    handle: {
      id: "lease-conditional",
      assistantId: "assistant-conditional",
      workspaceId: "workspace-conditional",
      sandboxJobId: "job-conditional",
      leaseToken: "token-conditional",
      holderId: "holder-conditional",
      expiresAt: new Date(Date.now() + 60_000)
    },
    active: true,
    renewalError: null,
    heartbeat: null,
    podBinding: null
  };
  const updated = await (
    service as unknown as {
      updateSandboxJobUnderActiveLease(input: Record<string, unknown>): Promise<boolean>;
    }
  ).updateSandboxJobUnderActiveLease({
    guard,
    jobId: "job-conditional",
    expectedStatus: "running",
    data: { status: "completed", resultPayload: { oldWorker: true } }
  });
  assert.equal(updated, false);
  assert.deepEqual(stored, {
    status: "failed",
    resultPayload: { recovery: true },
    violationCode: "sandbox_stale_pod_generation_recovered"
  });
});

test("SandboxService: exact active lease can terminalize running job", async () => {
  let capturedWhere: Record<string, unknown> = {};
  const service = new SandboxService(
    {
      sandboxJob: {
        async updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          capturedWhere = input.where;
          return { count: 1 };
        }
      }
    } as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {} as never
  );
  const guard = {
    handle: {
      id: "lease-active",
      assistantId: "assistant-active",
      workspaceId: "workspace-active",
      sandboxJobId: "job-active",
      leaseToken: "token-active",
      holderId: "holder-active",
      expiresAt: new Date(Date.now() + 60_000)
    },
    active: true,
    renewalError: null,
    heartbeat: null,
    podBinding: null
  };
  assert.equal(
    await (
      service as unknown as {
        updateSandboxJobUnderActiveLease(input: Record<string, unknown>): Promise<boolean>;
      }
    ).updateSandboxJobUnderActiveLease({
      guard,
      jobId: "job-active",
      expectedStatus: "running",
      data: { status: "completed", resultPayload: { ok: true } }
    }),
    true
  );
  const leaseWhere = (
    capturedWhere.workspaceLeases as {
      some: Record<string, unknown>;
    }
  ).some;
  assert.equal(leaseWhere.assistantId, "assistant-active");
  assert.equal(leaseWhere.workspaceId, "workspace-active");
  assert.equal(leaseWhere.sandboxJobId, "job-active");
  assert.equal(leaseWhere.leaseToken, "token-active");
  assert.equal(leaseWhere.holderId, "holder-active");
  assert.ok((leaseWhere.expiresAt as { gt: unknown }).gt instanceof Date);
});
