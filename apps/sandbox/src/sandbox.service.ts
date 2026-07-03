import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, dirname, extname, basename, isAbsolute, relative, resolve, sep } from "node:path";
import { posix as pathPosix } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import type {
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeSandboxPolicy,
  RuntimeSandboxProducedFile
} from "@persai/runtime-contract";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { Prisma } from "@prisma/client";
import { SANDBOX_CONFIG } from "./sandbox-config";
import { ExecPodBridgeService } from "./exec-pod-bridge.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import {
  WorkspaceFileBridgeService,
  type WorkspaceBridgeContext
} from "./workspace-file-bridge.service";
import {
  buildDefaultVisibleWorkspaceRoot,
  normalizeAndClampPath,
  WORKSPACE_MOUNT_ROOT,
  WorkspacePathError,
  assertAllowedMountPrefix
} from "./workspace-path";

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

type SandboxToolExecutionResult = {
  reason: string | null;
  warning: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  content: string | null;
  durationMs?: number;
  execPodName?: string;
  producedFiles?: RuntimeSandboxProducedFile[];
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

/** POSIX single-quote escaping for shell commands built in sandbox methods. */
function sandboxPosixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

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
    private readonly execPodBridgeService: ExecPodBridgeService,
    private readonly workspaceFileBridgeService: WorkspaceFileBridgeService
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
    const producedFiles = this.readProducedFilesFromJobPayload(payload);
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

  /**
   * ADR-128 Slice 4 — hot-pod control-plane workspace bytes-push.
   *
   * Called by api `manage-chat-media.stageForWebThread` immediately after the
   * GCS upload succeeds, so the running pod sees the uploaded file without
   * having to wait for the next cold-start hydrate. If the workspace has no
   * Running pod, this is a no-op (`mode: "deferred"`) — the bytes are already
   * the canonical copy in GCS and `hydrateWorkspaceMountFromGcs` will pull them
   * on the next pod boot. The caller treats either outcome as success and
   * never blocks the upload on this hop.
   *
   * Quota: NOT enforced here. The api side (`media_storage_quota`) is the
   * single accounting source for inbound bytes; the bridge intentionally
   * passes `null` quotas to {@link WorkspaceFileBridgeService} so the pod-side
   * pre-write guard does NOT double-count what the api already booked.
   */
  async writeWorkspaceFileControlPlane(input: {
    assistantId: string;
    workspaceId: string;
    assistantHandle?: string | null;
    siblingHandles?: readonly string[] | null;
    runtimeSessionId?: string | null;
    basename: string;
    path?: string | null;
    replace?: boolean;
    contents?: Buffer | null;
    storagePath?: string | null;
    mimeType: string;
    policy?: RuntimeSandboxPolicy;
  }): Promise<
    | { ok: true; mode: "written" | "deferred"; workspaceRelPath: string; sizeBytes: number }
    | { ok: false; reason: string; message: string }
  > {
    const policy = input.policy ?? DEFAULT_RUNTIME_SANDBOX_POLICY;
    try {
      const contents =
        input.contents ??
        (input.storagePath
          ? await this.downloadWorkspaceStoragePathBytes(input.workspaceId, input.storagePath)
          : null);
      if (contents === null) {
        return {
          ok: false,
          reason: "missing_contents",
          message: "workspace_write_missing_contents"
        };
      }
      const assistantHandle = await this.resolveAssistantHandle(
        input.assistantId,
        input.assistantHandle ?? null
      );
      const siblingHandles = await this.resolveSiblingHandles(
        input.workspaceId,
        input.assistantId,
        input.siblingHandles ?? null
      );
      const bridgeCtx: WorkspaceBridgeContext = {
        assistantId: input.assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId: input.workspaceId,
        runtimeSessionId: input.runtimeSessionId ?? null,
        defaultVisibleRoot: buildDefaultVisibleWorkspaceRoot(
          assistantHandle,
          input.runtimeSessionId ?? null
        ),
        policy,
        workspaceQuotaBytes: null,
        sharedQuotaBytes: null
      };
      const writeResult = await this.workspaceFileBridgeService.writeWorkspaceFileControlPlane(
        bridgeCtx,
        {
          basename: input.basename,
          path: input.path ?? null,
          contents,
          replace: input.replace === true
        }
      );
      if (!writeResult.success) {
        return {
          ok: false,
          reason: writeResult.reason ?? "write_failed",
          message: writeResult.reason ?? "workspace_write_failed"
        };
      }
      return {
        ok: true,
        mode: writeResult.data.mode,
        workspaceRelPath: writeResult.data.workspaceRelPath,
        sizeBytes: writeResult.data.bytes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `workspace_write_control_plane_failed workspace=${input.workspaceId} assistant=${input.assistantId} basename=${input.basename} error=${message}`
      );
      return {
        ok: false,
        reason: "write_failed",
        message
      };
    }
  }

  async removeWorkspaceFileFromHotPods(input: {
    workspaceId: string;
    path: string;
    policy?: RuntimeSandboxPolicy;
  }): Promise<{
    ok: true;
    removedFromPods: number;
    failures: Array<{ podName: string; reason: string }>;
  }> {
    const result = await this.execPodBridgeService.removeWorkspaceFileFromWarmPods({
      workspaceId: input.workspaceId,
      path: input.path,
      ...(input.policy === undefined ? {} : { policy: input.policy })
    });
    return {
      ok: true,
      removedFromPods: result.removedFromPods,
      failures: result.failures
    };
  }

  /**
   * ADR-128 Slice 4 / ADR-133 Slice 2 — synchronous control-plane write of
   * artifact bytes into the current assistant/session root (collision-aware).
   */
  async writeWorkspaceFile(input: {
    assistantId: string;
    workspaceId: string;
    assistantHandle?: string | null;
    siblingHandles?: readonly string[] | null;
    runtimeSessionId?: string | null;
    basename: string;
    contents: Buffer;
    mimeType: string;
    collisionStrategy?: "overwrite" | "numeric_suffix";
    policy?: RuntimeSandboxPolicy;
    workspaceQuotaBytes?: number | null;
    sharedQuotaBytes?: number | null;
  }): Promise<
    | { ok: true; workspaceRelPath: string; sizeBytes: number }
    | { ok: false; reason: string; message: string }
  > {
    const policy = input.policy ?? DEFAULT_RUNTIME_SANDBOX_POLICY;
    if (input.runtimeSessionId === null || input.runtimeSessionId === undefined) {
      return {
        ok: false,
        reason: "runtime_session_id_required",
        message: "workspace_write_runtime_session_id_required"
      };
    }
    const jobId = randomUUID();
    let leaseGuard: WorkspaceLeaseGuard | null = null;
    try {
      await this.prisma.sandboxJob.create({
        data: {
          id: jobId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          runtimeRequestId: `workspace-write:${jobId}`,
          toolCode: "workspace_write",
          status: "running",
          relativeWorkspace: ".",
          policySnapshot: this.toJsonValue(policy),
          requestPayload: this.toJsonValue({
            basename: input.basename,
            mimeType: input.mimeType,
            collisionStrategy: input.collisionStrategy ?? "numeric_suffix",
            bytes: input.contents.length
          }),
          startedAt: new Date()
        }
      });
      const leaseHandle = await this.waitForWorkspaceLease({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        sandboxJobId: jobId,
        waitTimeoutMs: this.resolveWorkspaceLeaseWaitTimeoutMs(policy)
      });
      leaseGuard = this.startWorkspaceLeaseHeartbeat(leaseHandle);
      const assistantHandle = await this.resolveAssistantHandle(
        input.assistantId,
        input.assistantHandle ?? null
      );
      const siblingHandles = await this.resolveSiblingHandles(
        input.workspaceId,
        input.assistantId,
        input.siblingHandles ?? null
      );
      const bridgeCtx: WorkspaceBridgeContext = {
        assistantId: input.assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId: input.workspaceId,
        runtimeSessionId: input.runtimeSessionId ?? null,
        defaultVisibleRoot: buildDefaultVisibleWorkspaceRoot(
          assistantHandle,
          input.runtimeSessionId ?? null
        ),
        policy,
        workspaceQuotaBytes: input.workspaceQuotaBytes ?? null,
        sharedQuotaBytes: input.sharedQuotaBytes ?? null
      };
      const writeResult = await this.workspaceFileBridgeService.writeWorkspaceFileWithCollision(
        bridgeCtx,
        {
          basename: input.basename,
          contents: input.contents,
          collisionStrategy: input.collisionStrategy ?? "numeric_suffix"
        }
      );
      if (!writeResult.success) {
        await this.prisma.sandboxJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            completedAt: new Date(),
            violationCode: writeResult.reason ?? "write_failed",
            violationMessage: writeResult.reason ?? "workspace_write_failed",
            resultPayload: {
              reason: writeResult.reason ?? "write_failed",
              warning: null,
              exitCode: null,
              stdout: null,
              stderr: null,
              content: null
            }
          }
        });
        return {
          ok: false,
          reason: writeResult.reason ?? "write_failed",
          message: writeResult.reason ?? "workspace_write_failed"
        };
      }
      await this.prisma.sandboxJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          resultPayload: {
            reason: null,
            warning: null,
            exitCode: 0,
            stdout: null,
            stderr: null,
            content: JSON.stringify({
              workspaceRelPath: writeResult.data.workspaceRelPath,
              sizeBytes: writeResult.data.bytes
            })
          }
        }
      });
      return {
        ok: true,
        workspaceRelPath: writeResult.data.workspaceRelPath,
        sizeBytes: writeResult.data.bytes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.sandboxJob
        .update({
          where: { id: jobId },
          data: {
            status: "failed",
            completedAt: new Date(),
            violationCode: "workspace_write_failed",
            violationMessage: message,
            resultPayload: {
              reason: "workspace_write_failed",
              warning: message,
              exitCode: null,
              stdout: null,
              stderr: null,
              content: null
            }
          }
        })
        .catch(() => {});
      return {
        ok: false,
        reason: "workspace_write_failed",
        message
      };
    } finally {
      if (leaseGuard !== null) {
        await this.stopWorkspaceLeaseHeartbeat(leaseGuard);
      }
    }
  }

  private async findJobRecord(jobId: string) {
    return await this.prisma.sandboxJob.findUnique({
      where: { id: jobId }
    });
  }

  private readProducedFilesFromJobPayload(
    payload: Record<string, unknown>
  ): RuntimeSandboxProducedFile[] {
    const raw = payload.producedFiles;
    if (!Array.isArray(raw)) {
      return [];
    }
    const files: RuntimeSandboxProducedFile[] = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const relativePath = typeof row.relativePath === "string" ? row.relativePath : null;
      const storagePath = typeof row.storagePath === "string" ? row.storagePath : null;
      const mimeType = typeof row.mimeType === "string" ? row.mimeType : null;
      if (relativePath === null || storagePath === null || mimeType === null) {
        continue;
      }
      const sizeBytes =
        typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes) ? row.sizeBytes : 0;
      const logicalSizeBytes =
        row.logicalSizeBytes === null
          ? null
          : typeof row.logicalSizeBytes === "number" && Number.isFinite(row.logicalSizeBytes)
            ? row.logicalSizeBytes
            : null;
      const displayName =
        typeof row.displayName === "string"
          ? row.displayName
          : row.displayName === null
            ? null
            : null;
      files.push({
        relativePath,
        displayName,
        mimeType,
        sizeBytes,
        logicalSizeBytes,
        storagePath
      });
    }
    return files;
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
    // A "running" job spans cold-start pod provisioning (node autoscale + image pull)
    // BEFORE the command itself runs, so the stale ceiling must include the provisioning
    // budget on top of the per-command runtime cap + grace. Without it, a cold start was
    // force-failed as sandbox_execution_timeout at ~30s even though the pod was still
    // legitimately coming up. Inline jobs (files/grep/glob) complete in ms and never
    // approach this ceiling, so the added slack only affects pod-spawning exec jobs.
    const maxRunningMs =
      this.config.SANDBOX_EXEC_POD_PROVISION_BUDGET_MS +
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

  private async failStalePendingJobsBeforeBacklogCount(
    request: RuntimeSandboxJobRequest
  ): Promise<void> {
    const pendingJobs = await this.prisma.sandboxJob.findMany({
      where: {
        OR: [
          {
            assistantId: request.assistantId,
            workspaceId: request.workspaceId
          },
          {
            status: {
              in: [...PENDING_SANDBOX_JOB_STATUSES]
            }
          }
        ],
        status: {
          in: [...PENDING_SANDBOX_JOB_STATUSES]
        }
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        toolCode: true,
        policySnapshot: true,
        createdAt: true,
        startedAt: true,
        completedAt: true
      }
    });
    await Promise.all(pendingJobs.map((job) => this.failStaleJobIfNeeded(job)));
  }

  private async resolvePreflightViolation(
    request: RuntimeSandboxJobRequest
  ): Promise<{ code: string; message: string } | null> {
    await this.failStalePendingJobsBeforeBacklogCount(request);

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
    if (
      request.runtimeSessionId !== null &&
      this.config.SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT >= 1
    ) {
      // Fire-and-forget: pre-create the session pod so its provisioning overlaps lease wait.
      // The subsequent runInSessionPod call is idempotent and will reuse this pod.
      // Resolve the handle eagerly so the bootstrap script can create the
      // assistant outbound directory in parallel with the cold-start workspace push.
      void this.resolveAssistantHandle(request.assistantId, request.assistantHandle ?? null)
        .then((assistantHandle) =>
          this.execPodBridgeService.warmSessionPod({
            assistantId: request.assistantId,
            assistantHandle,
            workspaceId: request.workspaceId,
            policy: request.policy
          })
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `sandbox_warm_pool_failed assistantId=${request.assistantId} workspaceId=${request.workspaceId} error=${error instanceof Error ? error.message : String(error)}`
          );
        });
    }

    let leaseGuard: WorkspaceLeaseGuard | null = null;
    let workspaceRoot: string | null = null;
    let currentRoot: string | null = null;
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
      this.assertWorkspaceLeaseActive(leaseGuard);
      const assistantHandle = await this.resolveAssistantHandle(
        request.assistantId,
        request.assistantHandle ?? null
      );
      const defaultVisibleRoot = buildDefaultVisibleWorkspaceRoot(
        assistantHandle,
        request.runtimeSessionId ?? null
      );
      workspaceRoot = this.resolveWorkspaceRoot(request.workspaceId);
      currentRoot = this.resolveVisiblePathWithinWorkspaceRoot(workspaceRoot, defaultVisibleRoot);
      await this.ensureWorkspaceSessionReady(
        workspaceRoot,
        currentRoot,
        request.assistantId,
        request.runtimeSessionId ?? null
      );
      this.assertWorkspaceLeaseActive(leaseGuard);
      const baselineWorkspaceStats = await this.computeWorkspaceStats(workspaceRoot);

      // ADR-126 Slice 3 — resolve the handle + sibling handles once per job so
      // every downstream pod-exec call (runInPod, render_html_to_pdf, doc-code)
      // can bootstrap the shared-mount subtree deterministically.
      const siblingHandles = await this.resolveSiblingHandles(
        request.workspaceId,
        request.assistantId,
        request.siblingHandles ?? null
      );

      const result = await this.executeTool({
        workspaceRoot,
        currentRoot,
        request,
        jobId,
        leaseGuard,
        assistantHandle,
        defaultVisibleRoot,
        siblingHandles
      });
      this.assertWorkspaceLeaseActive(leaseGuard);

      const stats = await this.computeWorkspaceStats(workspaceRoot);
      this.assertWorkspaceLeaseActive(leaseGuard);
      this.assertWorkspaceStats(stats, request.policy, baselineWorkspaceStats);

      if (request.runtimeSessionId !== null && request.runtimeSessionId !== undefined) {
        await this.saveSessionWorkspaceSnapshot(
          request.assistantId,
          request.runtimeSessionId,
          currentRoot
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
            content: this.stripNulCharactersNullable(result.content),
            producedFiles: this.toJsonValue(result.producedFiles ?? [])
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
      if (workspaceRoot !== null && currentRoot !== null) {
        await this.resetWorkspaceSessionOnFailure(
          request.assistantId,
          workspaceRoot,
          currentRoot,
          request.runtimeSessionId ?? null
        );
      }
    } finally {
      await this.stopWorkspaceLeaseHeartbeat(leaseGuard);
    }
  }

  private async executeTool(input: {
    workspaceRoot: string;
    currentRoot: string;
    request: RuntimeSandboxJobRequest;
    jobId: string;
    leaseGuard: WorkspaceLeaseGuard;
    assistantHandle: string;
    defaultVisibleRoot: string;
    siblingHandles: readonly string[];
  }): Promise<SandboxToolExecutionResult> {
    this.assertWorkspaceLeaseActive(input.leaseGuard);
    const bridgeCtx: WorkspaceBridgeContext = {
      assistantId: input.request.assistantId,
      assistantHandle: input.assistantHandle,
      siblingHandles: input.siblingHandles,
      workspaceId: input.request.workspaceId,
      runtimeSessionId: input.request.runtimeSessionId ?? null,
      defaultVisibleRoot: input.defaultVisibleRoot,
      policy: input.request.policy,
      workspaceQuotaBytes: input.request.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: input.request.sharedQuotaBytes ?? null
    };
    switch (input.request.toolCode) {
      case "files": {
        return this.executeFilesBridgeAction(bridgeCtx, input.request.args);
      }
      case "grep":
        return this.executeGrepActionViaPodExec(bridgeCtx, input.request.args);
      case "glob":
        return this.executeGlobActionViaPodExec(bridgeCtx, input.request.args);
      case "exec":
        return this.executeExecLike(
          input.workspaceRoot,
          input.currentRoot,
          input.request.args,
          input.request.policy,
          false,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null,
          input.request.assistantId,
          input.assistantHandle,
          input.siblingHandles,
          input.request.workspaceId
        );
      case "shell":
        return this.executeExecLike(
          input.workspaceRoot,
          input.currentRoot,
          input.request.args,
          input.request.policy,
          true,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null,
          input.request.assistantId,
          input.assistantHandle,
          input.siblingHandles,
          input.request.workspaceId
        );
      case "render_html_to_pdf":
        return this.executeRenderHtmlToPdf(
          input.workspaceRoot,
          input.currentRoot,
          input.request.args,
          input.request.policy,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null,
          input.request.assistantId,
          input.assistantHandle,
          input.siblingHandles,
          input.request.workspaceId
        );
      case "execute_document_code":
        return this.executeDocumentCode(
          input.workspaceRoot,
          input.currentRoot,
          input.request.args,
          input.request.policy,
          input.leaseGuard,
          input.jobId,
          input.request.runtimeSessionId ?? null,
          input.request.assistantId,
          input.assistantHandle,
          input.siblingHandles,
          input.request.workspaceId
        );
      default:
        this.throwPolicy(
          "tool_not_supported",
          `Unsupported sandbox tool "${input.request.toolCode}".`
        );
    }
  }

  /**
   * ADR-126 Slice 3 — unified files bridge dispatcher. Routes the five
   * model-facing actions (list, read, stat, write, delete) to the
   * WorkspaceFileBridgeService primitives and translates the result into the
   * dispatcher return shape expected by executeQueuedJob. Content JSON shapes
   * match the parsers in runtime-files-tool.service.ts exactly.
   */
  private async executeFilesBridgeAction(
    bridgeCtx: WorkspaceBridgeContext,
    args: Record<string, unknown>
  ): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
  }> {
    const action = typeof args.action === "string" ? args.action : null;
    if (
      action !== "list" &&
      action !== "read" &&
      action !== "stat" &&
      action !== "write" &&
      action !== "resolve_write_path" &&
      action !== "delete" &&
      action !== "attach"
    ) {
      return {
        reason: "unsupported_action",
        warning: `Unsupported files action: ${String(action)}`,
        exitCode: null,
        stdout: null,
        stderr: null,
        content: null
      };
    }
    try {
      if (action === "list") {
        const path =
          typeof args.path === "string" && args.path.trim().length > 0
            ? args.path.trim()
            : bridgeCtx.defaultVisibleRoot;
        const result = await this.workspaceFileBridgeService.workspaceFileList(bridgeCtx, {
          path
        });
        if (!result.success) {
          return {
            reason: result.reason,
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        const includeHidden = args.includeHidden === true;
        const NOISE_BASENAMES = new Set([
          "node_modules",
          ".venv",
          ".local",
          ".npm-global",
          ".cache",
          "__pycache__"
        ]);
        const NOISE_EXT = /\.(pyc|log|lock|tmp)$/;
        let entries = result.data;
        if (!includeHidden) {
          entries = entries.filter((entry) => {
            const bname = entry.path.split("/").pop() ?? "";
            if (NOISE_BASENAMES.has(bname)) return false;
            if (bname.startsWith(".")) return false;
            if (NOISE_EXT.test(bname)) return false;
            return true;
          });
        }
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.path.localeCompare(b.path);
        });
        const items = entries.map((entry) => ({
          path: entry.path,
          type: entry.type,
          sizeBytes: entry.sizeBytes,
          mimeType: this.mimeTypeFromPath(entry.path),
          modifiedAt: entry.modifiedAt
        }));
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({ items })
        };
      }

      if (action === "read") {
        const path = this.requireString(args.path, "path");
        const maxBytes = this.optionalPositiveInteger(args.maxBytes, "maxBytes");
        const result = await this.workspaceFileBridgeService.workspaceFileRead(bridgeCtx, {
          path,
          ...(maxBytes === undefined ? {} : { maxBytes })
        });
        if (!result.success || result.data === null) {
          return {
            reason: result.reason,
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        const content = this.stripNulCharacters(result.data.bytes.toString("utf8"));
        const sha256 = createHash("sha256").update(result.data.bytes).digest("hex");
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({
            content,
            sizeBytes: result.data.bytes.length,
            sha256,
            truncated: result.data.truncated
          })
        };
      }

      if (action === "stat") {
        const path = this.requireString(args.path, "path");
        const result = await this.workspaceFileBridgeService.workspaceFileStat(bridgeCtx, {
          path
        });
        if (!result.success) {
          return {
            reason: result.reason,
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({
            sizeBytes: result.data.type === "missing" ? 0 : result.data.sizeBytes,
            mimeType:
              result.data.type === "missing" ? null : this.mimeTypeFromPath(result.data.path)
          })
        };
      }

      if (action === "write") {
        const path = this.requireString(args.path, "path");
        const contentStr = this.requireString(args.content, "content");
        const mode: "overwrite" | "create_only" | undefined =
          args.mode === "create_only"
            ? "create_only"
            : args.mode === "overwrite"
              ? "overwrite"
              : undefined;
        const replace = args.replace === true;
        const contents = Buffer.from(contentStr, "utf8");
        const result = await this.workspaceFileBridgeService.workspaceFileWrite(bridgeCtx, {
          path,
          contents,
          ...(mode === undefined ? {} : { mode }),
          replace
        });
        if (!result.success) {
          return {
            reason: result.reason,
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({
            sizeBytes: result.data.bytes,
            resolvedPath: result.data.resolvedPath
          })
        };
      }

      if (action === "resolve_write_path") {
        const path = this.requireString(args.path, "path");
        const result = await this.workspaceFileBridgeService.resolveWorkspaceWritePath(bridgeCtx, {
          path,
          replace: args.replace === true
        });
        if (!result.success) {
          return {
            reason: result.reason,
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({ resolvedPath: result.data.resolvedPath })
        };
      }

      if (action === "attach") {
        // ADR-133 Slice 2: `files.attach` is a thin wrapper that confirms the
        // file lives under the visible `/workspace/...` tree and surfaces it to
        // the assistant message as an attachment. The sandbox does not invent a
        // second delivery root here: if the path is addressable under
        // `/workspace/...`, attach persists that exact file.
        const path = this.requireString(args.path, "path");
        let sourceResolved;
        try {
          sourceResolved = assertAllowedMountPrefix(path);
        } catch (error) {
          if (error instanceof WorkspacePathError) {
            return {
              reason: "path_not_attachable",
              warning: "files.attach accepts only paths under /workspace/",
              exitCode: null,
              stdout: null,
              stderr: null,
              content: null
            };
          }
          throw error;
        }
        const statResult = await this.workspaceFileBridgeService.workspaceFileStat(bridgeCtx, {
          path: sourceResolved.absolutePath
        });
        if (!statResult.success || statResult.data.type !== "file") {
          return {
            reason: statResult.reason ?? "path_not_found",
            warning: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        const workspaceRelPath = sourceResolved.absolutePath;
        const mimeType =
          this.mimeTypeFromPath(sourceResolved.absolutePath) ?? "application/octet-stream";
        const displayName = pathPosix.basename(workspaceRelPath);
        const persistResult = await this.workspaceFileBridgeService.workspaceFilePersist(
          bridgeCtx,
          {
            path: sourceResolved.absolutePath,
            mimeType
          }
        );
        if (!persistResult.success) {
          return {
            reason: persistResult.reason ?? "files_attach_failed",
            warning: `files.attach could not persist ${sourceResolved.absolutePath} for delivery.`,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          };
        }
        return {
          reason: null,
          warning: null,
          exitCode: 0,
          stdout: null,
          stderr: null,
          content: JSON.stringify({
            action: "attached",
            attachment: {
              workspaceRelPath,
              sourcePath: path,
              sizeBytes: statResult.data.sizeBytes,
              mimeType,
              displayName
            }
          })
        };
      }

      // action === "delete"
      const path = this.requireString(args.path, "path");
      const recursive = args.recursive === true;
      const result = await this.workspaceFileBridgeService.workspaceFileDelete(bridgeCtx, {
        path,
        recursive
      });
      if (!result.success) {
        return {
          reason: result.reason,
          warning: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null
        };
      }
      return {
        reason: null,
        warning: null,
        exitCode: 0,
        stdout: null,
        stderr: null,
        content: JSON.stringify({})
      };
    } catch (error) {
      if (error instanceof WorkspacePathError) {
        return {
          reason: error.code,
          warning: error.message,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null
        };
      }
      throw error;
    }
  }

  /**
   * Derive a MIME type from a path's file extension using a small inline map.
   * Returns null for unknown extensions.
   */
  private mimeTypeFromPath(path: string): string | null {
    const dotIdx = path.lastIndexOf(".");
    if (dotIdx < 0) return null;
    const ext = path.slice(dotIdx).toLowerCase();
    const MAP: Record<string, string> = {
      ".txt": "text/plain",
      ".csv": "text/csv",
      ".json": "application/json",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
    return MAP[ext] ?? null;
  }

  /**
   * ADR-126 Slice 3 — grep via pod exec. Runs rg inside the session pod via
   * execShellInSessionPod using a quoted shell command, so the model pattern
   * never touches a control-plane process. Path containment is enforced by
   * assertAllowedMountPrefix before the command is composed.
   */
  private async executeGrepActionViaPodExec(
    bridgeCtx: WorkspaceBridgeContext,
    args: Record<string, unknown>
  ): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
  }> {
    const pattern = this.requireString(args.pattern, "pattern");
    const maxMatches = 200;
    const lineByteCap = 2_000;

    const rawPath =
      typeof args.path === "string" && args.path.trim().length > 0
        ? args.path.trim()
        : bridgeCtx.defaultVisibleRoot;
    let containedPath: string;
    try {
      const resolved = assertAllowedMountPrefix(rawPath);
      containedPath = resolved.absolutePath;
    } catch (error) {
      if (error instanceof WorkspacePathError) {
        return {
          reason: error.code,
          warning: error.message,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: JSON.stringify({ matches: [], matchCount: 0, truncated: false })
        };
      }
      throw error;
    }

    const parts: string[] = [
      "rg",
      "--line-number",
      "--no-heading",
      "--color=never",
      "--max-count",
      String(maxMatches + 1)
    ];
    if (args.caseInsensitive === true) {
      parts.push("--ignore-case");
    }
    if (typeof args.contextLines === "number" && Number.isInteger(args.contextLines)) {
      const ctx = Math.min(Math.max(args.contextLines, 0), 10);
      if (ctx > 0) {
        parts.push("--context", String(ctx));
      }
    }
    if (typeof args.glob === "string" && args.glob.trim().length > 0) {
      parts.push("--glob", sandboxPosixSingleQuote(args.glob.trim()));
    }
    if (typeof args.type === "string" && args.type.trim().length > 0) {
      parts.push("--type", sandboxPosixSingleQuote(args.type.trim()));
    }
    parts.push("--", sandboxPosixSingleQuote(pattern), sandboxPosixSingleQuote(containedPath));

    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: bridgeCtx.assistantId,
      assistantHandle: bridgeCtx.assistantHandle,
      siblingHandles: bridgeCtx.siblingHandles,
      workspaceId: bridgeCtx.workspaceId,
      policy: bridgeCtx.policy,
      shellCommand: parts.join(" "),
      stdin: null
    });

    // rg exit code 1 = no matches (not an error); 2+ = real error.
    if (podResult.exitCode !== 0 && podResult.exitCode !== 1) {
      const firstStderrLine =
        (podResult.stderr ?? "")
          .split("\n")
          .find((line) => line.trim().length > 0)
          ?.trim() ?? null;
      return {
        reason: "grep_failed",
        warning: firstStderrLine,
        exitCode: podResult.exitCode,
        stdout: null,
        stderr: (podResult.stderr ?? "").slice(0, bridgeCtx.policy.maxStderrBytes),
        content: JSON.stringify({ matches: [], matchCount: 0, truncated: false })
      };
    }

    const matches = this.parseRipgrepMatchesPod(podResult.stdout ?? "", lineByteCap);
    const truncated = matches.length > maxMatches;
    const cappedMatches = matches.slice(0, maxMatches);
    return {
      reason: null,
      warning: null,
      exitCode: 0,
      stdout: null,
      stderr: null,
      content: JSON.stringify({
        matches: cappedMatches,
        matchCount: cappedMatches.length,
        truncated
      })
    };
  }

  /**
   * Parse `rg --line-number --no-heading` output from a pod exec invocation.
   * Unlike the legacy control-plane parser, paths are kept as pod-absolute
   * (e.g. `/workspace/src/app.ts`) since the new files contract is path-based.
   */
  private parseRipgrepMatchesPod(
    stdout: string,
    lineByteCap: number
  ): Array<{ file: string; line: number; text: string }> {
    const result: Array<{ file: string; line: number; text: string }> = [];
    for (const rawLine of stdout.split("\n")) {
      if (rawLine.length === 0) continue;
      const firstColon = rawLine.indexOf(":");
      if (firstColon <= 0) continue;
      const secondColon = rawLine.indexOf(":", firstColon + 1);
      if (secondColon <= firstColon) continue;
      const filePart = rawLine.slice(0, firstColon);
      const lineNumberPart = rawLine.slice(firstColon + 1, secondColon);
      const lineNumber = Number.parseInt(lineNumberPart, 10);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      const text = rawLine.slice(secondColon + 1);
      result.push({
        file: filePart,
        line: lineNumber,
        text: this.stripNulCharacters(text).slice(0, lineByteCap)
      });
    }
    return result;
  }

  /**
   * ADR-126 Slice 3 — glob via pod exec. Runs fd inside the session pod via
   * execShellInSessionPod. Path containment is enforced before command
   * composition. Output paths are pod-absolute (e.g. `/workspace/src/app.ts`).
   */
  private async executeGlobActionViaPodExec(
    bridgeCtx: WorkspaceBridgeContext,
    args: Record<string, unknown>
  ): Promise<{
    reason: string | null;
    warning: string | null;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    content: string | null;
  }> {
    const pattern = this.requireString(args.pattern, "pattern");
    const maxPaths = 500;

    const rawPath =
      typeof args.path === "string" && args.path.trim().length > 0
        ? args.path.trim()
        : bridgeCtx.defaultVisibleRoot;
    let containedPath: string;
    try {
      const resolved = assertAllowedMountPrefix(rawPath);
      containedPath = resolved.absolutePath;
    } catch (error) {
      if (error instanceof WorkspacePathError) {
        return {
          reason: error.code,
          warning: error.message,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: JSON.stringify({ paths: [], truncated: false })
        };
      }
      throw error;
    }

    const shellCommand = [
      "fd",
      "--type",
      "f",
      "--color",
      "never",
      "--glob",
      "--max-results",
      String(maxPaths + 1),
      "--",
      sandboxPosixSingleQuote(pattern),
      sandboxPosixSingleQuote(containedPath)
    ].join(" ");

    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: bridgeCtx.assistantId,
      assistantHandle: bridgeCtx.assistantHandle,
      siblingHandles: bridgeCtx.siblingHandles,
      workspaceId: bridgeCtx.workspaceId,
      policy: bridgeCtx.policy,
      shellCommand,
      stdin: null
    });

    if (podResult.exitCode !== 0) {
      const firstStderrLine =
        (podResult.stderr ?? "")
          .split("\n")
          .find((line) => line.trim().length > 0)
          ?.trim() ?? null;
      return {
        reason: "glob_failed",
        warning: firstStderrLine,
        exitCode: podResult.exitCode,
        stdout: null,
        stderr: (podResult.stderr ?? "").slice(0, bridgeCtx.policy.maxStderrBytes),
        content: JSON.stringify({ paths: [], truncated: false })
      };
    }

    const paths = (podResult.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort((a, b) => a.localeCompare(b));
    const truncated = paths.length > maxPaths;
    const cappedPaths = paths.slice(0, maxPaths);
    return {
      reason: null,
      warning: null,
      exitCode: 0,
      stdout: null,
      stderr: null,
      content: JSON.stringify({ paths: cappedPaths, truncated })
    };
  }

  private async executeExecLike(
    workspaceRoot: string,
    currentRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    shellMode: boolean,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null,
    assistantId: string,
    assistantHandle: string,
    siblingHandles: readonly string[],
    workspaceId: string
  ) {
    const cwd = args.cwd === undefined ? "." : this.requireRelativePath(args.cwd, "cwd");
    const absoluteCwd = cwd === "." ? currentRoot : this.resolveWorkspacePath(currentRoot, cwd);
    await fs.mkdir(absoluteCwd, { recursive: true });

    this.assertWorkspaceLeaseActive(leaseGuard);

    if (shellMode) {
      const command = this.requireString(args.command, "command");
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd,
        command: "/bin/bash",
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
      assistantId,
      assistantHandle,
      siblingHandles,
      workspaceId,
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
    currentRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null,
    assistantId: string,
    assistantHandle: string,
    siblingHandles: readonly string[],
    workspaceId: string
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
    const inputAbsolutePath = this.resolveWorkspacePath(currentRoot, inputRelativePath);
    const outputAbsolutePath = this.resolveDocumentToolTargetPath(
      workspaceRoot,
      currentRoot,
      outputFileName
    );
    await fs.writeFile(inputAbsolutePath, htmlContent, "utf8");
    const podInputPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, inputAbsolutePath);
    const podOutputPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, outputAbsolutePath);

    try {
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd: currentRoot,
        command: "weasyprint",
        args: [podInputPath, podOutputPath],
        policy
      });
      if (result.exitCode !== 0) {
        return {
          reason: "process_failed",
          warning: null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          content: null,
          durationMs: result.durationMs,
          execPodName: result.execPodName
        };
      }
      const producedFiles = [
        await this.stageSandboxJobArtifact({
          assistantId,
          jobId,
          workspaceRoot,
          currentRoot,
          absolutePath: outputAbsolutePath,
          relativePath: outputFileName,
          leaseGuard
        })
      ];
      return {
        reason: null,
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        producedFiles
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
   * - `args.sourceMounts: [{ storagePath, mountPath }]` — bytes are pulled from
   *   the canonical shared GCS key for `storagePath` and written into the
   *   deterministic worker-chosen `mountPath` (e.g. sources/<name>).
   * - `args.textSidecars: [{ mountPath, text }]` — OCR/extracted text sidecars
   *   (Tier 2) written verbatim into the workspace.
   * All transient source copies/sidecars + the program file live under
   * /workspace/sources and /workspace/.document-code.py and are removed in the
   * `finally` block so only the produced output file is collected.
   */
  private async executeDocumentCode(
    workspaceRoot: string,
    currentRoot: string,
    args: Record<string, unknown>,
    policy: RuntimeSandboxPolicy,
    leaseGuard: WorkspaceLeaseGuard,
    jobId: string,
    runtimeSessionId: string | null,
    assistantId: string,
    assistantHandle: string,
    siblingHandles: readonly string[],
    workspaceId: string
  ): Promise<SandboxToolExecutionResult> {
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
    const programAbsolutePath = this.resolveWorkspacePath(currentRoot, programRelativePath);
    const sourcesDirAbsolute = this.resolveWorkspacePath(currentRoot, "sources");

    try {
      // Materialize Tier 1 source copies into deterministic mount paths.
      const sourceMounts = this.readDocumentCodeSourceMounts(args.sourceMounts);
      for (const mount of sourceMounts) {
        const buffer = await this.downloadWorkspaceStoragePathBytes(workspaceId, mount.storagePath);
        const targetAbsolute = this.resolveWorkspacePath(currentRoot, mount.mountPath);
        await fs.mkdir(dirname(targetAbsolute), { recursive: true });
        await fs.writeFile(targetAbsolute, buffer);
      }

      // Materialize Tier 2 OCR/extracted-text sidecars.
      const textSidecars = this.readDocumentCodeTextSidecars(args.textSidecars);
      for (const sidecar of textSidecars) {
        const targetAbsolute = this.resolveWorkspacePath(currentRoot, sidecar.mountPath);
        await fs.mkdir(dirname(targetAbsolute), { recursive: true });
        await fs.writeFile(targetAbsolute, sidecar.text, "utf8");
      }

      await fs.writeFile(programAbsolutePath, programSource, "utf8");
      const podProgramPath = this.toVisibleWorkspaceAbsolutePath(
        workspaceRoot,
        programAbsolutePath
      );

      const outputAbsolutePath = this.resolveDocumentToolTargetPath(
        workspaceRoot,
        currentRoot,
        outputFileName
      );
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd: currentRoot,
        command: "python3",
        args: [podProgramPath],
        policy
      });
      if (result.exitCode !== 0) {
        return {
          reason: "process_failed",
          warning: null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          content: null,
          durationMs: result.durationMs,
          execPodName: result.execPodName
        };
      }
      const producedFiles = [
        await this.stageSandboxJobArtifact({
          assistantId,
          jobId,
          workspaceRoot,
          currentRoot,
          absolutePath: outputAbsolutePath,
          relativePath: outputFileName,
          leaseGuard
        })
      ];
      return {
        reason: null,
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        producedFiles
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
  ): Array<{ storagePath: string; mountPath: string }> {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.throwPolicy("invalid_arguments", "execute_document_code sourceMounts must be an array.");
    }
    const mounts: Array<{ storagePath: string; mountPath: string }> = [];
    for (const entry of value as unknown[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        this.throwPolicy(
          "invalid_arguments",
          "execute_document_code sourceMounts[] must be objects."
        );
      }
      const row = entry as Record<string, unknown>;
      const storagePath = this.requireString(row.storagePath, "sourceMounts[].storagePath");
      const mountPath = this.requireRelativePath(row.mountPath, "sourceMounts[].mountPath");
      mounts.push({ storagePath, mountPath });
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

  /**
   * ADR-126 Slice 3 — resolve the assistant handle for an in-flight sandbox
   * job. The runtime worker may supply the handle on the request (the new
   * contract field is optional during the staged rollout); when absent the
   * sandbox falls back to a single Assistant lookup, cached on the Prisma
   * query layer.
   */
  private async resolveAssistantHandle(
    assistantId: string,
    suppliedHandle: string | null
  ): Promise<string> {
    if (suppliedHandle !== null && suppliedHandle.trim().length > 0) {
      return suppliedHandle;
    }
    const fallback = `a-${assistantId.replace(/-/g, "").slice(0, 8)}`;
    try {
      const row = await this.prisma.assistant.findUnique({
        where: { id: assistantId },
        select: { handle: true }
      });
      if (row === null || row.handle.length === 0) {
        return fallback;
      }
      return row.handle;
    } catch (error) {
      this.logger.warn(
        `sandbox_resolve_assistant_handle_failed assistant_id=${assistantId} reason=${error instanceof Error ? error.message : String(error)}`
      );
      return fallback;
    }
  }

  /**
   * Resolve sibling assistant handles. Retained as a passthrough piece of pod
   * context for tools that still want the list (e.g. bash environment hints);
   * after ADR-133 Slice 2 the visible workspace root/default session root is
   * derived from `assistantHandle` + `runtimeSessionId`, not from any sibling
   * classification scheme.
   */
  private async resolveSiblingHandles(
    workspaceId: string,
    selfAssistantId: string,
    suppliedSiblings: readonly string[] | null
  ): Promise<readonly string[]> {
    if (suppliedSiblings !== null) {
      return suppliedSiblings;
    }
    try {
      const rows = await this.prisma.assistant.findMany({
        where: {
          workspaceId,
          NOT: { id: selfAssistantId }
        },
        select: { handle: true }
      });
      return rows.map((r) => r.handle);
    } catch (error) {
      this.logger.warn(
        `sandbox_resolve_sibling_handles_failed workspace_id=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private resolveWorkspaceRoot(workspaceId: string): string {
    return join(tmpdir(), "persai-sandbox", "workspaces", workspaceId, "workspace");
  }

  private resolveVisiblePathWithinWorkspaceRoot(
    workspaceRoot: string,
    visiblePath: string
  ): string {
    const resolved = normalizeAndClampPath(WORKSPACE_MOUNT_ROOT, visiblePath);
    const segments = resolved.relativePath.length === 0 ? [] : resolved.relativePath.split("/");
    return segments.length === 0 ? workspaceRoot : join(workspaceRoot, ...segments);
  }

  private toVisibleWorkspaceAbsolutePath(workspaceRoot: string, absolutePath: string): string {
    const workspaceRootResolved = resolve(workspaceRoot);
    const absoluteResolved = resolve(absolutePath);
    const relativePath = relative(workspaceRootResolved, absoluteResolved);
    if (
      relativePath.length === 0 ||
      relativePath === "." ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath === ".."
    ) {
      return WORKSPACE_MOUNT_ROOT;
    }
    const normalizedRelative = relativePath.split(sep).join("/");
    return `${WORKSPACE_MOUNT_ROOT}/${normalizedRelative}`;
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

  private async ensureWorkspaceSessionReady(
    workspaceRoot: string,
    currentRoot: string,
    assistantId: string,
    runtimeSessionId: string | null
  ): Promise<void> {
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(currentRoot, { recursive: true });
    if (runtimeSessionId !== null) {
      await this.restoreSessionSnapshotOverlay(assistantId, runtimeSessionId, currentRoot);
    }
  }

  private async resetWorkspaceSessionOnFailure(
    assistantId: string,
    workspaceRoot: string,
    currentRoot: string,
    runtimeSessionId: string | null
  ): Promise<void> {
    await fs.rm(currentRoot, { recursive: true, force: true });
    await this.ensureWorkspaceSessionReady(
      workspaceRoot,
      currentRoot,
      assistantId,
      runtimeSessionId
    );
  }

  private async downloadWorkspaceStoragePathBytes(
    workspaceId: string,
    storagePath: string
  ): Promise<Buffer> {
    const objectKey = this.objectStorage.buildWorkspaceObjectKey({
      workspaceId,
      workspaceRelPath: storagePath
    });
    try {
      return await this.objectStorage.downloadObject(objectKey);
    } catch (error) {
      if (this.isMissingObjectStorageError(error)) {
        this.throwPolicy(
          "storage_path_not_found",
          `Workspace storage path "${storagePath}" is not available in object storage.`
        );
      }
      throw error;
    }
  }

  private async stageSandboxJobArtifact(input: {
    assistantId: string;
    jobId: string;
    workspaceRoot: string;
    currentRoot: string;
    absolutePath?: string;
    relativePath: string;
    leaseGuard: WorkspaceLeaseGuard;
  }): Promise<RuntimeSandboxProducedFile> {
    this.assertWorkspaceLeaseActive(input.leaseGuard);
    const absolutePath =
      input.absolutePath ?? this.resolveWorkspacePath(input.currentRoot, input.relativePath);
    const buffer = await fs.readFile(absolutePath);
    const mimeType = this.inferMimeType(input.relativePath);
    if (buffer.length > 0) {
      const objectKey = this.objectStorage.buildSandboxObjectKey({
        assistantId: input.assistantId,
        jobId: input.jobId,
        relativePath: input.relativePath
      });
      await this.objectStorage.saveObject({
        objectKey,
        buffer,
        mimeType
      });
      return {
        relativePath: input.relativePath,
        displayName: basename(input.relativePath),
        mimeType,
        sizeBytes: buffer.length,
        logicalSizeBytes: buffer.length,
        storagePath: objectKey
      };
    }
    return {
      relativePath: input.relativePath,
      displayName: basename(input.relativePath),
      mimeType,
      sizeBytes: 0,
      logicalSizeBytes: 0,
      storagePath: ""
    };
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
   * Only files NOT already present on disk are written (copy-if-absent semantics).
   * Missing snapshot (first session) is handled gracefully.
   */
  private async restoreSessionSnapshotOverlay(
    assistantId: string,
    runtimeSessionId: string,
    workspaceRoot: string
  ): Promise<void> {
    const objectKey = this.objectStorage.buildSessionSnapshotKey({ assistantId, runtimeSessionId });
    const startedAt = Date.now();
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
      this.sandboxObservabilityService.recordSnapshotColdPull("session", Date.now() - startedAt);
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
   * Overlay a tar archive onto a directory, restoring only files that do not already exist.
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
        // ADR-128 Slice 4 defense-in-depth: use `lstat` so any symlink (e.g.
        // restored from a pre-flat session snapshot whose target now dangles
        // on the control-plane filesystem) is measured by the link itself
        // and not by its resolved target. Following the symlink to a missing
        // target previously threw ENOENT and crashed the entire shell turn
        // before it ever reached the pod.
        const stat = await fs.lstat(absolutePath);
        if (stat.isSymbolicLink()) {
          fileCount++;
          continue;
        }
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

  private resolveDocumentToolTargetPath(
    workspaceRoot: string,
    currentRoot: string,
    relativePath: string
  ): string {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.startsWith("assistants/") || normalized.startsWith("shared/")) {
      return this.resolveWorkspacePath(workspaceRoot, normalized);
    }
    return this.resolveWorkspacePath(currentRoot, normalized);
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

  private optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw this.createPolicyError("invalid_arguments", `${fieldName} must be a positive integer.`);
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
