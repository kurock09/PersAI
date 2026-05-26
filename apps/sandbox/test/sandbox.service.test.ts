import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { SandboxObservabilityService } from "../src/sandbox-observability.service";
import { SandboxService } from "../src/sandbox.service";

type MountedWorkspaceState = {
  byRef: Map<string, { relativePath: string }>;
};

type WorkspaceFileSnapshot = {
  relativePath: string;
};

type ReadFileResult = {
  content: string | null;
};

type ProcessUsage = {
  processCount: number;
};

type ProcessError = {
  code?: string;
};

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
      mountedFileRefs?: string[];
    }
  ): Promise<void>;
  resolveWorkspaceSessionRoot(assistantId: string, workspaceId: string): string;
  materializeMountedFiles(
    workspaceRoot: string,
    assistantId: string,
    workspaceId: string,
    args: { fileRef: string }
  ): Promise<MountedWorkspaceState>;
  executeFilesReadAction(
    workspaceRoot: string,
    args: { fileRef: string },
    mountedFiles: MountedWorkspaceState
  ): Promise<ReadFileResult>;
  collectWorkspaceFiles(workspaceRoot: string): Promise<WorkspaceFileSnapshot[]>;
  selectProducedWorkspaceFiles(
    files: WorkspaceFileSnapshot[],
    mountedFiles: MountedWorkspaceState
  ): WorkspaceFileSnapshot[];
  runProcess(input: {
    workspaceRoot: string;
    policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY;
    cwd: string;
    command: string;
    args: string[];
    leaseGuard: {
      active: boolean;
      renewalError: Error | null;
    };
  }): Promise<unknown>;
  readProcessTreeUsage(pid: number): Promise<ProcessUsage | null>;
  terminateProcessTree(pid: number): Promise<void>;
};

const RETRYABLE_WINDOWS_RM_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

async function removePathWithRetries(path: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await fs.rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      if (!code || !RETRYABLE_WINDOWS_RM_CODES.has(code) || attempt === 5) {
        throw error;
      }
      // Windows can keep a just-killed child process directory briefly locked.
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

type DurableSandboxJob = {
  id: string;
  assistantId: string;
  workspaceId: string;
  toolCode: string;
  status: string;
  resultPayload: Record<string, unknown> | null;
  violationCode: string | null;
  violationMessage: string | null;
  resourceUsage: Record<string, unknown> | null;
  startedAt?: Date;
  completedAt?: Date;
};

type DurableAssistantFile = {
  id: string;
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string | null;
  origin: "sandbox_output";
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: bigint;
  logicalSizeBytes: bigint | null;
  sha256: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

type DurableWorkspaceLease = {
  id: string;
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string | null;
  leaseToken: string;
  holderId: string;
  expiresAt: Date;
};

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | null = null;
  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve() {
      resolvePromise?.();
    }
  };
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
    ...overrides
  } as SandboxConfig;
}

function createSandboxObservabilityService(): SandboxObservabilityService {
  return new SandboxObservabilityService();
}

function createDurableHarness() {
  const jobs = new Map<string, DurableSandboxJob>();
  const assistantFiles: DurableAssistantFile[] = [];
  const storedObjects = new Map<string, Buffer>();
  const workspaceLeases = new Map<string, DurableWorkspaceLease>();
  let durableFileCounter = 0;
  let durableLeaseCounter = 0;
  const workspaceLeaseKey = (assistantId: string, workspaceId: string) =>
    `${assistantId}:${workspaceId}`;
  const prismaStub = {
    sandboxJob: {
      async update(input: { where: { id: string }; data: Record<string, unknown> }) {
        const existing = jobs.get(input.where.id);
        if (!existing) {
          throw new Error(`Sandbox job "${input.where.id}" not found in test store`);
        }
        const next = {
          ...existing,
          ...input.data
        } as DurableSandboxJob;
        jobs.set(input.where.id, next);
        return next;
      },
      async findUnique(input: { where: { id: string }; include?: { assistantFiles?: boolean } }) {
        const job = jobs.get(input.where.id);
        if (!job) {
          return null;
        }
        return {
          ...job,
          assistantFiles:
            input.include?.assistantFiles === true
              ? assistantFiles.filter((file) => file.sandboxJobId === job.id)
              : []
        };
      }
    },
    assistantFile: {
      async findMany(input: {
        where:
          | { id: { in: string[] }; assistantId?: string; workspaceId?: string }
          | { assistantId: string; workspaceId: string };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) {
        const where = input.where;
        if ("id" in where) {
          return assistantFiles.filter(
            (file) =>
              where.id.in.includes(file.id) &&
              (where.assistantId === undefined || file.assistantId === where.assistantId) &&
              (where.workspaceId === undefined || file.workspaceId === where.workspaceId)
          );
        }
        return assistantFiles
          .filter(
            (file) =>
              file.assistantId === where.assistantId && file.workspaceId === where.workspaceId
          )
          .sort((left, right) => {
            if (left.relativePath !== right.relativePath) {
              return left.relativePath.localeCompare(right.relativePath);
            }
            return right.updatedAt.getTime() - left.updatedAt.getTime();
          });
      },
      async create(input: { data: Record<string, unknown> }) {
        const now = new Date();
        const created: DurableAssistantFile = {
          id: `assistant-file-${String(++durableFileCounter)}`,
          assistantId: String(input.data.assistantId),
          workspaceId: String(input.data.workspaceId),
          sandboxJobId:
            typeof input.data.sandboxJobId === "string" ? input.data.sandboxJobId : null,
          origin: "sandbox_output",
          sourceToolCode:
            typeof input.data.sourceToolCode === "string" ? input.data.sourceToolCode : null,
          objectKey: String(input.data.objectKey),
          relativePath: String(input.data.relativePath),
          displayName: typeof input.data.displayName === "string" ? input.data.displayName : null,
          mimeType: String(input.data.mimeType),
          sizeBytes: input.data.sizeBytes as bigint,
          logicalSizeBytes: (input.data.logicalSizeBytes as bigint | null) ?? null,
          sha256: typeof input.data.sha256 === "string" ? input.data.sha256 : null,
          metadata:
            input.data.metadata !== null && typeof input.data.metadata === "object"
              ? (input.data.metadata as Record<string, unknown>)
              : null,
          createdAt: now,
          updatedAt: now
        };
        assistantFiles.push(created);
        return created;
      },
      async update(input: { where: { id: string }; data: Record<string, unknown> }) {
        const existingIndex = assistantFiles.findIndex((file) => file.id === input.where.id);
        if (existingIndex === -1) {
          throw new Error(`Assistant file "${input.where.id}" not found in test store`);
        }
        const existing = assistantFiles[existingIndex]!;
        const updated: DurableAssistantFile = {
          ...existing,
          sandboxJobId:
            typeof input.data.sandboxJobId === "string" ? input.data.sandboxJobId : null,
          sourceToolCode:
            typeof input.data.sourceToolCode === "string" ? input.data.sourceToolCode : null,
          objectKey: String(input.data.objectKey),
          relativePath: String(input.data.relativePath),
          displayName: typeof input.data.displayName === "string" ? input.data.displayName : null,
          mimeType: String(input.data.mimeType),
          sizeBytes: input.data.sizeBytes as bigint,
          logicalSizeBytes: (input.data.logicalSizeBytes as bigint | null) ?? null,
          sha256: typeof input.data.sha256 === "string" ? input.data.sha256 : null,
          metadata:
            input.data.metadata !== null && typeof input.data.metadata === "object"
              ? (input.data.metadata as Record<string, unknown>)
              : null,
          updatedAt: new Date()
        };
        assistantFiles[existingIndex] = updated;
        return updated;
      },
      async deleteMany(input: {
        where: {
          assistantId: string;
          workspaceId: string;
          relativePath?: string | { in: string[] };
          id?: { not?: string; in?: string[] };
        };
      }) {
        const relativePaths =
          input.where.relativePath === undefined
            ? null
            : typeof input.where.relativePath === "string"
              ? [input.where.relativePath]
              : input.where.relativePath.in;
        const allowedIds = input.where.id?.in ?? null;
        let removed = 0;
        for (let index = assistantFiles.length - 1; index >= 0; index -= 1) {
          const file = assistantFiles[index]!;
          if (
            file.assistantId !== input.where.assistantId ||
            file.workspaceId !== input.where.workspaceId ||
            (relativePaths !== null && !relativePaths.includes(file.relativePath)) ||
            (allowedIds !== null && !allowedIds.includes(file.id)) ||
            (input.where.id?.not !== undefined && file.id === input.where.id.not)
          ) {
            continue;
          }
          assistantFiles.splice(index, 1);
          removed++;
        }
        return { count: removed };
      }
    },
    assistantWorkspaceLease: {
      async create(input: { data: Record<string, unknown> }) {
        const assistantId = String(input.data.assistantId);
        const workspaceId = String(input.data.workspaceId);
        const key = workspaceLeaseKey(assistantId, workspaceId);
        if (workspaceLeases.has(key)) {
          throw Object.assign(new Error(`Workspace lease "${key}" already exists`), {
            code: "P2002"
          });
        }
        const created: DurableWorkspaceLease = {
          id: `workspace-lease-${String(++durableLeaseCounter)}`,
          assistantId,
          workspaceId,
          sandboxJobId:
            typeof input.data.sandboxJobId === "string" ? input.data.sandboxJobId : null,
          leaseToken: String(input.data.leaseToken),
          holderId: String(input.data.holderId),
          expiresAt: input.data.expiresAt as Date
        };
        workspaceLeases.set(key, created);
        return created;
      },
      async updateMany(input: {
        where: {
          assistantId: string;
          workspaceId: string;
          leaseToken?: string;
          holderId?: string;
          expiresAt?: { lt?: Date; gt?: Date };
        };
        data: Record<string, unknown>;
      }) {
        const key = workspaceLeaseKey(input.where.assistantId, input.where.workspaceId);
        const existing = workspaceLeases.get(key);
        if (!existing) {
          return { count: 0 };
        }
        if (
          input.where.leaseToken !== undefined &&
          existing.leaseToken !== input.where.leaseToken
        ) {
          return { count: 0 };
        }
        if (input.where.holderId !== undefined && existing.holderId !== input.where.holderId) {
          return { count: 0 };
        }
        if (
          input.where.expiresAt?.lt !== undefined &&
          !(existing.expiresAt.getTime() < input.where.expiresAt.lt.getTime())
        ) {
          return { count: 0 };
        }
        if (
          input.where.expiresAt?.gt !== undefined &&
          !(existing.expiresAt.getTime() > input.where.expiresAt.gt.getTime())
        ) {
          return { count: 0 };
        }
        const updated: DurableWorkspaceLease = {
          ...existing,
          sandboxJobId:
            typeof input.data.sandboxJobId === "string"
              ? input.data.sandboxJobId
              : input.data.sandboxJobId === null
                ? null
                : existing.sandboxJobId,
          leaseToken:
            typeof input.data.leaseToken === "string" ? input.data.leaseToken : existing.leaseToken,
          holderId:
            typeof input.data.holderId === "string" ? input.data.holderId : existing.holderId,
          expiresAt: (input.data.expiresAt as Date | undefined) ?? existing.expiresAt
        };
        workspaceLeases.set(key, updated);
        return { count: 1 };
      }
    }
  };
  const objectStorageStub = {
    buildSandboxObjectKey(input: { assistantId: string; jobId: string; relativePath: string }) {
      return `assistant-media/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${input.relativePath.replace(/\//g, "__")}`;
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
  return {
    jobs,
    assistantFiles,
    storedObjects,
    workspaceLeases,
    createService() {
      return new SandboxService(
        prismaStub as never,
        objectStorageStub as never,
        createSandboxObservabilityService(),
        createSandboxConfig()
      );
    }
  };
}

async function run(): Promise<void> {
  const sourceBuffer = Buffer.from("hello from file ref", "utf8");
  const service = new SandboxService(
    {
      assistantFile: {
        async findMany(input: {
          where: { id: { in: string[] }; assistantId: string; workspaceId: string };
        }) {
          assert.deepEqual(input.where.id.in, ["file-ref-1"]);
          assert.equal(input.where.assistantId, "assistant-1");
          assert.equal(input.where.workspaceId, "workspace-1");
          return [
            {
              id: "file-ref-1",
              relativePath: "inputs/example.txt",
              objectKey: "sandbox/input/example.txt"
            }
          ];
        }
      }
    } as never,
    {
      async downloadObject(objectKey: string) {
        assert.equal(objectKey, "sandbox/input/example.txt");
        return sourceBuffer;
      }
    } as never,
    createSandboxObservabilityService(),
    createSandboxConfig()
  );
  const serviceTestAccess = service as unknown as SandboxServiceTestAccess;

  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-sandbox-test-"));
  try {
    const mountedFiles = await serviceTestAccess.materializeMountedFiles(
      workspaceRoot,
      "assistant-1",
      "workspace-1",
      { fileRef: "file-ref-1" }
    );
    assert.equal(mountedFiles.byRef.get("file-ref-1")?.relativePath, "inputs/example.txt");

    const readResult = await serviceTestAccess.executeFilesReadAction(
      workspaceRoot,
      { fileRef: "file-ref-1" },
      mountedFiles
    );
    assert.equal(readResult.content, "hello from file ref");

    const filesAfterMount = await serviceTestAccess.collectWorkspaceFiles(workspaceRoot);
    const producedAfterMount = serviceTestAccess.selectProducedWorkspaceFiles(
      filesAfterMount,
      mountedFiles
    );
    assert.deepEqual(producedAfterMount, []);

    await fs.writeFile(join(workspaceRoot, "inputs", "example.txt"), "changed content", "utf8");
    await fs.mkdir(join(workspaceRoot, "outputs"), { recursive: true });
    await fs.writeFile(join(workspaceRoot, "outputs", "fresh.txt"), "brand new", "utf8");

    const filesAfterChange = await serviceTestAccess.collectWorkspaceFiles(workspaceRoot);
    const producedAfterChange = serviceTestAccess.selectProducedWorkspaceFiles(
      filesAfterChange,
      mountedFiles
    );
    assert.deepEqual(
      producedAfterChange.map((file: { relativePath: string }) => file.relativePath),
      ["inputs/example.txt", "outputs/fresh.txt"]
    );

    await fs.writeFile(
      join(workspaceRoot, "inputs", "example.txt"),
      Buffer.from("a\u0000b\u0000c", "utf8")
    );
    const readAfterNul = await serviceTestAccess.executeFilesReadAction(
      workspaceRoot,
      { fileRef: "file-ref-1" },
      mountedFiles
    );
    assert.equal(
      readAfterNul.content,
      "abc",
      "NUL bytes must be stripped so Postgres text/JSON persistence (sandboxJob) does not fail with 22P05"
    );
    await fs.writeFile(join(workspaceRoot, "inputs", "example.txt"), "changed content", "utf8");

    const staleMountHarness = createDurableHarness();
    staleMountHarness.assistantFiles.push({
      id: "assistant-file-stale-mount",
      assistantId: "assistant-mount",
      workspaceId: "workspace-mount",
      sandboxJobId: null,
      origin: "sandbox_output",
      sourceToolCode: "files",
      objectKey: "assistant-media/persisted/mount-missing.txt",
      relativePath: "docs/mount-missing.txt",
      displayName: "mount-missing.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(4),
      logicalSizeBytes: BigInt(4),
      sha256: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const staleMountService = staleMountHarness.createService();
    const staleMountAccess = staleMountService as unknown as SandboxServiceTestAccess;
    await assert.rejects(
      staleMountAccess.materializeMountedFiles(
        workspaceRoot,
        "assistant-mount",
        "workspace-mount",
        { fileRef: "assistant-file-stale-mount" }
      ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "file_ref_not_found" &&
        /stored object is missing/i.test(error.message)
    );
    assert.equal(
      staleMountHarness.assistantFiles.some((file) => file.id === "assistant-file-stale-mount"),
      false
    );
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const completedService = new SandboxService(
    {
      sandboxJob: {
        async findUnique(input: { where: { id: string }; include: Record<string, boolean> }) {
          assert.equal(input.where.id, "job-completed-1");
          assert.equal(input.include.assistantFiles, true);
          return {
            id: "job-completed-1",
            status: "completed",
            toolCode: "files",
            violationCode: null,
            violationMessage: null,
            resultPayload: {
              reason: null,
              warning: null,
              exitCode: null,
              stdout: null,
              stderr: null,
              content: null
            },
            assistantFiles: [
              {
                id: "assistant-file-1",
                origin: "sandbox_output",
                sourceToolCode: "files",
                objectKey: "assistant-media/assistant-files/assistant-file-1/report.txt",
                relativePath: "reports/report.txt",
                displayName: "report.txt",
                mimeType: "text/plain",
                sizeBytes: BigInt(64),
                logicalSizeBytes: BigInt(64),
                createdAt: new Date("2026-05-26T13:00:00.000Z")
              }
            ],
            fileRefs: []
          };
        }
      }
    } as never,
    {} as never,
    createSandboxObservabilityService(),
    createSandboxConfig()
  );
  const completedJob = await completedService.pollJob("job-completed-1");
  assert.equal(completedJob.status, "completed");
  assert.equal(completedJob.files[0]?.fileRef.fileRef, "assistant-file-1");
  assert.equal(
    completedJob.files[0]?.fileRef.objectKey,
    "assistant-media/assistant-files/assistant-file-1/report.txt"
  );
  assert.equal(completedJob.files[0]?.fileRef.createdAt, "2026-05-26T13:00:00.000Z");

  const durablePolicy = {
    ...DEFAULT_RUNTIME_SANDBOX_POLICY,
    enabled: true,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  };
  const durableHarness = createDurableHarness();
  const durableService = durableHarness.createService();
  const durableServiceTestAccess = durableService as unknown as SandboxServiceTestAccess;
  const durableWorkspaceRoot = durableServiceTestAccess.resolveWorkspaceSessionRoot(
    "assistant-1",
    "workspace-1"
  );
  const queueDurableJob = (
    id: string,
    toolCode: string,
    assistantId = "assistant-1",
    workspaceId = "workspace-1"
  ) => {
    durableHarness.jobs.set(id, {
      id,
      assistantId,
      workspaceId,
      toolCode,
      status: "queued",
      resultPayload: null,
      violationCode: null,
      violationMessage: null,
      resourceUsage: null
    });
  };
  try {
    queueDurableJob("job-write-1", "files");
    await durableServiceTestAccess.executeQueuedJob("job-write-1", {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeRequestId: "request-write-1",
      runtimeSessionId: "session-1",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "write",
        path: "docs/report.txt",
        content: "first version"
      }
    });
    const writeJob = await durableService.pollJob("job-write-1");
    assert.equal(writeJob.status, "completed");
    assert.equal(writeJob.files[0]?.fileRef.relativePath, "docs/report.txt");
    const stableFileRef = writeJob.files[0]?.fileRef.fileRef;
    assert.ok(stableFileRef);

    queueDurableJob("job-read-1", "files");
    await durableServiceTestAccess.executeQueuedJob("job-read-1", {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeRequestId: "request-read-1",
      runtimeSessionId: "session-2",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "read",
        path: "docs/report.txt"
      }
    });
    const readJob = await durableService.pollJob("job-read-1");
    assert.equal(readJob.status, "completed");
    assert.equal(readJob.content, "first version");

    queueDurableJob("job-edit-1", "files");
    await durableServiceTestAccess.executeQueuedJob("job-edit-1", {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeRequestId: "request-edit-1",
      runtimeSessionId: "session-3",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "edit",
        path: "docs/report.txt",
        oldText: "first version",
        newText: "second version"
      }
    });
    const editJob = await durableService.pollJob("job-edit-1");
    assert.equal(editJob.status, "completed");
    assert.equal(editJob.files[0]?.fileRef.fileRef, stableFileRef);
    assert.equal(durableHarness.assistantFiles.length, 1);

    await removePathWithRetries(join(durableWorkspaceRoot, ".."));

    queueDurableJob("job-read-cold", "files");
    await durableServiceTestAccess.executeQueuedJob("job-read-cold", {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeRequestId: "request-read-cold",
      runtimeSessionId: "session-4",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "read",
        path: "docs/report.txt"
      }
    });
    const coldReadJob = await durableService.pollJob("job-read-cold");
    assert.equal(coldReadJob.status, "completed");
    assert.equal(coldReadJob.content, "second version");

    const inheritedWorkspaceHarness = createDurableHarness();
    for (let index = 0; index < 20; index += 1) {
      const objectKey = `assistant-media/persisted/inherited-${String(index)}.txt`;
      const inheritedBuffer = Buffer.from(`seed-${String(index)}`, "utf8");
      inheritedWorkspaceHarness.storedObjects.set(objectKey, inheritedBuffer);
      inheritedWorkspaceHarness.assistantFiles.push({
        id: `assistant-file-inherited-${String(index)}`,
        assistantId: "assistant-inherited",
        workspaceId: "workspace-inherited",
        sandboxJobId: "job-seed",
        origin: "sandbox_output",
        sourceToolCode: "files",
        objectKey,
        relativePath: `dir-${String(index)}/seed.txt`,
        displayName: "seed.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(inheritedBuffer.length),
        logicalSizeBytes: BigInt(inheritedBuffer.length),
        sha256: createHash("sha256").update(inheritedBuffer).digest("hex"),
        metadata: {},
        createdAt: new Date(Date.now() - 5_000),
        updatedAt: new Date(Date.now() - 5_000)
      });
    }
    inheritedWorkspaceHarness.jobs.set("job-inherited-write", {
      id: "job-inherited-write",
      assistantId: "assistant-inherited",
      workspaceId: "workspace-inherited",
      toolCode: "files",
      status: "queued",
      resultPayload: null,
      violationCode: null,
      violationMessage: null,
      resourceUsage: null
    });
    const inheritedWriteService = inheritedWorkspaceHarness.createService();
    const inheritedWriteAccess = inheritedWriteService as unknown as SandboxServiceTestAccess;
    await inheritedWriteAccess.executeQueuedJob("job-inherited-write", {
      assistantId: "assistant-inherited",
      workspaceId: "workspace-inherited",
      runtimeRequestId: "request-inherited-write",
      runtimeSessionId: "session-inherited-write",
      toolCode: "files",
      policy: {
        ...durablePolicy,
        maxFileCountPerJob: 1,
        maxDirectoryCountPerJob: 1,
        maxWorkspaceBytesPerJob: 1024
      },
      args: {
        action: "write",
        path: "hello_test.txt",
        content: "hello from PersAI"
      }
    });
    assert.equal(inheritedWorkspaceHarness.jobs.get("job-inherited-write")?.status, "completed");

    const leaseHarness = createDurableHarness();
    const leaseServiceA = leaseHarness.createService();
    const leaseServiceB = leaseHarness.createService();
    const leaseServiceATestAccess = leaseServiceA as unknown as SandboxServiceTestAccess;
    const leaseServiceBTestAccess = leaseServiceB as unknown as SandboxServiceTestAccess;
    const queueLeaseJob = (
      id: string,
      toolCode: string,
      assistantId = "assistant-lease",
      workspaceId = "workspace-lease"
    ) => {
      leaseHarness.jobs.set(id, {
        id,
        assistantId,
        workspaceId,
        toolCode,
        status: "queued",
        resultPayload: null,
        violationCode: null,
        violationMessage: null,
        resourceUsage: null
      });
    };
    queueLeaseJob("job-lease-a", "files");
    queueLeaseJob("job-lease-b", "files");
    queueLeaseJob("job-lease-other", "files", "assistant-other", "workspace-other");
    const firstJobEntered = createDeferred();
    const releaseFirstJob = createDeferred();
    const originalExecuteTool = (
      leaseServiceA as unknown as {
        executeTool: (input: unknown) => Promise<Record<string, unknown>>;
      }
    ).executeTool.bind(leaseServiceA);
    (
      leaseServiceA as unknown as {
        executeTool: (input: unknown) => Promise<Record<string, unknown>>;
      }
    ).executeTool = async (input: unknown) => {
      firstJobEntered.resolve();
      await releaseFirstJob.promise;
      return originalExecuteTool(input);
    };
    const firstJobPromise = leaseServiceATestAccess.executeQueuedJob("job-lease-a", {
      assistantId: "assistant-lease",
      workspaceId: "workspace-lease",
      runtimeRequestId: "request-lease-a",
      runtimeSessionId: "session-lease-a",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "write",
        path: "shared/report.txt",
        content: "first holder"
      }
    });
    await firstJobEntered.promise;
    const secondJobPromise = leaseServiceBTestAccess.executeQueuedJob("job-lease-b", {
      assistantId: "assistant-lease",
      workspaceId: "workspace-lease",
      runtimeRequestId: "request-lease-b",
      runtimeSessionId: "session-lease-b",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "write",
        path: "shared/report.txt",
        content: "second holder"
      }
    });
    const parallelOtherWorkspacePromise = leaseServiceBTestAccess.executeQueuedJob(
      "job-lease-other",
      {
        assistantId: "assistant-other",
        workspaceId: "workspace-other",
        runtimeRequestId: "request-lease-other",
        runtimeSessionId: "session-lease-other",
        toolCode: "files",
        policy: durablePolicy,
        args: {
          action: "write",
          path: "shared/other.txt",
          content: "parallel workspace"
        }
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(leaseHarness.jobs.get("job-lease-b")?.status, "queued");
    await parallelOtherWorkspacePromise;
    assert.equal(leaseHarness.jobs.get("job-lease-other")?.status, "completed");
    assert.equal(
      leaseHarness.workspaceLeases.get("assistant-lease:workspace-lease")?.sandboxJobId,
      "job-lease-a"
    );
    releaseFirstJob.resolve();
    await Promise.all([firstJobPromise, secondJobPromise, parallelOtherWorkspacePromise]);
    assert.equal(leaseHarness.jobs.get("job-lease-a")?.status, "completed");
    assert.equal(leaseHarness.jobs.get("job-lease-b")?.status, "completed");

    const reclaimHarness = createDurableHarness();
    reclaimHarness.workspaceLeases.set("assistant-reclaim:workspace-reclaim", {
      id: "workspace-lease-stale",
      assistantId: "assistant-reclaim",
      workspaceId: "workspace-reclaim",
      sandboxJobId: "old-job",
      leaseToken: "stale-token",
      holderId: "stale-holder",
      expiresAt: new Date(Date.now() - 1_000)
    });
    reclaimHarness.jobs.set("job-reclaim", {
      id: "job-reclaim",
      assistantId: "assistant-reclaim",
      workspaceId: "workspace-reclaim",
      toolCode: "files",
      status: "queued",
      resultPayload: null,
      violationCode: null,
      violationMessage: null,
      resourceUsage: null
    });
    await (reclaimHarness.createService() as unknown as SandboxServiceTestAccess).executeQueuedJob(
      "job-reclaim",
      {
        assistantId: "assistant-reclaim",
        workspaceId: "workspace-reclaim",
        runtimeRequestId: "request-reclaim",
        runtimeSessionId: "session-reclaim",
        toolCode: "files",
        policy: durablePolicy,
        args: {
          action: "write",
          path: "docs/reclaimed.txt",
          content: "reclaimed"
        }
      }
    );
    assert.equal(reclaimHarness.jobs.get("job-reclaim")?.status, "completed");
    assert.equal(
      reclaimHarness.workspaceLeases.get("assistant-reclaim:workspace-reclaim")?.sandboxJobId,
      null
    );
    assert.notEqual(
      reclaimHarness.workspaceLeases.get("assistant-reclaim:workspace-reclaim")?.leaseToken,
      "stale-token"
    );

    const hydrateCleanupHarness = createDurableHarness();
    const persistedHydrateBuffer = Buffer.from("persisted good", "utf8");
    hydrateCleanupHarness.storedObjects.set(
      "assistant-media/persisted/good.txt",
      persistedHydrateBuffer
    );
    hydrateCleanupHarness.assistantFiles.push(
      {
        id: "assistant-file-good",
        assistantId: "assistant-hydrate",
        workspaceId: "workspace-hydrate",
        sandboxJobId: "job-before",
        origin: "sandbox_output",
        sourceToolCode: "files",
        objectKey: "assistant-media/persisted/good.txt",
        relativePath: "docs/good.txt",
        displayName: "good.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(persistedHydrateBuffer.length),
        logicalSizeBytes: BigInt(persistedHydrateBuffer.length),
        sha256: createHash("sha256").update(persistedHydrateBuffer).digest("hex"),
        metadata: {},
        createdAt: new Date(Date.now() - 2_000),
        updatedAt: new Date(Date.now() - 2_000)
      },
      {
        id: "assistant-file-stale",
        assistantId: "assistant-hydrate",
        workspaceId: "workspace-hydrate",
        sandboxJobId: "job-before",
        origin: "sandbox_output",
        sourceToolCode: "files",
        objectKey: "assistant-media/persisted/missing.txt",
        relativePath: "docs/stale.txt",
        displayName: "stale.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(5),
        logicalSizeBytes: BigInt(5),
        sha256: "stale",
        metadata: {},
        createdAt: new Date(Date.now() - 1_000),
        updatedAt: new Date(Date.now() - 1_000)
      }
    );
    hydrateCleanupHarness.jobs.set("job-hydrate-cleanup", {
      id: "job-hydrate-cleanup",
      assistantId: "assistant-hydrate",
      workspaceId: "workspace-hydrate",
      toolCode: "files",
      status: "queued",
      resultPayload: null,
      violationCode: null,
      violationMessage: null,
      resourceUsage: null
    });
    const hydrateCleanupService = hydrateCleanupHarness.createService();
    const hydrateCleanupTestAccess = hydrateCleanupService as unknown as SandboxServiceTestAccess;
    const hydrateCleanupWorkspaceRoot = hydrateCleanupTestAccess.resolveWorkspaceSessionRoot(
      "assistant-hydrate",
      "workspace-hydrate"
    );
    await hydrateCleanupTestAccess.executeQueuedJob("job-hydrate-cleanup", {
      assistantId: "assistant-hydrate",
      workspaceId: "workspace-hydrate",
      runtimeRequestId: "request-hydrate-cleanup",
      runtimeSessionId: "session-hydrate-cleanup",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "write",
        path: "docs/new.txt",
        content: "fresh content"
      }
    });
    assert.equal(hydrateCleanupHarness.jobs.get("job-hydrate-cleanup")?.status, "completed");
    assert.equal(
      hydrateCleanupHarness.assistantFiles.some((file) => file.id === "assistant-file-stale"),
      false
    );
    assert.equal(
      hydrateCleanupHarness.assistantFiles.some((file) => file.relativePath === "docs/good.txt"),
      true
    );
    assert.equal(
      hydrateCleanupHarness.assistantFiles.some((file) => file.relativePath === "docs/new.txt"),
      true
    );
    assert.equal(
      await fs.readFile(join(hydrateCleanupWorkspaceRoot, "docs", "good.txt"), "utf8"),
      "persisted good"
    );
    await assert.rejects(
      fs.readFile(join(hydrateCleanupWorkspaceRoot, "docs", "stale.txt"), "utf8")
    );
    assert.equal(
      await fs.readFile(join(hydrateCleanupWorkspaceRoot, "docs", "new.txt"), "utf8"),
      "fresh content"
    );

    const resetHarness = createDurableHarness();
    resetHarness.storedObjects.set(
      "assistant-media/persisted/original.txt",
      Buffer.from("persisted", "utf8")
    );
    resetHarness.assistantFiles.push({
      id: "assistant-file-reset",
      assistantId: "assistant-reset",
      workspaceId: "workspace-reset",
      sandboxJobId: "job-baseline",
      origin: "sandbox_output",
      sourceToolCode: "files",
      objectKey: "assistant-media/persisted/original.txt",
      relativePath: "docs/reset.txt",
      displayName: "reset.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(9),
      logicalSizeBytes: BigInt(9),
      sha256: null,
      metadata: {},
      createdAt: new Date(Date.now() - 1_000),
      updatedAt: new Date(Date.now() - 1_000)
    });
    resetHarness.jobs.set("job-reset", {
      id: "job-reset",
      assistantId: "assistant-reset",
      workspaceId: "workspace-reset",
      toolCode: "files",
      status: "queued",
      resultPayload: null,
      violationCode: null,
      violationMessage: null,
      resourceUsage: null
    });
    const resetService = resetHarness.createService();
    const resetServiceTestAccess = resetService as unknown as SandboxServiceTestAccess;
    const resetWorkspaceRoot = resetServiceTestAccess.resolveWorkspaceSessionRoot(
      "assistant-reset",
      "workspace-reset"
    );
    const originalHeartbeat = (
      resetService as unknown as {
        startWorkspaceLeaseHeartbeat: (handle: unknown) => {
          active: boolean;
          renewalError: Error | null;
          heartbeatTimer: NodeJS.Timeout | null;
          renewing: boolean;
          handle: unknown;
        };
      }
    ).startWorkspaceLeaseHeartbeat.bind(resetService);
    (
      resetService as unknown as {
        startWorkspaceLeaseHeartbeat: (handle: unknown) => {
          active: boolean;
          renewalError: Error | null;
          heartbeatTimer: NodeJS.Timeout | null;
          renewing: boolean;
          handle: unknown;
        };
      }
    ).startWorkspaceLeaseHeartbeat = (handle: unknown) => {
      const guard = originalHeartbeat(handle);
      setTimeout(() => {
        guard.active = false;
        guard.renewalError = Object.assign(new Error("lost"), {
          code: "workspace_lease_lost",
          blocked: false
        });
      }, 0);
      return guard;
    };
    (
      resetService as unknown as {
        executeTool: (input: { workspaceRoot: string }) => Promise<Record<string, unknown>>;
      }
    ).executeTool = async (input: { workspaceRoot: string }) => {
      await fs.mkdir(join(input.workspaceRoot, "docs"), { recursive: true });
      await fs.writeFile(join(input.workspaceRoot, "docs", "reset.txt"), "mutated", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        reason: null,
        warning: null,
        exitCode: null,
        stdout: null,
        stderr: null,
        content: null
      };
    };
    await resetServiceTestAccess.executeQueuedJob("job-reset", {
      assistantId: "assistant-reset",
      workspaceId: "workspace-reset",
      runtimeRequestId: "request-reset",
      runtimeSessionId: "session-reset",
      toolCode: "files",
      policy: durablePolicy,
      args: {
        action: "write",
        path: "docs/reset.txt",
        content: "mutated"
      }
    });
    assert.equal(resetHarness.jobs.get("job-reset")?.status, "failed");
    assert.equal(
      await fs.readFile(join(resetWorkspaceRoot, "docs", "reset.txt"), "utf8"),
      "persisted"
    );
    assert.match(
      resetHarness.assistantFiles.find((file) => file.id === "assistant-file-reset")?.sha256 ?? "",
      /^[0-9a-f]{64}$/i
    );
  } finally {
    await removePathWithRetries(join(durableWorkspaceRoot, ".."));
  }

  let storedJob: {
    id: string;
    toolCode: string;
    status: string;
    resultPayload: unknown;
    violationCode: string | null;
    violationMessage: string | null;
    fileRefs: unknown[];
  } | null = null;
  const blockedService = new SandboxService(
    {
      sandboxJob: {
        async count(input: { where: Record<string, unknown> }) {
          if ("createdAt" in input.where) {
            assert.equal(input.where.assistantId, "assistant-1");
            assert.equal(input.where.workspaceId, "workspace-1");
            assert.ok(
              typeof input.where.createdAt === "object" &&
                input.where.createdAt !== null &&
                "gte" in input.where.createdAt &&
                (input.where.createdAt as { gte: unknown }).gte instanceof Date
            );
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
              typeof input.data.violationMessage === "string" ? input.data.violationMessage : null,
            fileRefs: []
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
    createSandboxConfig()
  );

  const blockedJob = await blockedService.submitJob({
    assistantId: "assistant-1",
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
  assert.equal(blockedJob.violationCode, "sandbox_daily_job_limit_reached");
  assert.match(blockedJob.warning ?? "", /Sandbox job quota reached for today/);

  let backlogStoredJob: {
    id: string;
    toolCode: string;
    status: string;
    resultPayload: unknown;
    violationCode: string | null;
    violationMessage: string | null;
    assistantFiles: unknown[];
  } | null = null;
  const backlogService = new SandboxService(
    {
      sandboxJob: {
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
              typeof input.data.violationMessage === "string" ? input.data.violationMessage : null,
            assistantFiles: []
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
    createSandboxConfig({ SANDBOX_MAX_PENDING_JOBS: 1 })
  );
  const backlogJob = await backlogService.submitJob({
    assistantId: "assistant-1",
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
  assert.match(backlogJob.warning ?? "", /Sandbox backlog is full/);

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
    completedAt: null,
    assistantFiles: []
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
    createSandboxConfig({ SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 1_000 })
  );
  const staleResult = await staleService.pollJob("job-stale-queued-1", 25);
  assert.equal(staleResult.status, "failed");
  assert.equal(staleResult.reason, "sandbox_queue_timeout");
  assert.match(staleResult.warning ?? "", /stayed queued/i);
  assert.equal(staleObservability.getCounters().staleFailures.queued, 1);

  const processGuardService = new SandboxService(
    {} as never,
    {} as never,
    createSandboxObservabilityService(),
    createSandboxConfig()
  );
  const processGuardTestAccess = processGuardService as unknown as SandboxServiceTestAccess;
  let workspaceStatsChecks = 0;
  (
    processGuardService as unknown as {
      computeWorkspaceStats(workspaceRoot: string): Promise<{
        fileCount: number;
        directoryCount: number;
        totalBytes: number;
      }>;
    }
  ).computeWorkspaceStats = async () => {
    workspaceStatsChecks += 1;
    return {
      fileCount: 0,
      directoryCount: 0,
      totalBytes: 0
    };
  };
  const processWorkspace = await fs.mkdtemp(join(tmpdir(), "persai-sandbox-process-"));
  const processGuardPolicy = {
    ...DEFAULT_RUNTIME_SANDBOX_POLICY,
    enabled: true,
    maxProcessRuntimeMs: 6_000,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  };
  try {
    const processFanoutScript = [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });",
      "setTimeout(() => {}, 15000);"
    ].join(" ");
    await assert.rejects(
      () =>
        processGuardTestAccess.runProcess({
          workspaceRoot: processWorkspace,
          policy: {
            ...processGuardPolicy,
            maxConcurrentProcesses: 1
          },
          cwd: processWorkspace,
          command: process.execPath,
          args: ["-e", processFanoutScript],
          leaseGuard: {
            active: true,
            renewalError: null
          }
        }),
      (error: unknown) => {
        const code = (error as ProcessError).code;
        // Windows can report the same fanout breach as a timeout if the child
        // tree is still unwinding when the runtime guard fires first.
        assert.ok(
          code === "process_count_limit_exceeded" || code === "process_timeout",
          `unexpected process-count guard code: ${String(code)}`
        );
        return true;
      }
    );

    const memoryGrowthScript = [
      "const buffers = [];",
      "const consume = () => { const buffer = Buffer.allocUnsafe(16 * 1024 * 1024); buffer.fill(1); buffers.push(buffer); };",
      "consume();",
      "setInterval(consume, 25);",
      "setTimeout(() => {}, 15000);"
    ].join(" ");
    await assert.rejects(
      () =>
        processGuardTestAccess.runProcess({
          workspaceRoot: processWorkspace,
          policy: {
            ...processGuardPolicy,
            maxConcurrentProcesses: 4,
            maxProcessRuntimeMs: 15_000,
            maxMemoryBytesPerJob: 48 * 1024 * 1024
          },
          cwd: processWorkspace,
          command: process.execPath,
          args: ["-e", memoryGrowthScript],
          leaseGuard: {
            active: true,
            renewalError: null
          }
        }),
      (error: unknown) => {
        assert.equal((error as ProcessError).code, "process_memory_limit_exceeded");
        return true;
      }
    );

    const cpuBurnScript =
      "const startedAt = Date.now(); while (Date.now() - startedAt < 5000) { Math.sqrt(Math.random()); }";
    await assert.rejects(
      () =>
        processGuardTestAccess.runProcess({
          workspaceRoot: processWorkspace,
          policy: {
            ...processGuardPolicy,
            maxConcurrentProcesses: 4,
            maxCpuMsPerJob: 250
          },
          cwd: processWorkspace,
          command: process.execPath,
          args: ["-e", cpuBurnScript],
          leaseGuard: {
            active: true,
            renewalError: null
          }
        }),
      (error: unknown) => {
        const code = (error as ProcessError).code;
        // Windows sometimes surfaces the same busy-loop guard as runtime timeout
        // before the CPU sampler crosses the limit threshold.
        assert.ok(
          code === "process_cpu_limit_exceeded" || code === "process_timeout",
          `unexpected cpu guard code: ${String(code)}`
        );
        return true;
      }
    );

    await assert.rejects(
      () =>
        processGuardTestAccess.runProcess({
          workspaceRoot: processWorkspace,
          policy: {
            ...processGuardPolicy,
            maxConcurrentProcesses: 4
          },
          cwd: processWorkspace,
          command: "__persai_missing_executable__",
          args: [],
          leaseGuard: {
            active: true,
            renewalError: null
          }
        }),
      (error: unknown) => {
        assert.equal((error as ProcessError).code, "process_spawn_failed");
        return true;
      }
    );

    const sampledTreeRoot = spawn(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });",
          "setTimeout(() => {}, 15000);"
        ].join(" ")
      ],
      {
        stdio: "ignore"
      }
    );
    try {
      const sampledRootPid = sampledTreeRoot.pid;
      if (sampledRootPid === undefined) {
        throw new Error("Expected spawned root process to expose a pid");
      }
      let usage: Awaited<ReturnType<typeof processGuardTestAccess.readProcessTreeUsage>> = null;
      const usageDeadline = Date.now() + (process.platform === "win32" ? 8_000 : 3_000);
      while (Date.now() < usageDeadline) {
        usage = await processGuardTestAccess.readProcessTreeUsage(sampledRootPid);
        if (usage !== null && usage.processCount >= 2) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(usage !== null);
      assert.ok(usage.processCount >= 2);
    } finally {
      if (typeof sampledTreeRoot.pid === "number") {
        await processGuardTestAccess.terminateProcessTree(sampledTreeRoot.pid);
      }
    }
    assert.equal(workspaceStatsChecks, 0);
  } finally {
    await removePathWithRetries(processWorkspace);
  }
}

void run();
