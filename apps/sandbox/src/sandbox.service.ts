import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, dirname, extname, basename, isAbsolute, resolve } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import type {
  RuntimeFileRef,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeSandboxPolicy,
  RuntimeSandboxProducedFile
} from "@persai/runtime-contract";
import { Prisma } from "@prisma/client";
import { SANDBOX_CONFIG } from "./sandbox-config";
import { ExecPodBridgeService } from "./exec-pod-bridge.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
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

const EMPTY_WORKSPACE_STATS: WorkspaceStats = {
  fileCount: 0,
  directoryCount: 0,
  totalBytes: 0
};

type AssistantWorkspaceFileRecord = {
  id: string;
  sandboxJobId: string | null;
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: bigint;
  logicalSizeBytes: bigint | null;
  sha256: string | null;
  metadata: Prisma.JsonValue | null;
  updatedAt: Date;
};

type WorkspaceLeaseHandle = {
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string;
  leaseToken: string;
  holderId: string;
  expiresAt: Date;
};

type WorkspaceLeaseGuard = {
  handle: WorkspaceLeaseHandle;
  active: boolean;
  renewalError: Error | null;
  heartbeatTimer: NodeJS.Timeout | null;
  renewing: boolean;
};

type SandboxFilesAction = "read" | "write" | "edit" | "delete";

type SandboxPolicyError = Error & {
  code: string;
  blocked: boolean;
  resourceUsage?: Record<string, unknown>;
};

const WORKSPACE_LEASE_TTL_MS = 30_000;
const WORKSPACE_LEASE_RENEW_INTERVAL_MS = 5_000;
const WORKSPACE_LEASE_ACQUIRE_RETRY_MS = 200;
const WORKSPACE_LEASE_WAIT_TIMEOUT_MS = 15_000;
const PENDING_SANDBOX_JOB_STATUSES = ["queued", "running"] as const;

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  private readonly workspaceExecutionQueues = new Map<string, Promise<void>>();
  private readonly sandboxInstanceHolderId = `${hostname()}:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly prisma: SandboxPrismaService,
    private readonly objectStorage: SandboxObjectStorageService,
    private readonly sandboxObservabilityService: SandboxObservabilityService,
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig,
    private readonly execPodBridgeService: ExecPodBridgeService
  ) {}

  /**
   * Postgres rejects U+0000 in `text` / JSON string fields (error `22P05`:
   * `unsupported Unicode escape sequence`, `\u0000 cannot be converted to text`).
   * Strip embedded NUL bytes from any user-derived or process-output string before
   * persisting sandbox job rows or returning file-read content to the model.
   */
  private stripNulCharacters(value: string): string {
    if (!value.includes("\0")) {
      return value;
    }
    return value.split("\u0000").join("");
  }

  private stripNulCharactersNullable(value: string | null): string | null {
    return value === null ? null : this.stripNulCharacters(value);
  }

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
              violationMessage: this.stripNulCharacters(preflightViolation.message),
              resultPayload: {
                reason: preflightViolation.code,
                warning: this.stripNulCharacters(preflightViolation.message),
                exitCode: null,
                stdout: null,
                stderr: null,
                content: null
              }
            })
      }
    });
    this.sandboxObservabilityService.recordSubmittedJob();
    if (preflightViolation === null) {
      void this.enqueueWorkspaceJob(
        this.buildWorkspaceSessionKey(request.assistantId, request.workspaceId),
        () => this.executeQueuedJob(created.id, request)
      ).catch((error) => {
        this.logger.error(`Sandbox job ${created.id} crashed: ${String(error)}`);
      });
    }
    return this.pollJob(created.id);
  }

  async pollJob(jobId: string, waitMs = 0): Promise<RuntimeSandboxJobResult> {
    const startedAtMs = waitMs > 0 ? Date.now() : 0;
    const deadlineMs =
      waitMs > 0 ? Date.now() + Math.min(waitMs, this.config.SANDBOX_MAX_POLL_WAIT_MS) : null;
    let job = await this.findJobRecord(jobId);
    job = await this.failStaleJobIfNeeded(job);
    while (
      job !== null &&
      !this.isTerminalJobStatus(job.status) &&
      deadlineMs !== null &&
      Date.now() < deadlineMs
    ) {
      const remainingWaitMs = deadlineMs - Date.now();
      if (remainingWaitMs <= 0) {
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(WORKSPACE_LEASE_ACQUIRE_RETRY_MS, remainingWaitMs))
      );
      job = await this.findJobRecord(jobId);
      job = await this.failStaleJobIfNeeded(job);
    }
    if (waitMs > 0) {
      this.sandboxObservabilityService.recordLongPoll(Date.now() - startedAtMs);
    }
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
    const assistantFiles = job.assistantFiles ?? [];
    const producedFiles = assistantFiles.map((file) => this.toProducedFile(file));
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
      files: producedFiles
    };
  }

  async ready(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }

  private async findJobRecord(jobId: string) {
    return await this.prisma.sandboxJob.findUnique({
      where: { id: jobId },
      include: { assistantFiles: true }
    });
  }

  private isTerminalJobStatus(status: RuntimeSandboxJobResult["status"]): boolean {
    return (
      status === "completed" ||
      status === "failed" ||
      status === "blocked" ||
      status === "cancelled"
    );
  }

  private async failStaleJobIfNeeded<
    T extends {
      id: string;
      status: RuntimeSandboxJobResult["status"];
      toolCode: string;
      policySnapshot: Prisma.JsonValue | null;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
    } | null
  >(job: T): Promise<T> {
    if (job === null || this.isTerminalJobStatus(job.status)) {
      return job;
    }
    const policy = this.parsePolicySnapshot(job.policySnapshot);
    if (job.status === "queued") {
      const queuedForMs = Date.now() - job.createdAt.getTime();
      if (queuedForMs <= this.config.SANDBOX_QUEUED_JOB_STALE_AFTER_MS) {
        return job;
      }
      const message = `Sandbox job stayed queued for ${String(queuedForMs)}ms, exceeding the ${String(this.config.SANDBOX_QUEUED_JOB_STALE_AFTER_MS)}ms stale threshold.`;
      const updated = await this.failStaleJob(job, "sandbox_queue_timeout", message);
      return updated as T;
    }
    const startedAtMs = job.startedAt?.getTime() ?? job.createdAt.getTime();
    const runningForMs = Date.now() - startedAtMs;
    const maxRunningMs =
      (policy?.maxProcessRuntimeMs ?? WORKSPACE_LEASE_WAIT_TIMEOUT_MS) +
      this.config.SANDBOX_RUNNING_JOB_GRACE_MS;
    if (runningForMs <= maxRunningMs) {
      return job;
    }
    const message = `Sandbox job kept running for ${String(runningForMs)}ms, exceeding the ${String(maxRunningMs)}ms stale threshold.`;
    const updated = await this.failStaleJob(job, "sandbox_execution_timeout", message);
    return updated as T;
  }

  private async failStaleJob(
    job: {
      id: string;
      status: RuntimeSandboxJobResult["status"];
      toolCode: string;
    },
    reason: string,
    message: string
  ) {
    const safeMessage = this.stripNulCharacters(message);
    const updated = await this.prisma.sandboxJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        completedAt: null
      },
      data: {
        status: "failed",
        completedAt: new Date(),
        violationCode: reason,
        violationMessage: safeMessage,
        resultPayload: {
          reason,
          warning: safeMessage,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null
        }
      }
    });
    if (updated.count === 0) {
      return await this.findJobRecord(job.id);
    }
    this.sandboxObservabilityService.recordStaleFailure(
      job.status === "running" ? "running" : "queued"
    );
    this.logger.warn(
      `[sandbox-stale-job] jobId=${job.id} tool=${job.toolCode} status=${job.status} reason=${reason}`
    );
    return await this.findJobRecord(job.id);
  }

  private parsePolicySnapshot(
    policySnapshot: Prisma.JsonValue | null
  ): RuntimeSandboxPolicy | null {
    if (
      policySnapshot === null ||
      typeof policySnapshot !== "object" ||
      Array.isArray(policySnapshot)
    ) {
      return null;
    }
    const candidate = policySnapshot as Partial<RuntimeSandboxPolicy>;
    if (
      typeof candidate.enabled !== "boolean" ||
      typeof candidate.maxProcessRuntimeMs !== "number"
    ) {
      return null;
    }
    return candidate as RuntimeSandboxPolicy;
  }

  private async resolvePreflightViolation(
    request: RuntimeSandboxJobRequest
  ): Promise<{ code: string; message: string } | null> {
    const [pendingJobs, workspacePendingJobs] = await Promise.all([
      this.prisma.sandboxJob.count({
        where: {
          status: {
            in: [...PENDING_SANDBOX_JOB_STATUSES]
          }
        }
      }),
      this.prisma.sandboxJob.count({
        where: {
          assistantId: request.assistantId,
          workspaceId: request.workspaceId,
          status: {
            in: [...PENDING_SANDBOX_JOB_STATUSES]
          }
        }
      })
    ]);
    if (pendingJobs >= this.config.SANDBOX_MAX_PENDING_JOBS) {
      this.sandboxObservabilityService.recordBacklogRejected("global");
      this.logger.warn(
        `sandbox_backlog_full pending=${String(pendingJobs)} limit=${String(this.config.SANDBOX_MAX_PENDING_JOBS)}`
      );
      return {
        code: "sandbox_backlog_full",
        message: `Sandbox backlog is full (${String(this.config.SANDBOX_MAX_PENDING_JOBS)} pending jobs limit). Retry shortly.`
      };
    }
    if (workspacePendingJobs >= this.config.SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE) {
      this.sandboxObservabilityService.recordBacklogRejected("workspace");
      this.logger.warn(
        `sandbox_workspace_backlog_full assistantId=${request.assistantId} workspaceId=${request.workspaceId} pending=${String(workspacePendingJobs)} limit=${String(this.config.SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE)}`
      );
      return {
        code: "sandbox_workspace_backlog_full",
        message: `Sandbox backlog is full for this workspace (${String(this.config.SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE)} pending jobs limit). Retry shortly.`
      };
    }
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
    const workspaceRoot = this.resolveWorkspaceSessionRoot(
      request.assistantId,
      request.workspaceId
    );
    let leaseGuard: WorkspaceLeaseGuard | null = null;
    try {
      const leaseHandle = await this.waitForWorkspaceLease({
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        sandboxJobId: jobId,
        waitTimeoutMs: this.resolveWorkspaceLeaseWaitTimeoutMs(request.policy)
      });
      leaseGuard = this.startWorkspaceLeaseHeartbeat(leaseHandle);
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: "running",
          startedAt: new Date()
        }
      });
      let existingWorkspaceFiles = await this.loadCurrentAssistantWorkspaceFiles(
        request.assistantId,
        request.workspaceId
      );
      this.assertWorkspaceLeaseActive(leaseGuard);
      existingWorkspaceFiles = await this.ensureWorkspaceSessionHydrated(
        workspaceRoot,
        request.assistantId,
        request.workspaceId,
        existingWorkspaceFiles,
        request.runtimeSessionId ?? null
      );
      this.assertWorkspaceLeaseActive(leaseGuard);
      const mountedFiles = await this.materializeMountedFiles(
        workspaceRoot,
        request.assistantId,
        request.workspaceId,
        request.args,
        request.mountedFileRefs ?? []
      );
      this.assertWorkspaceLeaseActive(leaseGuard);
      const baselineWorkspaceStats = await this.computeWorkspaceStats(workspaceRoot);

      const result = await this.executeTool({
        workspaceRoot,
        request,
        jobId,
        mountedFiles,
        leaseGuard
      });
      this.assertWorkspaceLeaseActive(leaseGuard);

      const stats = await this.computeWorkspaceStats(workspaceRoot);
      this.assertWorkspaceLeaseActive(leaseGuard);
      this.assertWorkspaceStats(stats, request.policy, baselineWorkspaceStats);

      const files = await this.collectWorkspaceFiles(workspaceRoot);
      const workspaceDelta = this.resolveWorkspaceDelta(
        files,
        existingWorkspaceFiles,
        mountedFiles
      );
      this.assertProducedFileLimits(workspaceDelta.changedFiles, request.policy);
      this.assertWorkspaceLeaseActive(leaseGuard);
      const persistedFiles = await this.persistWorkspaceFiles({
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        toolCode: request.toolCode,
        jobId,
        files: workspaceDelta.changedFiles,
        existingWorkspaceFiles,
        leaseGuard
      });
      this.assertWorkspaceLeaseActive(leaseGuard);
      await this.deleteRemovedWorkspaceFiles({
        workspaceRoot,
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        deletedPaths: workspaceDelta.deletedPaths,
        leaseGuard
      });
      await this.writeWorkspaceSessionStateMarker(
        workspaceRoot,
        await this.loadCurrentAssistantWorkspaceFiles(request.assistantId, request.workspaceId)
      );
      if (request.runtimeSessionId !== null && request.runtimeSessionId !== undefined) {
        await this.saveSessionWorkspaceSnapshot(
          request.assistantId,
          request.runtimeSessionId,
          workspaceRoot
        );
      }
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          ...(result.execPodName !== undefined ? { execPodName: result.execPodName } : {}),
          resultPayload: {
            reason: this.stripNulCharactersNullable(result.reason),
            warning: this.stripNulCharactersNullable(result.warning),
            exitCode: result.exitCode,
            stdout: this.stripNulCharactersNullable(result.stdout),
            stderr: this.stripNulCharactersNullable(result.stderr),
            content: this.stripNulCharactersNullable(result.content)
          },
          resourceUsage: {
            workspaceBytes: stats.totalBytes,
            fileCount: stats.fileCount,
            directoryCount: stats.directoryCount,
            stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
            stderrBytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
            processDurationMs: result.durationMs ?? null
          }
        }
      });
      if (persistedFiles.length !== workspaceDelta.changedFiles.length) {
        this.logger.warn(
          `Sandbox job ${jobId} persisted ${String(persistedFiles.length)} of ${String(workspaceDelta.changedFiles.length)} changed file(s).`
        );
      }
    } catch (error) {
      const { code, message, blocked, resourceUsage } = this.normalizeSandboxError(error);
      const safeMessage = this.stripNulCharacters(message);
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: blocked ? "blocked" : "failed",
          completedAt: new Date(),
          violationCode: code,
          violationMessage: safeMessage,
          resultPayload: {
            reason: code,
            warning: safeMessage,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          },
          ...(resourceUsage === null ? {} : { resourceUsage: this.toJsonValue(resourceUsage) })
        }
      });
      await this.resetWorkspaceSessionToCurrentState(
        request.assistantId,
        request.workspaceId,
        workspaceRoot,
        request.runtimeSessionId ?? null
      );
    } finally {
      await this.stopWorkspaceLeaseHeartbeat(leaseGuard);
    }
  }

  private async executeTool(input: {
    workspaceRoot: string;
    request: RuntimeSandboxJobRequest;
    jobId: string;
    mountedFiles: MountedWorkspaceState;
    leaseGuard: WorkspaceLeaseGuard;
  }): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
    durationMs?: number;
    execPodName?: string;
  }> {
    this.assertWorkspaceLeaseActive(input.leaseGuard);
    switch (input.request.toolCode) {
      case "files": {
        const action = this.readSandboxFilesAction(input.request.args);
        switch (action) {
          case "read":
            return this.executeFilesReadAction(
              input.workspaceRoot,
              input.request.args,
              input.mountedFiles
            );
          case "write":
            return this.executeFilesWriteAction(
              input.workspaceRoot,
              input.request.args,
              input.request.policy
            );
          case "edit":
            return this.executeFilesEditAction(
              input.workspaceRoot,
              input.request.args,
              input.request.policy
            );
          case "delete":
            return this.executeFilesDeleteAction(input.workspaceRoot, input.request.args);
        }
        throw new Error(`Unsupported files action: ${String(action)}`);
      }
      case "exec":
        return this.executeExecLike(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          false,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null
        );
      case "shell":
        return this.executeExecLike(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          true,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null
        );
      case "render_html_to_pdf":
        return this.executeRenderHtmlToPdf(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null
        );
      case "execute_document_code":
        return this.executeDocumentCode(
          input.workspaceRoot,
          input.request.args,
          input.request.policy,
          input.mountedFiles,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null
        );
      default:
        this.throwPolicy(
          "tool_not_supported",
          `Unsupported sandbox tool "${input.request.toolCode}".`
        );
    }
  }

  private async executeFilesReadAction(
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
    const relativePath = this.resolveFilesReadablePath(args, mountedFiles);
    const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
    const buffer = await fs.readFile(absolutePath);
    return {
      reason: null,
      warning: null,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: this.stripNulCharacters(buffer.toString("utf8"))
    };
  }

  private async executeFilesWriteAction(
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

  private async executeFilesEditAction(
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

  private async executeFilesDeleteAction(workspaceRoot: string, args: Record<string, unknown>) {
    const relativePath = this.requireRelativePath(args.path, "path");
    if (relativePath === ".") {
      this.throwPolicy("invalid_path", "Deleting the workspace root is not allowed.");
    }
    const recursive = args.recursive === true;
    const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
    let stats;
    try {
      stats = await fs.lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.throwPolicy("path_not_found", "The requested path to delete was not found.");
      }
      throw error;
    }
    if (stats.isDirectory()) {
      if (!recursive) {
        this.throwPolicy("recursive_required", "Deleting a directory requires recursive=true.");
      }
      await fs.rm(absolutePath, { recursive: true, force: false });
    } else {
      await fs.rm(absolutePath, { force: false });
    }
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
    shellMode: boolean,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null
  ) {
    const cwd = args.cwd === undefined ? "." : this.requireRelativePath(args.cwd, "cwd");
    const absoluteCwd = this.resolveWorkspacePath(workspaceRoot, cwd);
    await fs.mkdir(absoluteCwd, { recursive: true });

    this.assertWorkspaceLeaseActive(leaseGuard);

    if (shellMode) {
      const command = this.requireString(args.command, "command");
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        workspaceRoot,
        absoluteCwd,
        command: "/bin/sh",
        args: ["-lc", command],
        policy
      });
      return {
        reason: result.exitCode === 0 ? null : "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName
      };
    }

    const command = this.requireString(args.command, "command");
    const childArgs = Array.isArray(args.args)
      ? args.args.filter((item): item is string => typeof item === "string")
      : [];
    const result = await this.execPodBridgeService.runInPod({
      jobId,
      runtimeSessionId,
      workspaceRoot,
      absoluteCwd,
      command,
      args: childArgs,
      policy
    });
    return {
      reason: result.exitCode === 0 ? null : "process_failed",
      warning: null,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      content: null,
      durationMs: result.durationMs,
      execPodName: result.execPodName
    };
  }

  /**
   * Internal document-render tool (ADR-123 D6). Not exposed to the model: the runtime
   * document worker invokes it with model-authored HTML. The HTML is written into the
   * workspace, rendered to PDF in the exec pod with WeasyPrint (full CSS Paged Media
   * support — honours our in-house @page size/margins/page-counter print CSS), then the
   * transient HTML input is removed so only the PDF is collected as a produced file.
   */
  private async executeRenderHtmlToPdf(
    workspaceRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null
  ) {
    const htmlContent = this.requireString(args.htmlContent, "htmlContent");
    const outputFileName =
      args.outputFileName === undefined
        ? "document.pdf"
        : this.requireRelativePath(args.outputFileName, "outputFileName");
    if (!outputFileName.toLowerCase().endsWith(".pdf")) {
      this.throwPolicy("invalid_path", "render_html_to_pdf outputFileName must end with .pdf");
    }

    const htmlSizeBytes = Buffer.byteLength(htmlContent, "utf8");
    if (htmlSizeBytes > policy.maxSingleFileWriteBytes) {
      this.throwPolicy(
        "single_file_write_limit_exceeded",
        `Render HTML input is ${String(htmlSizeBytes)} bytes, above the per-file limit of ${String(
          policy.maxSingleFileWriteBytes
        )}.`
      );
    }

    this.assertWorkspaceLeaseActive(leaseGuard);

    const inputRelativePath = ".render-input.html";
    const inputAbsolutePath = this.resolveWorkspacePath(workspaceRoot, inputRelativePath);
    await fs.writeFile(inputAbsolutePath, htmlContent, "utf8");

    try {
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        workspaceRoot,
        absoluteCwd: workspaceRoot,
        command: "weasyprint",
        args: [`/workspace/${inputRelativePath}`, `/workspace/${outputFileName}`],
        policy
      });
      return {
        reason: result.exitCode === 0 ? null : "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName
      };
    } finally {
      // Drop the transient HTML input so it never becomes a produced artifact.
      await fs.rm(inputAbsolutePath, { force: true });
    }
  }

  /**
   * ADR-123 Slice 6 — Documents mode B: execute a model-authored Python 3
   * program that writes exactly one Office/data file to /workspace/<outputFileName>.
   *
   * Source ingestion (sandbox-first, two-tier — decided by the runtime worker):
   * - `args.sourceMounts: [{ fileRef, mountPath }]` — the raw source files are
   *   mounted by the generic mountedFileRefs machinery at their canonical
   *   relativePath; here we COPY each into the deterministic worker-chosen
   *   `mountPath` (e.g. sources/<name>) so the program can read a known path.
   * - `args.textSidecars: [{ mountPath, text }]` — OCR/extracted text sidecars
   *   (Tier 2) written verbatim into the workspace.
   * All transient source copies/sidecars + the program file live under
   * /workspace/sources and /workspace/.document-code.py and are removed in the
   * `finally` block so only the produced output file is collected.
   */
  private async executeDocumentCode(
    workspaceRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    mountedFiles: MountedWorkspaceState,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null
  ) {
    const programSource = this.requireString(args.programSource, "programSource");
    const outputFileName = this.requireRelativePath(args.outputFileName, "outputFileName");
    const lowerOutput = outputFileName.toLowerCase();
    if (
      !lowerOutput.endsWith(".xlsx") &&
      !lowerOutput.endsWith(".docx") &&
      !lowerOutput.endsWith(".pdf")
    ) {
      this.throwPolicy(
        "invalid_path",
        "execute_document_code outputFileName must end with .xlsx, .docx, or .pdf"
      );
    }

    const programSizeBytes = Buffer.byteLength(programSource, "utf8");
    if (programSizeBytes > policy.maxSingleFileWriteBytes) {
      this.throwPolicy(
        "single_file_write_limit_exceeded",
        `Document code program is ${String(programSizeBytes)} bytes, above the per-file limit of ${String(
          policy.maxSingleFileWriteBytes
        )}.`
      );
    }

    this.assertWorkspaceLeaseActive(leaseGuard);

    const programRelativePath = ".document-code.py";
    const programAbsolutePath = this.resolveWorkspacePath(workspaceRoot, programRelativePath);
    const sourcesDirAbsolute = this.resolveWorkspacePath(workspaceRoot, "sources");

    try {
      // Materialize Tier 1 source copies into deterministic mount paths.
      const sourceMounts = this.readDocumentCodeSourceMounts(args.sourceMounts);
      for (const mount of sourceMounts) {
        const mounted = mountedFiles.byRef.get(mount.fileRef);
        if (mounted === undefined) {
          this.throwPolicy(
            "file_ref_not_found",
            `Document code source mount references unknown fileRef "${mount.fileRef}".`
          );
        }
        const mountedAbsolute = this.resolveWorkspacePath(workspaceRoot, mounted.relativePath);
        const targetAbsolute = this.resolveWorkspacePath(workspaceRoot, mount.mountPath);
        await fs.mkdir(dirname(targetAbsolute), { recursive: true });
        const buffer = await fs.readFile(mountedAbsolute);
        await fs.writeFile(targetAbsolute, buffer);
      }

      // Materialize Tier 2 OCR/extracted-text sidecars.
      const textSidecars = this.readDocumentCodeTextSidecars(args.textSidecars);
      for (const sidecar of textSidecars) {
        const targetAbsolute = this.resolveWorkspacePath(workspaceRoot, sidecar.mountPath);
        await fs.mkdir(dirname(targetAbsolute), { recursive: true });
        await fs.writeFile(targetAbsolute, sidecar.text, "utf8");
      }

      await fs.writeFile(programAbsolutePath, programSource, "utf8");

      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        workspaceRoot,
        absoluteCwd: workspaceRoot,
        command: "python3",
        args: [`/workspace/${programRelativePath}`],
        policy
      });
      return {
        reason: result.exitCode === 0 ? null : "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName
      };
    } finally {
      // Remove the program and all transient source copies/sidecars so only the
      // produced output file is collected. The whole sources/ dir is removed in
      // case the program created extra files under it.
      await fs.rm(programAbsolutePath, { force: true });
      await fs.rm(sourcesDirAbsolute, { recursive: true, force: true });
    }
  }

  private readDocumentCodeSourceMounts(
    value: unknown
  ): Array<{ fileRef: string; mountPath: string }> {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.throwPolicy("invalid_arguments", "execute_document_code sourceMounts must be an array.");
    }
    const mounts: Array<{ fileRef: string; mountPath: string }> = [];
    for (const entry of value as unknown[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        this.throwPolicy(
          "invalid_arguments",
          "execute_document_code sourceMounts[] must be objects."
        );
      }
      const row = entry as Record<string, unknown>;
      const fileRef = this.requireString(row.fileRef, "sourceMounts[].fileRef");
      const mountPath = this.requireRelativePath(row.mountPath, "sourceMounts[].mountPath");
      mounts.push({ fileRef, mountPath });
    }
    return mounts;
  }

  private readDocumentCodeTextSidecars(value: unknown): Array<{ mountPath: string; text: string }> {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.throwPolicy("invalid_arguments", "execute_document_code textSidecars must be an array.");
    }
    const sidecars: Array<{ mountPath: string; text: string }> = [];
    for (const entry of value as unknown[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        this.throwPolicy(
          "invalid_arguments",
          "execute_document_code textSidecars[] must be objects."
        );
      }
      const row = entry as Record<string, unknown>;
      const mountPath = this.requireRelativePath(row.mountPath, "textSidecars[].mountPath");
      const text = typeof row.text === "string" ? row.text : "";
      sidecars.push({ mountPath, text });
    }
    return sidecars;
  }

  private buildWorkspaceSessionKey(assistantId: string, workspaceId: string): string {
    return `${assistantId}:${workspaceId}`;
  }

  private resolveWorkspaceSessionRoot(assistantId: string, workspaceId: string): string {
    return join(tmpdir(), "persai-sandbox", "assistants", assistantId, workspaceId, "workspace");
  }

  private enqueueWorkspaceJob(key: string, job: () => Promise<void>): Promise<void> {
    const previous = this.workspaceExecutionQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(job);
    this.workspaceExecutionQueues.set(
      key,
      next.finally(() => {
        if (this.workspaceExecutionQueues.get(key) === next) {
          this.workspaceExecutionQueues.delete(key);
        }
      })
    );
    return next;
  }

  private async waitForWorkspaceLease(input: {
    assistantId: string;
    workspaceId: string;
    sandboxJobId: string;
    waitTimeoutMs: number;
  }): Promise<WorkspaceLeaseHandle> {
    const deadline = Date.now() + input.waitTimeoutMs;
    for (;;) {
      const acquired = await this.tryAcquireWorkspaceLease(input);
      if (acquired !== null) {
        return acquired;
      }
      if (Date.now() >= deadline) {
        throw this.createWorkspaceLeaseError(
          "workspace_lease_timeout",
          `Timed out waiting for assistant workspace lease after ${String(input.waitTimeoutMs)}ms.`,
          true
        );
      }
      await new Promise((resolve) => setTimeout(resolve, WORKSPACE_LEASE_ACQUIRE_RETRY_MS));
    }
  }

  private async tryAcquireWorkspaceLease(input: {
    assistantId: string;
    workspaceId: string;
    sandboxJobId: string;
  }): Promise<WorkspaceLeaseHandle | null> {
    const handle = this.buildWorkspaceLeaseHandle(input);
    try {
      await this.prisma.assistantWorkspaceLease.create({
        data: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sandboxJobId: input.sandboxJobId,
          leaseToken: handle.leaseToken,
          holderId: handle.holderId,
          expiresAt: handle.expiresAt
        }
      });
      return handle;
    } catch (error) {
      if (!this.isPrismaUniqueConstraintError(error)) {
        throw error;
      }
    }
    const claimed = await this.prisma.assistantWorkspaceLease.updateMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        expiresAt: {
          lt: new Date()
        }
      },
      data: {
        sandboxJobId: input.sandboxJobId,
        leaseToken: handle.leaseToken,
        holderId: handle.holderId,
        expiresAt: handle.expiresAt
      }
    });
    return claimed.count === 1 ? handle : null;
  }

  private startWorkspaceLeaseHeartbeat(handle: WorkspaceLeaseHandle): WorkspaceLeaseGuard {
    const guard: WorkspaceLeaseGuard = {
      handle,
      active: true,
      renewalError: null,
      heartbeatTimer: null,
      renewing: false
    };
    guard.heartbeatTimer = setInterval(() => {
      if (!guard.active || guard.renewing) {
        return;
      }
      guard.renewing = true;
      void this.renewWorkspaceLease(guard.handle)
        .then((renewed) => {
          if (renewed === null) {
            guard.active = false;
            guard.renewalError = this.createWorkspaceLeaseError(
              "workspace_lease_lost",
              "Assistant workspace lease was lost during sandbox execution."
            );
            return;
          }
          guard.handle = renewed;
        })
        .catch((error) => {
          guard.active = false;
          guard.renewalError =
            error instanceof Error
              ? error
              : this.createWorkspaceLeaseError(
                  "workspace_lease_renew_failed",
                  "Assistant workspace lease renewal failed."
                );
        })
        .finally(() => {
          guard.renewing = false;
        });
    }, WORKSPACE_LEASE_RENEW_INTERVAL_MS);
    return guard;
  }

  private async stopWorkspaceLeaseHeartbeat(guard: WorkspaceLeaseGuard | null): Promise<void> {
    const heartbeatTimer = guard?.heartbeatTimer ?? null;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
    if (guard === null) {
      return;
    }
    guard.active = false;
    await this.releaseWorkspaceLease(guard.handle);
  }

  private assertWorkspaceLeaseActive(guard: WorkspaceLeaseGuard): void {
    if (guard.active) {
      return;
    }
    throw (
      guard.renewalError ??
      this.createWorkspaceLeaseError(
        "workspace_lease_lost",
        "Assistant workspace lease is no longer active."
      )
    );
  }

  private async renewWorkspaceLease(
    handle: WorkspaceLeaseHandle
  ): Promise<WorkspaceLeaseHandle | null> {
    const renewed = this.buildWorkspaceLeaseHandle(handle);
    const updated = await this.prisma.assistantWorkspaceLease.updateMany({
      where: {
        assistantId: handle.assistantId,
        workspaceId: handle.workspaceId,
        leaseToken: handle.leaseToken,
        holderId: handle.holderId,
        expiresAt: {
          gt: new Date()
        }
      },
      data: {
        sandboxJobId: handle.sandboxJobId,
        expiresAt: renewed.expiresAt
      }
    });
    return updated.count === 1 ? renewed : null;
  }

  private resolveWorkspaceLeaseWaitTimeoutMs(policy: RuntimeSandboxPolicy): number {
    return Math.max(
      WORKSPACE_LEASE_WAIT_TIMEOUT_MS,
      Math.min(60_000, policy.maxProcessRuntimeMs + 5_000)
    );
  }

  private async releaseWorkspaceLease(handle: WorkspaceLeaseHandle): Promise<void> {
    await this.prisma.assistantWorkspaceLease.updateMany({
      where: {
        assistantId: handle.assistantId,
        workspaceId: handle.workspaceId,
        leaseToken: handle.leaseToken,
        holderId: handle.holderId
      },
      data: {
        sandboxJobId: null,
        leaseToken: `released:${randomUUID()}`,
        expiresAt: new Date()
      }
    });
  }

  private buildWorkspaceLeaseHandle(input: {
    assistantId: string;
    workspaceId: string;
    sandboxJobId: string;
    holderId?: string;
    leaseToken?: string;
  }): WorkspaceLeaseHandle {
    return {
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      sandboxJobId: input.sandboxJobId,
      leaseToken: input.leaseToken ?? randomUUID(),
      holderId: input.holderId ?? this.sandboxInstanceHolderId,
      expiresAt: new Date(Date.now() + WORKSPACE_LEASE_TTL_MS)
    };
  }

  private async ensureWorkspaceSessionHydrated(
    workspaceRoot: string,
    assistantId: string,
    workspaceId: string,
    existingWorkspaceFiles?: Map<string, AssistantWorkspaceFileRecord>,
    runtimeSessionId: string | null = null
  ): Promise<Map<string, AssistantWorkspaceFileRecord>> {
    let filesByPath =
      existingWorkspaceFiles ??
      (await this.loadCurrentAssistantWorkspaceFiles(assistantId, workspaceId));
    for (let cleanupPass = 0; cleanupPass < 8; cleanupPass += 1) {
      const stateToken = this.buildWorkspaceStateToken(filesByPath);
      const readyMarkerPath = this.resolveWorkspaceStateMarkerPath(workspaceRoot);
      try {
        const existingMarker = await fs.readFile(readyMarkerPath, "utf8");
        if (existingMarker.trim() === stateToken) {
          await fs.access(workspaceRoot);
          return filesByPath;
        }
      } catch {
        // Fall through to rebuild the local assistant workspace session.
      }
      await fs.rm(dirname(workspaceRoot), { recursive: true, force: true });
      await fs.mkdir(workspaceRoot, { recursive: true });
      const staleFileIds: string[] = [];
      for (const file of filesByPath.values()) {
        const absolutePath = this.resolveWorkspacePath(workspaceRoot, file.relativePath);
        await fs.mkdir(dirname(absolutePath), { recursive: true });
        try {
          const buffer = await this.objectStorage.downloadObject(file.objectKey);
          const canonicalFile = await this.backfillWorkspaceFileIntegrity(file, buffer);
          if (canonicalFile !== file) {
            filesByPath.set(canonicalFile.relativePath, canonicalFile);
          }
          await fs.writeFile(absolutePath, buffer);
        } catch (error) {
          if (!this.isMissingObjectStorageError(error)) {
            throw error;
          }
          staleFileIds.push(file.id);
          this.logger.warn(
            `Skipping stale assistant file ${file.id} (${file.relativePath}) during workspace hydrate because object "${file.objectKey}" is missing.`
          );
        }
      }
      if (staleFileIds.length === 0) {
        await this.writeWorkspaceSessionStateMarker(workspaceRoot, filesByPath);
        // For session jobs: overlay ephemeral files from the GCS session snapshot AFTER
        // the declared files are written. Declared files already on disk are not overwritten.
        if (runtimeSessionId !== null) {
          await this.restoreSessionSnapshotOverlay(assistantId, runtimeSessionId, workspaceRoot);
        }
        return filesByPath;
      }
      await this.deleteStaleAssistantWorkspaceFiles({
        assistantId,
        workspaceId,
        fileIds: staleFileIds,
        reason: "workspace_hydrate_missing_object"
      });
      filesByPath = await this.loadCurrentAssistantWorkspaceFiles(assistantId, workspaceId);
    }
    throw new Error("Assistant workspace hydrate exceeded stale-file cleanup retries.");
  }

  /**
   * Persist the entire workspace directory as a tar to GCS under the session key.
   * This snapshot is restored on pod recreate to bring back ephemeral files.
   * GCS creds stay control-plane-only; exec pods never see this key.
   */
  private async saveSessionWorkspaceSnapshot(
    assistantId: string,
    runtimeSessionId: string,
    workspaceRoot: string
  ): Promise<void> {
    const objectKey = this.objectStorage.buildSessionSnapshotKey({ assistantId, runtimeSessionId });
    let tarBytes: Buffer;
    try {
      tarBytes = await this.createTarFromDirectory(workspaceRoot);
    } catch (error) {
      this.logger.warn(
        `[session-snapshot] tar creation failed assistantId=${assistantId} session=${runtimeSessionId} — snapshot skipped: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    try {
      await this.objectStorage.saveObject({
        objectKey,
        buffer: tarBytes,
        mimeType: "application/x-tar"
      });
      this.logger.log(
        `[session-snapshot] saved assistantId=${assistantId} session=${runtimeSessionId} bytes=${String(tarBytes.length)}`
      );
    } catch (error) {
      this.logger.warn(
        `[session-snapshot] GCS save failed assistantId=${assistantId} session=${runtimeSessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Overlay the GCS session snapshot onto an already-hydrated workspace directory.
   * Only files NOT already present on disk are written (copy-if-absent semantics),
   * so declared AssistantFile content always takes precedence.
   * Missing snapshot (first session) is handled gracefully.
   */
  private async restoreSessionSnapshotOverlay(
    assistantId: string,
    runtimeSessionId: string,
    workspaceRoot: string
  ): Promise<void> {
    const objectKey = this.objectStorage.buildSessionSnapshotKey({ assistantId, runtimeSessionId });
    let tarBytes: Buffer;
    try {
      tarBytes = await this.objectStorage.downloadObject(objectKey);
    } catch (error) {
      if (this.isMissingObjectStorageError(error)) {
        // First session or snapshot expired — nothing to restore.
        return;
      }
      this.logger.warn(
        `[session-snapshot] GCS download failed assistantId=${assistantId} session=${runtimeSessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    try {
      await this.extractTarOverlay(tarBytes, workspaceRoot);
      this.logger.log(
        `[session-snapshot] restored overlay assistantId=${assistantId} session=${runtimeSessionId}`
      );
    } catch (error) {
      this.logger.warn(
        `[session-snapshot] tar extraction failed assistantId=${assistantId} session=${runtimeSessionId} — continuing without overlay: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a tar archive of a directory, returning it as a Buffer.
   * Uses the local `tar` binary (available on Linux prod and macOS/Windows dev).
   */
  private createTarFromDirectory(directory: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const tarChild = spawn("tar", ["-cf", "-", "-C", directory, "."], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      tarChild.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
      const stderrChunks: Buffer[] = [];
      tarChild.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      tarChild.on("error", (err: Error) => {
        reject(new Error(`tar create failed: ${err.message}`));
      });
      tarChild.on("close", (exitCode: number | null) => {
        if (exitCode === 0 || exitCode === null) {
          resolve(Buffer.concat(chunks));
        } else {
          const stderrMsg = Buffer.concat(stderrChunks).toString("utf8").trim();
          reject(new Error(`tar create exited ${String(exitCode)}: ${stderrMsg}`));
        }
      });
    });
  }

  /**
   * Overlay a tar archive onto a directory, restoring only files that do not already exist
   * so declared AssistantFile content always takes precedence.
   *
   * Implemented as plain extract-to-staging + copy-if-absent rather than tar's own
   * keep/skip flags, because those diverge across implementations: GNU tar's
   * `--keep-old-files` treats pre-existing files as errors (non-zero exit), and
   * `--skip-old-files` is unavailable on BSD/libarchive tar. A plain `tar -xf` into an
   * empty staging dir exits 0 on every tar, and `fs.cp({ force: false })` skips files
   * that already exist in the workspace.
   */
  private async extractTarOverlay(tarBytes: Buffer, directory: string): Promise<void> {
    const staging = await fs.mkdtemp(join(tmpdir(), "persai-session-overlay-"));
    try {
      await this.extractTarToDirectory(tarBytes, staging);
      await fs.cp(staging, directory, { recursive: true, force: false, errorOnExist: false });
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Extract a tar archive into a (typically empty) directory with no skip/keep flags,
   * so the exit code is 0 on both GNU and BSD tar.
   */
  private extractTarToDirectory(tarBytes: Buffer, directory: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const extractChild = spawn("tar", ["-xf", "-", "-C", directory], {
        stdio: ["pipe", "ignore", "pipe"]
      });
      const stderrChunks: Buffer[] = [];
      extractChild.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      extractChild.on("error", (err: Error) => {
        reject(new Error(`tar overlay extract failed: ${err.message}`));
      });
      extractChild.on("close", (exitCode: number | null) => {
        if (exitCode === 0 || exitCode === null) {
          resolve();
        } else {
          const stderrMsg = Buffer.concat(stderrChunks).toString("utf8").trim();
          reject(new Error(`tar overlay extract exited ${String(exitCode)}: ${stderrMsg}`));
        }
      });
      extractChild.stdin?.end(tarBytes);
    });
  }

  private async resetWorkspaceSessionToCurrentState(
    assistantId: string,
    workspaceId: string,
    workspaceRoot: string,
    runtimeSessionId: string | null = null
  ): Promise<void> {
    const currentWorkspaceFiles = await this.loadCurrentAssistantWorkspaceFiles(
      assistantId,
      workspaceId
    );
    await fs.rm(dirname(workspaceRoot), { recursive: true, force: true });
    await this.ensureWorkspaceSessionHydrated(
      workspaceRoot,
      assistantId,
      workspaceId,
      currentWorkspaceFiles,
      runtimeSessionId
    );
  }

  private async loadCurrentAssistantWorkspaceFiles(
    assistantId: string,
    workspaceId: string
  ): Promise<Map<string, AssistantWorkspaceFileRecord>> {
    const rows = await this.prisma.assistantFile.findMany({
      where: {
        assistantId,
        workspaceId
      },
      orderBy: [{ relativePath: "asc" }, { updatedAt: "desc" }, { id: "desc" }]
    });
    const filesByPath = new Map<string, AssistantWorkspaceFileRecord>();
    for (const row of rows) {
      if (filesByPath.has(row.relativePath)) {
        continue;
      }
      filesByPath.set(row.relativePath, row);
    }
    return filesByPath;
  }

  private resolveWorkspaceStateMarkerPath(workspaceRoot: string): string {
    return join(dirname(workspaceRoot), ".persai-workspace-state");
  }

  private buildWorkspaceStateToken(filesByPath: Map<string, AssistantWorkspaceFileRecord>): string {
    const hash = createHash("sha256");
    for (const [relativePath, file] of [...filesByPath.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(file.id);
      hash.update("\0");
      hash.update(file.objectKey);
      hash.update("\0");
      hash.update(file.updatedAt.toISOString());
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  private async writeWorkspaceSessionStateMarker(
    workspaceRoot: string,
    filesByPath: Map<string, AssistantWorkspaceFileRecord>
  ): Promise<void> {
    const markerPath = this.resolveWorkspaceStateMarkerPath(workspaceRoot);
    await fs.mkdir(dirname(markerPath), { recursive: true });
    await fs.writeFile(markerPath, this.buildWorkspaceStateToken(filesByPath), "utf8");
  }

  private async deleteStaleAssistantWorkspaceFiles(input: {
    assistantId: string;
    workspaceId: string;
    fileIds: string[];
    reason: string;
  }): Promise<void> {
    if (input.fileIds.length === 0) {
      return;
    }
    const removed = await this.prisma.assistantFile.deleteMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        id: {
          in: input.fileIds
        }
      }
    });
    this.logger.warn(
      `Removed ${String(removed.count)} stale assistant file row(s) for ${input.assistantId}/${input.workspaceId} after ${input.reason}.`
    );
  }

  private resolveWorkspaceDelta(
    files: WorkspaceFileSnapshot[],
    existingWorkspaceFiles: Map<string, AssistantWorkspaceFileRecord>,
    mountedFiles: MountedWorkspaceState
  ): {
    changedFiles: WorkspaceFileSnapshot[];
    deletedPaths: string[];
  } {
    const currentFilesByPath = new Map(files.map((file) => [file.relativePath, file] as const));
    const changedFiles = files.filter((file) => {
      const existing = existingWorkspaceFiles.get(file.relativePath);
      if (!existing) {
        return true;
      }
      const unchanged =
        (existing.sha256 ?? null) === file.sha256 && Number(existing.sizeBytes) === file.sizeBytes;
      if (!unchanged) {
        return true;
      }
      const mounted = mountedFiles.byPath.get(file.relativePath);
      if (!mounted) {
        return false;
      }
      return mounted.sha256 !== file.sha256 || mounted.sizeBytes !== file.sizeBytes;
    });
    const deletedPaths = [...existingWorkspaceFiles.keys()].filter(
      (relativePath) => !currentFilesByPath.has(relativePath)
    );
    return { changedFiles, deletedPaths };
  }

  private async backfillWorkspaceFileIntegrity(
    file: AssistantWorkspaceFileRecord,
    buffer: Buffer
  ): Promise<AssistantWorkspaceFileRecord> {
    const computedSha256 = createHash("sha256").update(buffer).digest("hex");
    const computedSize = BigInt(buffer.length);
    if (
      file.sha256 === computedSha256 &&
      file.sizeBytes === computedSize &&
      file.logicalSizeBytes === computedSize
    ) {
      return file;
    }
    return await this.prisma.assistantFile.update({
      where: { id: file.id },
      data: {
        objectKey: file.objectKey,
        relativePath: file.relativePath,
        displayName: file.displayName,
        mimeType: file.mimeType,
        sandboxJobId: file.sandboxJobId,
        sourceToolCode: file.sourceToolCode,
        sizeBytes: computedSize,
        logicalSizeBytes: computedSize,
        sha256: computedSha256,
        metadata: file.metadata ?? Prisma.JsonNull
      }
    });
  }

  private async materializeMountedFiles(
    workspaceRoot: string,
    assistantId: string,
    workspaceId: string,
    args: Record<string, unknown>,
    mountedFileRefs: string[] = []
  ): Promise<MountedWorkspaceState> {
    const mountedFiles: MountedWorkspaceState = {
      byRef: new Map(),
      byPath: new Map()
    };
    const requiredRefs = new Set<string>();
    const singleRef = this.readNullableString(args.fileRef);
    if (singleRef) {
      requiredRefs.add(singleRef);
    }
    if (Array.isArray(args.mountFileRefs)) {
      for (const item of args.mountFileRefs) {
        if (typeof item === "string" && item.trim().length > 0) {
          requiredRefs.add(item.trim());
        }
      }
    }
    const mountRefs = new Set<string>(requiredRefs);
    for (const item of mountedFileRefs) {
      if (typeof item === "string" && item.trim().length > 0) {
        mountRefs.add(item.trim());
      }
    }
    if (mountRefs.size === 0) {
      return mountedFiles;
    }
    const requestedRefs = [...mountRefs];
    const canonicalRefs = await this.prisma.assistantFile.findMany({
      where: {
        assistantId,
        workspaceId,
        id: {
          in: requestedRefs
        }
      }
    });
    const canonicalIds = new Set(canonicalRefs.map((ref) => ref.id));
    const missingRequiredRefs = [...requiredRefs].filter((ref) => !canonicalIds.has(ref));
    if (missingRequiredRefs.length > 0) {
      this.throwPolicy("file_ref_not_found", "One or more sandbox file references were not found.");
    }
    const staleFileIds: string[] = [];
    let requiredMountMissingObject = false;
    for (const ref of canonicalRefs) {
      const relativePath = this.requireRelativePath(ref.relativePath, "relativePath");
      if (mountedFiles.byPath.has(relativePath)) {
        this.throwPolicy(
          "mounted_path_conflict",
          `Mounted file references cannot share the same workspace path "${relativePath}".`
        );
      }
      const absolutePath = this.resolveWorkspacePath(workspaceRoot, relativePath);
      await fs.mkdir(dirname(absolutePath), { recursive: true });
      let buffer: Buffer;
      try {
        buffer = await this.objectStorage.downloadObject(ref.objectKey);
      } catch (error) {
        if (!this.isMissingObjectStorageError(error)) {
          throw error;
        }
        staleFileIds.push(ref.id);
        requiredMountMissingObject = requiredMountMissingObject || requiredRefs.has(ref.id);
        this.logger.warn(
          `Skipping stale mounted assistant file ${ref.id} (${ref.relativePath}) because object "${ref.objectKey}" is missing.`
        );
        continue;
      }
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
    if (staleFileIds.length > 0) {
      await this.deleteStaleAssistantWorkspaceFiles({
        assistantId,
        workspaceId,
        fileIds: staleFileIds,
        reason: "mounted_file_missing_object"
      });
    }
    if (requiredMountMissingObject) {
      this.throwPolicy(
        "file_ref_not_found",
        "One or more sandbox file references are stale because their stored object is missing."
      );
    }
    return mountedFiles;
  }

  private async persistWorkspaceFiles(input: {
    assistantId: string;
    workspaceId: string;
    toolCode: string;
    jobId: string;
    files: WorkspaceFileSnapshot[];
    existingWorkspaceFiles: Map<string, AssistantWorkspaceFileRecord>;
    leaseGuard: WorkspaceLeaseGuard;
  }): Promise<RuntimeSandboxProducedFile[]> {
    const produced: RuntimeSandboxProducedFile[] = [];
    for (const file of input.files) {
      this.assertWorkspaceLeaseActive(input.leaseGuard);
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
      const existing = input.existingWorkspaceFiles.get(file.relativePath) ?? null;
      const assistantFile =
        existing === null
          ? await this.prisma.assistantFile.create({
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
                logicalSizeBytes:
                  file.logicalSizeBytes === null ? null : BigInt(file.logicalSizeBytes),
                sha256: file.sha256,
                metadata: {}
              }
            })
          : await this.prisma.assistantFile.update({
              where: { id: existing.id },
              data: {
                sandboxJobId: input.jobId,
                origin: "sandbox_output",
                sourceToolCode: input.toolCode,
                objectKey,
                relativePath: file.relativePath,
                displayName: basename(file.relativePath),
                mimeType: file.mimeType,
                sizeBytes: BigInt(file.sizeBytes),
                logicalSizeBytes:
                  file.logicalSizeBytes === null ? null : BigInt(file.logicalSizeBytes),
                sha256: file.sha256,
                metadata: existing.metadata ?? {}
              }
            });
      if (existing !== null) {
        await this.prisma.assistantFile.deleteMany({
          where: {
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            relativePath: file.relativePath,
            id: {
              not: assistantFile.id
            }
          }
        });
      }
      const runtimeFileRef: RuntimeFileRef = {
        fileRef: assistantFile.id,
        origin: assistantFile.origin,
        sourceToolCode: assistantFile.sourceToolCode,
        objectKey: assistantFile.objectKey,
        relativePath: assistantFile.relativePath,
        displayName: assistantFile.displayName,
        mimeType: assistantFile.mimeType,
        sizeBytes: Number(assistantFile.sizeBytes),
        logicalSizeBytes:
          assistantFile.logicalSizeBytes === null ? null : Number(assistantFile.logicalSizeBytes),
        createdAt: assistantFile.createdAt.toISOString(),
        authorLabel: "sandbox"
      };
      produced.push({
        relativePath: assistantFile.relativePath,
        displayName: assistantFile.displayName,
        mimeType: assistantFile.mimeType,
        sizeBytes: Number(assistantFile.sizeBytes),
        logicalSizeBytes:
          assistantFile.logicalSizeBytes === null ? null : Number(assistantFile.logicalSizeBytes),
        fileRef: runtimeFileRef
      });
    }
    return produced;
  }

  private async deleteRemovedWorkspaceFiles(input: {
    workspaceRoot: string;
    assistantId: string;
    workspaceId: string;
    deletedPaths: string[];
    leaseGuard: WorkspaceLeaseGuard;
  }): Promise<void> {
    if (input.deletedPaths.length === 0) {
      return;
    }
    this.assertWorkspaceLeaseActive(input.leaseGuard);
    await this.prisma.assistantFile.deleteMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        relativePath: {
          in: input.deletedPaths
        }
      }
    });
    await this.pruneEmptyWorkspaceDirectories(input.workspaceRoot, input.deletedPaths);
  }

  private toProducedFile(row: {
    id: string;
    origin: string;
    sourceToolCode: string | null;
    objectKey: string;
    relativePath: string;
    displayName: string | null;
    mimeType: string;
    sizeBytes: bigint;
    logicalSizeBytes: bigint | null;
    createdAt: Date;
  }): RuntimeSandboxProducedFile {
    return {
      relativePath: row.relativePath,
      displayName: row.displayName,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      logicalSizeBytes: row.logicalSizeBytes === null ? null : Number(row.logicalSizeBytes),
      fileRef: {
        fileRef: row.id,
        origin: row.origin as RuntimeFileRef["origin"],
        sourceToolCode: row.sourceToolCode,
        objectKey: row.objectKey,
        relativePath: row.relativePath,
        displayName: row.displayName,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        logicalSizeBytes: row.logicalSizeBytes === null ? null : Number(row.logicalSizeBytes),
        createdAt: row.createdAt.toISOString(),
        authorLabel: "sandbox"
      }
    };
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

  private async pruneEmptyWorkspaceDirectories(
    workspaceRoot: string,
    deletedPaths: string[]
  ): Promise<void> {
    const normalizedRoot = resolve(workspaceRoot);
    const candidateDirs = new Set<string>();
    for (const deletedPath of deletedPaths) {
      const absolutePath = this.resolveWorkspacePath(workspaceRoot, deletedPath);
      let currentDir = dirname(absolutePath);
      while (
        currentDir.startsWith(normalizedRoot) &&
        currentDir !== normalizedRoot &&
        currentDir.length >= normalizedRoot.length
      ) {
        candidateDirs.add(currentDir);
        currentDir = dirname(currentDir);
      }
    }
    const orderedCandidates = [...candidateDirs].sort((left, right) => right.length - left.length);
    for (const candidateDir of orderedCandidates) {
      try {
        const entries = await fs.readdir(candidateDir);
        if (entries.length > 0) {
          continue;
        }
        await fs.rmdir(candidateDir);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          ((error as NodeJS.ErrnoException).code === "ENOENT" ||
            (error as NodeJS.ErrnoException).code === "ENOTEMPTY")
        ) {
          continue;
        }
        throw error;
      }
    }
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

  private assertWorkspaceStats(
    stats: WorkspaceStats,
    policy: RuntimeSandboxPolicy,
    baselineStats: WorkspaceStats = EMPTY_WORKSPACE_STATS
  ): void {
    const addedFileCount = Math.max(stats.fileCount - baselineStats.fileCount, 0);
    const addedDirectoryCount = Math.max(stats.directoryCount - baselineStats.directoryCount, 0);
    const addedBytes = Math.max(stats.totalBytes - baselineStats.totalBytes, 0);
    if (addedFileCount > policy.maxFileCountPerJob) {
      this.throwPolicy(
        "file_count_limit_exceeded",
        `Sandbox job added ${String(addedFileCount)} files, above the per-job limit of ${String(
          policy.maxFileCountPerJob
        )}.`
      );
    }
    if (addedDirectoryCount > policy.maxDirectoryCountPerJob) {
      this.throwPolicy(
        "directory_count_limit_exceeded",
        `Sandbox job added ${String(addedDirectoryCount)} directories, above the per-job limit of ${String(policy.maxDirectoryCountPerJob)}.`
      );
    }
    if (addedBytes > policy.maxWorkspaceBytesPerJob) {
      this.throwPolicy(
        "workspace_size_limit_exceeded",
        `Sandbox job increased workspace bytes by ${String(addedBytes)}, above the per-job limit of ${String(policy.maxWorkspaceBytesPerJob)} bytes.`
      );
    }
  }

  private assertProducedFileLimits(
    files: WorkspaceFileSnapshot[],
    policy: RuntimeSandboxPolicy
  ): void {
    for (const file of files) {
      if (file.sizeBytes > policy.maxSingleFileWriteBytes) {
        this.throwPolicy(
          "single_file_write_limit_exceeded",
          `Sandbox job would persist "${file.relativePath}" at ${String(file.sizeBytes)} bytes, above the single-file limit of ${String(policy.maxSingleFileWriteBytes)} bytes.`
        );
      }
    }
    if (files.length > policy.maxPersistedArtifactsPerJob) {
      this.throwPolicy(
        "artifact_count_limit_exceeded",
        `Sandbox job would persist ${String(files.length)} changed file(s), above the per-job limit of ${String(policy.maxPersistedArtifactsPerJob)}. Changed paths: ${this.describeWorkspacePaths(files.map((file) => file.relativePath))}.`
      );
    }
  }

  private describeWorkspacePaths(paths: string[], maxEntries = 8): string {
    if (paths.length === 0) {
      return "(none)";
    }
    const visible = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
    const shown = visible.slice(0, maxEntries);
    const remainder = visible.length - shown.length;
    return remainder > 0 ? `${shown.join(", ")} (+${String(remainder)} more)` : shown.join(", ");
  }

  private readSandboxFilesAction(args: Record<string, unknown>): SandboxFilesAction {
    if (
      args.action === "read" ||
      args.action === "write" ||
      args.action === "edit" ||
      args.action === "delete"
    ) {
      return args.action;
    }
    throw this.createPolicyError(
      "invalid_arguments",
      "files action must be one of read, write, edit, or delete."
    );
  }

  private resolveFilesReadablePath(
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
      case ".xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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

  private createWorkspaceLeaseError(
    code: string,
    message: string,
    blocked = false
  ): SandboxPolicyError {
    const error = new Error(message) as SandboxPolicyError;
    error.code = code;
    error.blocked = blocked;
    return error;
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

  private isPrismaUniqueConstraintError(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    );
  }

  private isMissingObjectStorageError(error: unknown): boolean {
    if (error === null || typeof error !== "object") {
      return false;
    }
    const typed = error as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      message?: unknown;
    };
    if (typed.code === 404 || typed.status === 404 || typed.statusCode === 404) {
      return true;
    }
    return (
      typeof typed.message === "string" &&
      /no such object|not found|missing stored object/i.test(typed.message)
    );
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
