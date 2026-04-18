import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
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
  materializeMountedFiles(
    workspaceRoot: string,
    args: { fileRef: string }
  ): Promise<MountedWorkspaceState>;
  executeReadFile(
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
  }): Promise<unknown>;
  readProcessTreeUsage(pid: number): Promise<ProcessUsage | null>;
  terminateProcessTree(pid: number): Promise<void>;
};

async function run(): Promise<void> {
  const sourceBuffer = Buffer.from("hello from file ref", "utf8");
  const service = new SandboxService(
    {
      sandboxFileRef: {
        async findMany(input: { where: { id: { in: string[] } } }) {
          assert.deepEqual(input.where.id.in, ["file-ref-1"]);
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
    } as never
  );
  const serviceTestAccess = service as unknown as SandboxServiceTestAccess;

  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-sandbox-test-"));
  try {
    const mountedFiles = await serviceTestAccess.materializeMountedFiles(workspaceRoot, {
      fileRef: "file-ref-1"
    });
    assert.equal(mountedFiles.byRef.get("file-ref-1")?.relativePath, "inputs/example.txt");

    const readResult = await serviceTestAccess.executeReadFile(
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
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
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
        async count(input: {
          where: {
            assistantId: string;
            workspaceId: string;
            createdAt: { gte: Date };
          };
        }) {
          assert.equal(input.where.assistantId, "assistant-1");
          assert.equal(input.where.workspaceId, "workspace-1");
          assert.ok(input.where.createdAt.gte instanceof Date);
          return 1;
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
    {} as never
  );

  const blockedJob = await blockedService.submitJob({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolCode: "write_file",
    policy: {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true,
      sandboxJobsPerDay: 1
    },
    args: {
      path: "outputs/report.txt",
      content: "daily quota should block this job"
    }
  });

  assert.equal(blockedJob.status, "blocked");
  assert.equal(blockedJob.reason, "sandbox_daily_job_limit_reached");
  assert.equal(blockedJob.violationCode, "sandbox_daily_job_limit_reached");
  assert.match(blockedJob.warning ?? "", /Sandbox job quota reached for today/);

  const processGuardService = new SandboxService({} as never, {} as never);
  const processGuardTestAccess = processGuardService as unknown as SandboxServiceTestAccess;
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
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });",
      "setTimeout(() => {}, 5000);"
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
          args: ["-e", processFanoutScript]
        }),
      (error: unknown) => {
        assert.equal((error as ProcessError).code, "process_count_limit_exceeded");
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
          args: ["-e", memoryGrowthScript]
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
          args: ["-e", cpuBurnScript]
        }),
      (error: unknown) => {
        assert.equal((error as ProcessError).code, "process_cpu_limit_exceeded");
        return true;
      }
    );

    const sampledTreeRoot = spawn(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'ignore' });",
          "setTimeout(() => {}, 4000);"
        ].join(" ")
      ],
      {
        stdio: "ignore"
      }
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const sampledRootPid = sampledTreeRoot.pid;
      if (sampledRootPid === undefined) {
        throw new Error("Expected spawned root process to expose a pid");
      }
      const usage = await processGuardTestAccess.readProcessTreeUsage(sampledRootPid);
      assert.ok(usage !== null);
      assert.ok(usage.processCount >= 2);
    } finally {
      if (typeof sampledTreeRoot.pid === "number") {
        await processGuardTestAccess.terminateProcessTree(sampledTreeRoot.pid);
      }
    }
  } finally {
    await fs.rm(processWorkspace, { recursive: true, force: true });
  }
}

void run();
