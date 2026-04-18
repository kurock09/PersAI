import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname, basename, isAbsolute, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Injectable, Logger } from "@nestjs/common";
import type {
  RuntimeFileRef,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeSandboxPolicy,
  RuntimeSandboxProducedFile
} from "@persai/runtime-contract";
import type { Prisma } from "@prisma/client";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";

type WorkspaceFileSnapshot = {
  relativePath: string;
  absolutePath: string;
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
  sha256: string;
};

type MountedFileSnapshot = {
  fileRef: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
};

type MountedWorkspaceState = {
  byRef: Map<string, MountedFileSnapshot>;
  byPath: Map<string, MountedFileSnapshot>;
};

type WorkspaceStats = {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  peakProcessCount: number;
  peakCpuMs: number;
  peakMemoryBytes: number;
};

type ProcessSnapshot = {
  pid: number;
  ppid: number | null;
  cpuMs: number;
  memoryBytes: number;
};

type ProcessTreeUsage = {
  pids: number[];
  processCount: number;
  totalCpuMs: number;
  totalMemoryBytes: number;
};

type SandboxPolicyError = Error & {
  code: string;
  blocked: boolean;
  resourceUsage?: Record<string, unknown>;
};

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    private readonly prisma: SandboxPrismaService,
    private readonly objectStorage: SandboxObjectStorageService
  ) {}

  async submitJob(request: RuntimeSandboxJobRequest): Promise<RuntimeSandboxJobResult> {
    const preflightViolation = await this.resolvePreflightViolation(request);
    const created = await this.prisma.sandboxJob.create({
      data: {
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        runtimeRequestId: request.runtimeRequestId,
        runtimeSessionId: request.runtimeSessionId,
        toolCode: request.toolCode,
        status: preflightViolation === null ? "queued" : "blocked",
        relativeWorkspace: ".",
        policySnapshot: this.toJsonValue(request.policy),
        requestPayload: this.toJsonValue(request.args),
        ...(preflightViolation === null
          ? {}
          : {
              completedAt: new Date(),
              violationCode: preflightViolation.code,
              violationMessage: preflightViolation.message,
              resultPayload: {
                reason: preflightViolation.code,
                warning: preflightViolation.message,
                exitCode: null,
                stdout: null,
                stderr: null,
                content: null
              }
            })
      }
    });
    if (preflightViolation === null) {
      void this.executeQueuedJob(created.id, request).catch((error) => {
        this.logger.error(`Sandbox job ${created.id} crashed: ${String(error)}`);
      });
    }
    return this.pollJob(created.id);
  }

  async pollJob(jobId: string): Promise<RuntimeSandboxJobResult> {
    const job = await this.prisma.sandboxJob.findUnique({
      where: { id: jobId },
      include: { fileRefs: true }
    });
    if (job === null) {
      return {
        jobId,
        status: "failed",
        toolCode: "unknown",
        reason: "job_not_found",
        warning: "Sandbox job not found.",
        violationCode: "job_not_found",
        violationMessage: "Sandbox job not found.",
        exitCode: null,
        stdout: null,
        stderr: null,
        content: null,
        files: []
      };
    }
    const payload =
      job.resultPayload !== null &&
      typeof job.resultPayload === "object" &&
      !Array.isArray(job.resultPayload)
        ? (job.resultPayload as Record<string, unknown>)
        : {};
    return {
      jobId: job.id,
      status: job.status,
      toolCode: job.toolCode,
      reason: this.readNullableString(payload.reason) ?? null,
      warning: this.readNullableString(payload.warning) ?? null,
      violationCode: job.violationCode,
      violationMessage: job.violationMessage,
      exitCode: this.readNullableNumber(payload.exitCode),
      stdout: this.readNullableString(payload.stdout),
      stderr: this.readNullableString(payload.stderr),
      content: this.readNullableString(payload.content),
      files: job.fileRefs.map((fileRef) => ({
        relativePath: fileRef.relativePath,
        displayName: fileRef.displayName,
        mimeType: fileRef.mimeType,
        sizeBytes: Number(fileRef.sizeBytes),
        logicalSizeBytes:
          fileRef.logicalSizeBytes === null ? null : Number(fileRef.logicalSizeBytes),
        fileRef: {
          fileRef: fileRef.id,
          origin: fileRef.origin,
          sourceToolCode: fileRef.sourceToolCode,
          objectKey: fileRef.objectKey,
          relativePath: fileRef.relativePath,
          displayName: fileRef.displayName,
          mimeType: fileRef.mimeType,
          sizeBytes: Number(fileRef.sizeBytes),
          logicalSizeBytes:
            fileRef.logicalSizeBytes === null ? null : Number(fileRef.logicalSizeBytes)
        }
      }))
    };
  }

  async ready(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }

  private async resolvePreflightViolation(
    request: RuntimeSandboxJobRequest
  ): Promise<{ code: string; message: string } | null> {
    if (request.policy.sandboxJobsPerDay !== null) {
      const startOfDay = this.startOfUtcDay(new Date());
      const jobsToday = await this.prisma.sandboxJob.count({
        where: {
          assistantId: request.assistantId,
          workspaceId: request.workspaceId,
          createdAt: {
            gte: startOfDay
          }
        }
      });
      if (jobsToday >= request.policy.sandboxJobsPerDay) {
        return {
          code: "sandbox_daily_job_limit_reached",
          message: `Sandbox job quota reached for today (${String(
            request.policy.sandboxJobsPerDay
          )} jobs).`
        };
      }
    }
    return null;
  }

  private async executeQueuedJob(jobId: string, request: RuntimeSandboxJobRequest): Promise<void> {
    const startedAt = new Date();
    await this.prisma.sandboxJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        startedAt
      }
    });
    const workspaceRoot = join(tmpdir(), "persai-sandbox", jobId, "workspace");
    try {
      await fs.rm(dirname(workspaceRoot), { recursive: true, force: true });
      await fs.mkdir(workspaceRoot, { recursive: true });
      const mountedFiles = await this.materializeMountedFiles(workspaceRoot, request.args);

      const result = await this.executeTool({
        workspaceRoot,
        request,
        jobId,
        mountedFiles
      });

      const stats = await this.computeWorkspaceStats(workspaceRoot);
      this.assertWorkspaceStats(stats, request.policy);

      const files = await this.collectWorkspaceFiles(workspaceRoot);
      const producedFiles = this.selectProducedWorkspaceFiles(files, mountedFiles);
      if (producedFiles.length > request.policy.maxPersistedArtifactsPerJob) {
        this.throwPolicy(
          "artifact_count_limit_exceeded",
          `Sandbox job created ${String(producedFiles.length)} file(s), above the per-job artifact limit of ${String(
            request.policy.maxPersistedArtifactsPerJob
          )}.`
        );
      }
      const persistedFiles = await this.persistWorkspaceFiles({
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        toolCode: request.toolCode,
        jobId,
        files: producedFiles
      });
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          resultPayload: {
            reason: result.reason,
            warning: result.warning,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            content: result.content
          },
          resourceUsage: {
            workspaceBytes: stats.totalBytes,
            fileCount: stats.fileCount,
            directoryCount: stats.directoryCount,
            stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
            stderrBytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
            peakProcessCount: result.peakProcessCount ?? null,
            peakCpuMs: result.peakCpuMs ?? null,
            peakMemoryBytes: result.peakMemoryBytes ?? null,
            processDurationMs: result.durationMs ?? null
          }
        }
      });
      if (persistedFiles.length !== files.length) {
        this.logger.warn(
          `Sandbox job ${jobId} persisted ${String(persistedFiles.length)} of ${String(files.length)} files.`
        );
      }
    } catch (error) {
      const { code, message, blocked, resourceUsage } = this.normalizeSandboxError(error);
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: blocked ? "blocked" : "failed",
          completedAt: new Date(),
          violationCode: code,
          violationMessage: message,
          resultPayload: {
            reason: code,
            warning: message,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          },
          ...(resourceUsage === null ? {} : { resourceUsage: this.toJsonValue(resourceUsage) })
        }
      });
    } finally {
      await fs.rm(dirname(workspaceRoot), { recursive: true, force: true });
    }
  }

  private async executeTool(input: {
    workspaceRoot: string;
    request: RuntimeSandboxJobRequest;
    jobId: string;
    mountedFiles: MountedWorkspaceState;
  }): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
    durationMs?: number;
    peakProcessCount?: number;
    peakCpuMs?: number;
    peakMemoryBytes?: number;
  }> {
    switch (input.request.toolCode) {
      case "read_file":
        return this.executeReadFile(input.workspaceRoot, input.request.args, input.mountedFiles);
      case "write_file":
        return this.executeWriteFile(input.workspaceRoot, input.request.args, input.request.policy);
      case "edit_file":
        return this.executeEditFile(input.workspaceRoot, input.request.args, input.request.policy);
      case "exec":
        return this.executeExecLike(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          false
        );
      case "shell":
        return this.executeExecLike(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          true
        );
      default:
        this.throwPolicy(
          "tool_not_supported",
          `Unsupported sandbox tool "${input.request.toolCode}".`
        );
    }
  }

  private async executeReadFile(
    workspaceRoot: string,
    args: Record<string, unknown>,
    mountedFiles: MountedWorkspaceState
  ): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
  }> {
    const relativePath = this.resolveReadablePath(args, mountedFiles);
    const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
    const buffer = await fs.readFile(absolutePath);
    return {
      reason: null,
      warning: null,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: buffer.toString("utf8")
    };
  }

  private async executeWriteFile(
    workspaceRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy
  ) {
    const relativePath = this.requireRelativePath(args.path, "path");
    const content = this.requireString(args.content, "content");
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > policy.maxSingleFileWriteBytes) {
      this.throwPolicy(
        "single_file_write_limit_exceeded",
        `Requested write is ${String(sizeBytes)} bytes, above the per-file limit of ${String(
          policy.maxSingleFileWriteBytes
        )}.`
      );
    }
    const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
    return {
      reason: null,
      warning: null,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: null
    };
  }

  private async executeEditFile(
    workspaceRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy
  ) {
    const relativePath = this.requireRelativePath(args.path, "path");
    const oldText = this.requireString(args.oldText, "oldText");
    const newText = this.requireString(args.newText, "newText");
    const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
    const existing = await fs.readFile(absolutePath, "utf8");
    if (!existing.includes(oldText)) {
      this.throwPolicy("edit_target_not_found", "The requested text to replace was not found.");
    }
    const next = existing.replace(oldText, newText);
    const sizeBytes = Buffer.byteLength(next, "utf8");
    if (sizeBytes > policy.maxSingleFileWriteBytes) {
      this.throwPolicy(
        "single_file_write_limit_exceeded",
        `Edited file would be ${String(sizeBytes)} bytes, above the per-file limit of ${String(
          policy.maxSingleFileWriteBytes
        )}.`
      );
    }
    await fs.writeFile(absolutePath, next, "utf8");
    return {
      reason: null,
      warning: null,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: null
    };
  }

  private async executeExecLike(
    workspaceRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    shellMode: boolean
  ) {
    const cwd = args.cwd === undefined ? "." : this.requireRelativePath(args.cwd, "cwd");
    const absoluteCwd = this.resolveWorkspacePath(workspaceRoot, cwd);
    await fs.mkdir(absoluteCwd, { recursive: true });

    if (shellMode) {
      const command = this.requireString(args.command, "command");
      this.assertNetworkPolicy(command, policy);
      const result = await this.runProcess({
        workspaceRoot,
        policy,
        cwd: absoluteCwd,
        command: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
        args: process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command]
      });
      return {
        reason: result.exitCode === 0 ? null : "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null
      };
    }

    const command = this.requireString(args.command, "command");
    this.assertNetworkPolicy(command, policy);
    const childArgs = Array.isArray(args.args)
      ? args.args.filter((item): item is string => typeof item === "string")
      : [];
    const result = await this.runProcess({
      workspaceRoot,
      policy,
      cwd: absoluteCwd,
      command,
      args: childArgs
    });
    return {
      reason: result.exitCode === 0 ? null : "process_failed",
      warning: null,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      content: null
    };
  }

  private async runProcess(input: {
    workspaceRoot: string;
    policy: RuntimeSandboxPolicy;
    cwd: string;
    command: string;
    args: string[];
  }): Promise<ProcessResult> {
    const startedAt = Date.now();
    return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const rootPid = child.pid;
      if (typeof rootPid !== "number" || !Number.isInteger(rootPid) || rootPid <= 0) {
        rejectPromise(
          this.createPolicyError(
            "process_spawn_failed",
            "Sandbox process failed to expose a valid pid."
          )
        );
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      let monitoring = false;
      let peakProcessCount = 1;
      let peakCpuMs = 0;
      let peakMemoryBytes = 0;
      const buildProcessUsageSnapshot = (): Record<string, unknown> => ({
        peakProcessCount,
        peakCpuMs,
        peakMemoryBytes
      });
      const cleanup = (): void => {
        clearTimeout(timer);
        clearInterval(interval);
      };
      const rejectWithPolicy = (error: unknown): void => {
        cleanup();
        if (settled) {
          return;
        }
        settled = true;
        void this.terminateProcessTree(rootPid);
        rejectPromise(error);
      };
      const resolveWithResult = (exitCode: number | null): void => {
        cleanup();
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          peakProcessCount,
          peakCpuMs,
          peakMemoryBytes
        });
      };
      const timer = setTimeout(() => {
        rejectWithPolicy(
          this.createPolicyError(
            "process_timeout",
            `Sandbox process exceeded ${String(input.policy.maxProcessRuntimeMs)}ms.`,
            {
              resourceUsage: buildProcessUsageSnapshot()
            }
          )
        );
      }, input.policy.maxProcessRuntimeMs);
      const interval = setInterval(() => {
        if (settled || monitoring) {
          return;
        }
        monitoring = true;
        void (async () => {
          try {
            const stats = await this.computeWorkspaceStats(input.workspaceRoot);
            this.assertWorkspaceStats(stats, input.policy);
            const usage = await this.readProcessTreeUsage(rootPid);
            if (usage !== null) {
              peakProcessCount = Math.max(peakProcessCount, usage.processCount);
              peakCpuMs = Math.max(peakCpuMs, usage.totalCpuMs);
              peakMemoryBytes = Math.max(peakMemoryBytes, usage.totalMemoryBytes);
              this.assertProcessUsage(usage, input.policy);
            }
          } catch (error) {
            rejectWithPolicy(error);
          } finally {
            monitoring = false;
          }
        })();
      }, 250);
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, "utf8") > input.policy.maxStdoutBytes && !settled) {
          rejectWithPolicy(
            this.createPolicyError(
              "stdout_limit_exceeded",
              `Sandbox stdout exceeded ${String(input.policy.maxStdoutBytes)} bytes.`,
              {
                resourceUsage: buildProcessUsageSnapshot()
              }
            )
          );
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
        if (Buffer.byteLength(stderr, "utf8") > input.policy.maxStderrBytes && !settled) {
          rejectWithPolicy(
            this.createPolicyError(
              "stderr_limit_exceeded",
              `Sandbox stderr exceeded ${String(input.policy.maxStderrBytes)} bytes.`,
              {
                resourceUsage: buildProcessUsageSnapshot()
              }
            )
          );
        }
      });
      child.on("error", (error) => {
        rejectWithPolicy(
          this.createPolicyError(
            "process_spawn_failed",
            `Sandbox process failed: ${error.message}`,
            {
              resourceUsage: buildProcessUsageSnapshot()
            }
          )
        );
      });
      child.on("close", (exitCode) => {
        resolveWithResult(exitCode);
      });
    });
  }

  private assertProcessUsage(usage: ProcessTreeUsage, policy: RuntimeSandboxPolicy): void {
    if (usage.processCount > policy.maxConcurrentProcesses) {
      this.throwPolicy(
        "process_count_limit_exceeded",
        `Sandbox process tree reached ${String(usage.processCount)} concurrent processes, above the limit of ${String(
          policy.maxConcurrentProcesses
        )}.`,
        {
          resourceUsage: {
            peakProcessCount: usage.processCount,
            peakCpuMs: usage.totalCpuMs,
            peakMemoryBytes: usage.totalMemoryBytes
          }
        }
      );
    }
    if (usage.totalCpuMs > policy.maxCpuMsPerJob) {
      this.throwPolicy(
        "process_cpu_limit_exceeded",
        `Sandbox process tree used ${String(usage.totalCpuMs)}ms of CPU time, above the limit of ${String(
          policy.maxCpuMsPerJob
        )}ms.`,
        {
          resourceUsage: {
            peakProcessCount: usage.processCount,
            peakCpuMs: usage.totalCpuMs,
            peakMemoryBytes: usage.totalMemoryBytes
          }
        }
      );
    }
    if (usage.totalMemoryBytes > policy.maxMemoryBytesPerJob) {
      this.throwPolicy(
        "process_memory_limit_exceeded",
        `Sandbox process tree used ${String(
          usage.totalMemoryBytes
        )} bytes of memory, above the limit of ${String(policy.maxMemoryBytesPerJob)} bytes.`,
        {
          resourceUsage: {
            peakProcessCount: usage.processCount,
            peakCpuMs: usage.totalCpuMs,
            peakMemoryBytes: usage.totalMemoryBytes
          }
        }
      );
    }
  }

  private async readProcessTreeUsage(rootPid: number): Promise<ProcessTreeUsage | null> {
    const snapshots = await this.listProcessSnapshots();
    if (!snapshots.some((snapshot) => snapshot.pid === rootPid)) {
      return null;
    }
    const childrenByParent = new Map<number, ProcessSnapshot[]>();
    for (const snapshot of snapshots) {
      if (snapshot.ppid === null) {
        continue;
      }
      const siblings = childrenByParent.get(snapshot.ppid) ?? [];
      siblings.push(snapshot);
      childrenByParent.set(snapshot.ppid, siblings);
    }
    const snapshotByPid = new Map(snapshots.map((snapshot) => [snapshot.pid, snapshot] as const));
    const seen = new Set<number>();
    const pids: number[] = [];
    let totalCpuMs = 0;
    let totalMemoryBytes = 0;
    const stack = [rootPid];
    while (stack.length > 0) {
      const currentPid = stack.pop();
      if (currentPid === undefined || seen.has(currentPid)) {
        continue;
      }
      seen.add(currentPid);
      const snapshot = snapshotByPid.get(currentPid);
      if (snapshot === undefined) {
        continue;
      }
      pids.push(currentPid);
      totalCpuMs += snapshot.cpuMs;
      totalMemoryBytes += snapshot.memoryBytes;
      for (const child of childrenByParent.get(currentPid) ?? []) {
        stack.push(child.pid);
      }
    }
    return {
      pids,
      processCount: pids.length,
      totalCpuMs,
      totalMemoryBytes
    };
  }

  private async listProcessSnapshots(): Promise<ProcessSnapshot[]> {
    if (process.platform === "win32") {
      return this.listWindowsProcessSnapshots();
    }
    return this.listPosixProcessSnapshots();
  }

  private async listWindowsProcessSnapshots(): Promise<ProcessSnapshot[]> {
    const output = await this.captureCommandOutput("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress"
    ]);
    const normalized = output.trim();
    if (normalized.length === 0) {
      return [];
    }
    const parsed = JSON.parse(normalized) as unknown;
    const rows = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => {
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
          return null;
        }
        const typed = row as Record<string, unknown>;
        const pid = this.readNullableNumber(typed.ProcessId);
        if (pid === null) {
          return null;
        }
        const kernelTime = this.readNullableNumber(typed.KernelModeTime) ?? 0;
        const userTime = this.readNullableNumber(typed.UserModeTime) ?? 0;
        return {
          pid,
          ppid: this.readNullableNumber(typed.ParentProcessId),
          cpuMs: Math.round((kernelTime + userTime) / 10_000),
          memoryBytes: this.readNullableNumber(typed.WorkingSetSize) ?? 0
        } satisfies ProcessSnapshot;
      })
      .filter((row): row is ProcessSnapshot => row !== null);
  }

  private async listPosixProcessSnapshots(): Promise<ProcessSnapshot[]> {
    const output = await this.captureCommandOutput("ps", ["-axo", "pid=,ppid=,rss=,time="]);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map<ProcessSnapshot | null>((line) => {
        const columns = line.split(/\s+/, 4);
        if (columns.length !== 4) {
          return null;
        }
        const [pidRaw, ppidRaw, rssKbRaw, cpuRaw] = columns as [string, string, string, string];
        const pid = Number.parseInt(pidRaw, 10);
        const ppid = Number.parseInt(ppidRaw, 10);
        const rssKb = Number.parseInt(rssKbRaw, 10);
        if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(rssKb)) {
          return null;
        }
        return {
          pid,
          ppid: ppid as number | null,
          cpuMs: this.parsePosixCpuTimeToMs(cpuRaw),
          memoryBytes: rssKb * 1024
        } satisfies ProcessSnapshot;
      })
      .filter((row): row is ProcessSnapshot => row !== null);
  }

  private parsePosixCpuTimeToMs(raw: string): number {
    const normalized = raw.trim();
    if (normalized.length === 0) {
      return 0;
    }
    const split = normalized.includes("-") ? normalized.split("-", 2) : ["0", normalized];
    const daysRaw = split[0] ?? "0";
    const timeRaw = split[1] ?? normalized;
    const days = Number.parseFloat(daysRaw);
    const segments = timeRaw.split(":").map((segment) => Number.parseFloat(segment));
    if (Number.isNaN(days) || segments.some((segment) => Number.isNaN(segment))) {
      return 0;
    }
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (segments.length === 3) {
      hours = segments[0] ?? 0;
      minutes = segments[1] ?? 0;
      seconds = segments[2] ?? 0;
    } else if (segments.length === 2) {
      minutes = segments[0] ?? 0;
      seconds = segments[1] ?? 0;
    } else if (segments.length === 1) {
      seconds = segments[0] ?? 0;
    } else {
      return 0;
    }
    const totalSeconds = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
    return Math.round(totalSeconds);
  }

  private async terminateProcessTree(rootPid: number): Promise<void> {
    if (process.platform === "win32") {
      try {
        await this.captureCommandOutput("taskkill", ["/PID", String(rootPid), "/T", "/F"]);
      } catch {
        // Ignore tree-kill failures when the process has already exited.
      }
      return;
    }
    const usage = await this.readProcessTreeUsage(rootPid);
    for (const pid of [...new Set(usage?.pids ?? [rootPid])].sort((left, right) => right - left)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore missing processes during teardown.
      }
    }
  }

  private async captureCommandOutput(command: string, args: string[]): Promise<string> {
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        rejectPromise(error);
      });
      child.on("close", (exitCode) => {
        if (exitCode === 0) {
          resolvePromise(stdout);
          return;
        }
        rejectPromise(
          new Error(
            stderr.trim().length > 0
              ? stderr.trim()
              : `Command "${command}" exited with code ${String(exitCode)}.`
          )
        );
      });
    });
  }

  private async materializeMountedFiles(
    workspaceRoot: string,
    args: Record<string, unknown>
  ): Promise<MountedWorkspaceState> {
    const mountedFiles: MountedWorkspaceState = {
      byRef: new Map(),
      byPath: new Map()
    };
    const mountRefs = new Set<string>();
    const singleRef = this.readNullableString(args.fileRef);
    if (singleRef) {
      mountRefs.add(singleRef);
    }
    if (Array.isArray(args.mountFileRefs)) {
      for (const item of args.mountFileRefs) {
        if (typeof item === "string" && item.trim().length > 0) {
          mountRefs.add(item.trim());
        }
      }
    }
    if (mountRefs.size === 0) {
      return mountedFiles;
    }
    const refs = await this.prisma.sandboxFileRef.findMany({
      where: {
        id: {
          in: [...mountRefs]
        }
      }
    });
    if (refs.length !== mountRefs.size) {
      this.throwPolicy("file_ref_not_found", "One or more sandbox file references were not found.");
    }
    for (const ref of refs) {
      const relativePath = this.requireRelativePath(ref.relativePath, "relativePath");
      if (mountedFiles.byPath.has(relativePath)) {
        this.throwPolicy(
          "mounted_path_conflict",
          `Mounted file references cannot share the same workspace path "${relativePath}".`
        );
      }
      const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
      await fs.mkdir(dirname(absolutePath), { recursive: true });
      const buffer = await this.objectStorage.downloadObject(ref.objectKey);
      await fs.writeFile(absolutePath, buffer);
      const mounted: MountedFileSnapshot = {
        fileRef: ref.id,
        relativePath,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        sizeBytes: buffer.length,
        logicalSizeBytes: buffer.length
      };
      mountedFiles.byRef.set(ref.id, mounted);
      mountedFiles.byPath.set(relativePath, mounted);
    }
    return mountedFiles;
  }

  private async persistWorkspaceFiles(input: {
    assistantId: string;
    workspaceId: string;
    toolCode: string;
    jobId: string;
    files: WorkspaceFileSnapshot[];
  }): Promise<RuntimeSandboxProducedFile[]> {
    const produced: RuntimeSandboxProducedFile[] = [];
    for (const file of input.files) {
      const objectKey = this.objectStorage.buildSandboxObjectKey({
        assistantId: input.assistantId,
        jobId: input.jobId,
        relativePath: file.relativePath
      });
      await this.objectStorage.saveObject({
        objectKey,
        buffer: file.buffer,
        mimeType: file.mimeType
      });
      const created = await this.prisma.sandboxFileRef.create({
        data: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sandboxJobId: input.jobId,
          origin: "sandbox_output",
          sourceToolCode: input.toolCode,
          objectKey,
          relativePath: file.relativePath,
          displayName: basename(file.relativePath),
          mimeType: file.mimeType,
          sizeBytes: BigInt(file.sizeBytes),
          logicalSizeBytes: file.logicalSizeBytes === null ? null : BigInt(file.logicalSizeBytes),
          sha256: file.sha256,
          metadata: {}
        }
      });
      const runtimeFileRef: RuntimeFileRef = {
        fileRef: created.id,
        origin: created.origin,
        sourceToolCode: created.sourceToolCode,
        objectKey: created.objectKey,
        relativePath: created.relativePath,
        displayName: created.displayName,
        mimeType: created.mimeType,
        sizeBytes: Number(created.sizeBytes),
        logicalSizeBytes:
          created.logicalSizeBytes === null ? null : Number(created.logicalSizeBytes)
      };
      produced.push({
        relativePath: created.relativePath,
        displayName: created.displayName,
        mimeType: created.mimeType,
        sizeBytes: Number(created.sizeBytes),
        logicalSizeBytes:
          created.logicalSizeBytes === null ? null : Number(created.logicalSizeBytes),
        fileRef: runtimeFileRef
      });
    }
    return produced;
  }

  private async collectWorkspaceFiles(workspaceRoot: string): Promise<WorkspaceFileSnapshot[]> {
    const output: WorkspaceFileSnapshot[] = [];
    const visit = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath);
          continue;
        }
        const buffer = await fs.readFile(absolutePath);
        const relativePath = absolutePath.slice(workspaceRoot.length + 1).replace(/\\/g, "/");
        output.push({
          relativePath,
          absolutePath,
          buffer,
          mimeType: this.inferMimeType(relativePath),
          sizeBytes: buffer.length,
          logicalSizeBytes: buffer.length,
          sha256: createHash("sha256").update(buffer).digest("hex")
        });
      }
    };
    await visit(workspaceRoot);
    return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private selectProducedWorkspaceFiles(
    files: WorkspaceFileSnapshot[],
    mountedFiles: MountedWorkspaceState
  ): WorkspaceFileSnapshot[] {
    if (mountedFiles.byPath.size === 0) {
      return files;
    }
    return files.filter((file) => {
      const mounted = mountedFiles.byPath.get(file.relativePath);
      if (!mounted) {
        return true;
      }
      return file.sha256 !== mounted.sha256 || file.sizeBytes !== mounted.sizeBytes;
    });
  }

  private async computeWorkspaceStats(workspaceRoot: string): Promise<WorkspaceStats> {
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    const visit = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          directoryCount++;
          await visit(absolutePath);
          continue;
        }
        const stat = await fs.stat(absolutePath);
        fileCount++;
        totalBytes += stat.size;
      }
    };
    await visit(workspaceRoot);
    return { fileCount, directoryCount, totalBytes };
  }

  private assertWorkspaceStats(stats: WorkspaceStats, policy: RuntimeSandboxPolicy): void {
    if (stats.fileCount > policy.maxFileCountPerJob) {
      this.throwPolicy(
        "file_count_limit_exceeded",
        `Sandbox job created ${String(stats.fileCount)} files, above the limit of ${String(
          policy.maxFileCountPerJob
        )}.`
      );
    }
    if (stats.directoryCount > policy.maxDirectoryCountPerJob) {
      this.throwPolicy(
        "directory_count_limit_exceeded",
        `Sandbox job created ${String(stats.directoryCount)} directories, above the limit of ${String(
          policy.maxDirectoryCountPerJob
        )}.`
      );
    }
    if (stats.totalBytes > policy.maxWorkspaceBytesPerJob) {
      this.throwPolicy(
        "workspace_size_limit_exceeded",
        `Sandbox workspace reached ${String(stats.totalBytes)} bytes, above the limit of ${String(
          policy.maxWorkspaceBytesPerJob
        )}.`
      );
    }
  }

  private resolveReadablePath(
    args: Record<string, unknown>,
    mountedFiles: MountedWorkspaceState
  ): string {
    if (typeof args.path === "string" && args.path.trim().length > 0) {
      return this.requireRelativePath(args.path, "path");
    }
    if (typeof args.fileRef === "string" && args.fileRef.trim().length > 0) {
      const mounted = mountedFiles.byRef.get(args.fileRef.trim());
      if (mounted !== undefined) {
        return mounted.relativePath;
      }
      throw this.createPolicyError(
        "file_ref_not_found",
        "The requested fileRef could not be mounted."
      );
    }
    throw this.createPolicyError("path_required", "path is required.");
  }

  private resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.length === 0 || normalized.includes("..")) {
      this.throwPolicy("invalid_path", "Sandbox paths must stay inside the workspace root.");
    }
    if (isAbsolute(normalized)) {
      this.throwPolicy("invalid_path", "Absolute paths are not allowed inside sandbox jobs.");
    }
    const absolutePath = resolve(workspaceRoot, normalized);
    if (!absolutePath.startsWith(resolve(workspaceRoot))) {
      this.throwPolicy("invalid_path", "Sandbox paths must stay inside the workspace root.");
    }
    return absolutePath;
  }

  private requireRelativePath(value: unknown, fieldName: string): string {
    const raw = this.requireString(value, fieldName);
    return raw.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  private requireString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw this.createPolicyError("invalid_arguments", `${fieldName} must be a non-empty string.`);
    }
    return value;
  }

  private assertNetworkPolicy(command: string, policy: RuntimeSandboxPolicy): void {
    if (policy.networkAccessEnabled) {
      return;
    }
    const lowered = command.toLowerCase();
    if (
      lowered.includes("curl ") ||
      lowered.includes("wget ") ||
      lowered.includes("invoke-webrequest") ||
      lowered.includes("http://") ||
      lowered.includes("https://") ||
      lowered.includes("npm install") ||
      lowered.includes("pnpm add") ||
      lowered.includes("pip install")
    ) {
      this.throwPolicy("network_blocked", "Sandbox network access is disabled by policy.");
    }
  }

  private inferMimeType(relativePath: string): string {
    const extension = extname(relativePath).toLowerCase();
    switch (extension) {
      case ".txt":
      case ".md":
      case ".ts":
      case ".tsx":
      case ".js":
      case ".jsx":
      case ".json":
      case ".py":
      case ".java":
      case ".cpp":
      case ".c":
      case ".h":
      case ".css":
      case ".html":
      case ".xml":
      case ".yml":
      case ".yaml":
      case ".rs":
      case ".go":
      case ".sh":
      case ".ps1":
        return "text/plain";
      case ".pdf":
        return "application/pdf";
      case ".zip":
        return "application/zip";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".mp3":
        return "audio/mpeg";
      case ".ogg":
        return "audio/ogg";
      case ".mp4":
        return "video/mp4";
      default:
        return "application/octet-stream";
    }
  }

  private normalizeSandboxError(error: unknown): {
    code: string;
    message: string;
    blocked: boolean;
    resourceUsage: Record<string, unknown> | null;
  } {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      const typed = error as {
        code: string;
        message: string;
        blocked?: unknown;
        resourceUsage?: unknown;
      };
      const resourceUsage =
        typed.resourceUsage !== null &&
        typeof typed.resourceUsage === "object" &&
        !Array.isArray(typed.resourceUsage)
          ? (typed.resourceUsage as Record<string, unknown>)
          : null;
      return {
        code: typed.code,
        message: typed.message,
        blocked: typed.blocked === true,
        resourceUsage
      };
    }
    return {
      code: "sandbox_failed",
      message: error instanceof Error ? error.message : String(error),
      blocked: false,
      resourceUsage: null
    };
  }

  private createPolicyError(
    code: string,
    message: string,
    options?: { resourceUsage?: Record<string, unknown> }
  ): SandboxPolicyError {
    const error = new Error(message) as SandboxPolicyError;
    error.code = code;
    error.blocked = true;
    if (options?.resourceUsage !== undefined) {
      error.resourceUsage = options.resourceUsage;
    }
    return error;
  }

  private throwPolicy(
    code: string,
    message: string,
    options?: { resourceUsage?: Record<string, unknown> }
  ): never {
    throw this.createPolicyError(code, message, options);
  }

  private readNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private readNullableNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}
