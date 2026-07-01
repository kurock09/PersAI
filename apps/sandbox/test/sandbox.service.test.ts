import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
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
  resolveWorkspaceSessionRoot(assistantId: string, workspaceId: string): string;
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
    }
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
    }
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

test("SandboxService: files.read forwards model-requested maxBytes to workspace bridge", async () => {
  let capturedRead: {
    path: string;
    maxBytes?: number;
  } | null = null;
  const service = new SandboxService(
    {} as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {
      async workspaceFileRead(
        _ctx: unknown,
        input: {
          path: string;
          maxBytes?: number;
        }
      ) {
        capturedRead = input;
        return {
          success: true,
          reason: null,
          latencyMs: 1,
          data: {
            path: input.path,
            bytes: Buffer.from("partial blackbox text", "utf8"),
            truncated: true
          }
        };
      }
    } as never
  );

  const result = await (
    service as unknown as {
      executeFilesBridgeAction(
        bridgeCtx: unknown,
        args: Record<string, unknown>
      ): Promise<{ reason: string | null; content: string | null }>;
    }
  ).executeFilesBridgeAction(
    {
      assistantId: "assistant-read-1",
      assistantHandle: "reader",
      siblingHandles: [],
      workspaceId: "workspace-read-1",
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
      workspaceQuotaBytes: null,
      sharedQuotaBytes: null
    },
    {
      action: "read",
      path: "/workspace/LOG011 (3).TXT",
      maxBytes: 10_000
    }
  );

  assert.equal(result.reason, null);
  assert.deepEqual(capturedRead, {
    path: "/workspace/LOG011 (3).TXT",
    maxBytes: 10_000
  });
  const payload = JSON.parse(result.content!) as { content: string; truncated: boolean };
  assert.equal(payload.content, "partial blackbox text");
  assert.equal(payload.truncated, true);
});

test("SandboxService: files.write forwards replace and returns resolvedPath", async () => {
  let capturedWrite: {
    path: string;
    contents: Buffer;
    mode?: "overwrite" | "create_only";
    replace?: boolean;
  } | null = null;
  const service = new SandboxService(
    {} as never,
    {} as never,
    new SandboxObservabilityService(),
    createSandboxConfig(),
    {} as never,
    {
      async workspaceFileWrite(
        _ctx: unknown,
        input: {
          path: string;
          contents: Buffer;
          mode?: "overwrite" | "create_only";
          replace?: boolean;
        }
      ) {
        capturedWrite = input;
        return {
          success: true,
          reason: null,
          latencyMs: 1,
          data: {
            resolvedPath: "/workspace/report (1).txt",
            bytes: input.contents.length
          }
        };
      }
    } as never
  );

  const result = await (
    service as unknown as {
      executeFilesBridgeAction(
        bridgeCtx: unknown,
        args: Record<string, unknown>
      ): Promise<{ reason: string | null; content: string | null }>;
    }
  ).executeFilesBridgeAction(
    {
      assistantId: "assistant-write-2",
      assistantHandle: "writer",
      siblingHandles: [],
      workspaceId: "workspace-write-2",
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
      workspaceQuotaBytes: null,
      sharedQuotaBytes: null
    },
    {
      action: "write",
      path: "/workspace/report.txt",
      content: "hello",
      replace: true
    }
  );

  assert.equal(result.reason, null);
  assert.deepEqual(capturedWrite, {
    path: "/workspace/report.txt",
    contents: Buffer.from("hello", "utf8"),
    replace: true
  });
  const payload = JSON.parse(result.content!) as { sizeBytes: number; resolvedPath: string };
  assert.equal(payload.sizeBytes, 5);
  assert.equal(payload.resolvedPath, "/workspace/report (1).txt");
});

test("SandboxService: control-plane workspace write can hydrate bytes from workspace storage", async () => {
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
            workspaceRelPath: `/workspace/${input.basename}`,
            absolutePath: `/workspace/${input.basename}`,
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
    storagePath: "/workspace/LOG006.01 (2).csv",
    mimeType: "text/csv"
  });

  assert.deepEqual(result, {
    ok: true,
    mode: "written",
    workspaceRelPath: "/workspace/LOG006.01 (2).csv",
    sizeBytes: 9
  });
  assert.equal(downloadedObjectKey, "fs/workspaces/workspace-write-1/workspace/LOG006.01 (2).csv");
  assert.notEqual(capturedWrite, null);
  const write = capturedWrite as unknown as { basename: string; contents: Buffer };
  assert.equal(write.basename, "LOG006.01 (2).csv");
  assert.equal(write.contents.toString("utf8"), "csv-bytes");
});

test("SandboxService: control-plane workspace write forwards replace for explicit paths", async () => {
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
          replace: input.replace
        };
        return {
          success: true,
          reason: null,
          latencyMs: 1,
          data: {
            workspaceRelPath: "/workspace/docs/report.pdf",
            absolutePath: "/workspace/docs/report.pdf",
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
    path: "/workspace/docs/report.pdf",
    contents: Buffer.from("pdf"),
    replace: true,
    mimeType: "application/pdf"
  });

  assert.deepEqual(result, {
    ok: true,
    mode: "written",
    workspaceRelPath: "/workspace/docs/report.pdf",
    sizeBytes: 3
  });
  assert.deepEqual(capturedWrite, {
    basename: "report.pdf",
    path: "/workspace/docs/report.pdf",
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
  const workspaceRoot = access.resolveWorkspaceSessionRoot(
    "assistant-render-1",
    "workspace-render-1"
  );
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

  const workspaceId = "workspace-code-1";
  const sourceStoragePath = "/workspace/source.pdf";
  const workspaceObjectKey = `assistant-media/workspaces/${workspaceId}/workspace/source.pdf`;
  const storedObjects = new Map<string, Buffer>([[workspaceObjectKey, sourcePdfBytes]]);

  const service = new SandboxService(
    {
      sandboxJob: {
        async update(input: { where: { id: string }; data: Record<string, unknown> }) {
          capturedJobUpdates.push(input.data);
          return { id: input.where.id, ...input.data };
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
      async runInPod(input: { command: string; args: string[]; workspaceRoot: string }) {
        capturedRunInPodCalls.push({ command: input.command, args: input.args });
        sourcesAtRunTime.sourcePdf = await fs
          .readFile(join(input.workspaceRoot, "sources", "source.pdf"))
          .then((b) => b.toString("utf8"))
          .catch(() => null);
        sourcesAtRunTime.ocrSidecar = await fs
          .readFile(join(input.workspaceRoot, "sources", "source.pdf.ocr.txt"), "utf8")
          .catch(() => null);
        sourcesAtRunTime.program = await fs
          .readFile(join(input.workspaceRoot, ".document-code.py"), "utf8")
          .catch(() => null);
        await fs.writeFile(join(input.workspaceRoot, "report.xlsx"), fakeXlsxBytes);
        return { exitCode: 0, stdout: null, stderr: null, durationMs: 50, execPodName: null };
      }
    } as never,
    {} as never
  );

  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("code-job-1", {
    assistantId: "assistant-code-1",
    workspaceId,
    runtimeRequestId: "request-code-1",
    runtimeSessionId: null,
    toolCode: "execute_document_code",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: {
      programSource: "import openpyxl\nopenpyxl.Workbook().save('/workspace/report.xlsx')\n",
      outputFileName: "report.xlsx",
      sourceMounts: [{ storagePath: sourceStoragePath, mountPath: "sources/source.pdf" }],
      textSidecars: [{ mountPath: "sources/source.pdf.ocr.txt", text: "OCR TEXT" }]
    }
  });

  assert.equal(capturedRunInPodCalls.length, 1, "runInPod must be called exactly once");
  assert.equal(capturedRunInPodCalls[0]!.command, "python3");
  assert.equal(sourcesAtRunTime.sourcePdf?.startsWith("%PDF-1.4"), true);
  assert.equal(sourcesAtRunTime.ocrSidecar, "OCR TEXT");

  const workspaceRoot = access.resolveWorkspaceSessionRoot("assistant-code-1", workspaceId);
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
      }
    } as never,
    {} as never
  );
  return service;
}

test("SandboxService: grep runs rg via pod exec and returns structured matches", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const capturedShellCalls: Array<{ shellCommand: string }> = [];
  const service = buildGrepGlobService(capturedJobUpdates, capturedShellCalls, {
    exitCode: 0,
    stdout: "src/app.ts:12:const token = 1;\nsrc/app.ts:40:const token2 = 2;\n",
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("grep-job-1", {
    assistantId: "assistant-grep-1",
    workspaceId: "workspace-grep-1",
    runtimeRequestId: "request-grep-1",
    runtimeSessionId: null,
    toolCode: "grep",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "token", glob: "**/*.ts", caseInsensitive: true }
  });

  assert.equal(capturedShellCalls.length, 1, "rg must be invoked exactly once via pod exec");
  const shellCommand = capturedShellCalls[0]!.shellCommand;
  assert.ok(shellCommand.startsWith("rg "), "pod shell must invoke rg");
  assert.ok(shellCommand.includes(" -- "), "rg command must include pattern terminator");
  assert.ok(shellCommand.includes("'token'"), "model pattern must be shell-quoted in rg command");
  assert.ok(shellCommand.includes("--glob"), "glob filter must be forwarded");

  const completed = capturedJobUpdates.find((d) => d.status === "completed");
  assert.ok(completed, "job must complete");
  const payload = completed!.resultPayload as { content: string | null };
  const parsed = JSON.parse(payload.content!) as {
    matches: Array<{ file: string; line: number; text: string }>;
    matchCount: number;
    truncated: boolean;
  };
  assert.equal(parsed.matchCount, 2);
  assert.deepEqual(parsed.matches[0], { file: "src/app.ts", line: 12, text: "const token = 1;" });
  assert.equal(parsed.truncated, false);
});

test("SandboxService: grep rejects a path outside allowed mounts", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const capturedShellCalls: Array<{ shellCommand: string }> = [];
  const service = buildGrepGlobService(capturedJobUpdates, capturedShellCalls, {
    exitCode: 0,
    stdout: "",
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("grep-job-escape", {
    assistantId: "assistant-grep-2",
    workspaceId: "workspace-grep-2",
    runtimeRequestId: "request-grep-2",
    runtimeSessionId: null,
    toolCode: "grep",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "secret", path: "/etc/passwd" }
  });

  assert.equal(capturedShellCalls.length, 0, "rg must NOT run for a disallowed path");
  const completed = capturedJobUpdates.find((d) => d.status === "completed");
  assert.ok(completed, "job completes with a path rejection payload");
  const payload = completed!.resultPayload as { reason: string | null; content: string | null };
  assert.equal(payload.reason, "outside_allowed_mount");
});

test("SandboxService: grep caps match count and flags truncation", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const capturedShellCalls: Array<{ shellCommand: string }> = [];
  const stdout = Array.from(
    { length: 250 },
    (_unused, index) => `src/file.ts:${String(index + 1)}:match ${String(index)}`
  ).join("\n");
  const service = buildGrepGlobService(capturedJobUpdates, capturedShellCalls, {
    exitCode: 0,
    stdout,
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("grep-job-cap", {
    assistantId: "assistant-grep-3",
    workspaceId: "workspace-grep-3",
    runtimeRequestId: "request-grep-3",
    runtimeSessionId: null,
    toolCode: "grep",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "match" }
  });

  const completed = capturedJobUpdates.find((d) => d.status === "completed");
  const payload = completed!.resultPayload as { content: string | null };
  const parsed = JSON.parse(payload.content!) as { matchCount: number; truncated: boolean };
  assert.equal(parsed.matchCount, 200, "match count must be capped at 200");
  assert.equal(parsed.truncated, true, "truncation must be flagged when matches exceed the cap");
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
    toolCode: "files",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { action: "write", path: "hello.txt", content: "world" }
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
    toolCode: "files",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    args: { action: "write", path: "hello2.txt", content: "world2" }
  });
  // Brief settle
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    warmSessionPodCalls.length,
    warmCallsBeforeNull,
    "warmSessionPod must NOT be called when runtimeSessionId is null"
  );
});

test("SandboxService: glob runs fd via pod exec and returns sorted relative paths", async () => {
  const capturedJobUpdates: Array<Record<string, unknown>> = [];
  const capturedShellCalls: Array<{ shellCommand: string }> = [];
  const service = buildGrepGlobService(capturedJobUpdates, capturedShellCalls, {
    exitCode: 0,
    stdout: "/workspace/src/index.ts\n/workspace/src/app.ts\n",
    stderr: ""
  });
  const access = service as unknown as SandboxServiceTestAccess;

  await access.executeQueuedJob("glob-job-1", {
    assistantId: "assistant-glob-1",
    workspaceId: "workspace-glob-1",
    runtimeRequestId: "request-glob-1",
    runtimeSessionId: null,
    toolCode: "glob",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
    args: { pattern: "*.ts" }
  });

  assert.equal(capturedShellCalls.length, 1, "fd must be invoked exactly once via pod exec");
  const shellCommand = capturedShellCalls[0]!.shellCommand;
  assert.ok(shellCommand.startsWith("fd "), "pod shell must invoke fd");
  assert.ok(shellCommand.includes(" -- "), "fd command must include pattern terminator");

  const completed = capturedJobUpdates.find((d) => d.status === "completed");
  const payload = completed!.resultPayload as { content: string | null };
  const parsed = JSON.parse(payload.content!) as { paths: string[]; truncated: boolean };
  assert.deepEqual(
    parsed.paths,
    ["/workspace/src/app.ts", "/workspace/src/index.ts"],
    "paths must be pod-absolute and sorted"
  );
  assert.equal(parsed.truncated, false);
});
