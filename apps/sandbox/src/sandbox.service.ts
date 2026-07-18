import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, extname, basename, isAbsolute, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { Inject, Injectable, Logger } from "@nestjs/common";
import Ajv2020 from "ajv/dist/2020.js";
import type { SandboxConfig } from "@persai/config";
import {
  SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxJobResult,
  type RuntimeSandboxPolicy,
  type RuntimeSandboxProducedFile,
  type RuntimeScriptBrowserSdkRequest
} from "@persai/runtime-contract";
import {
  classifyVisibleWorkspacePath,
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  isSessionInstallLayerPath
} from "@persai/runtime-contract";
import { Prisma } from "@prisma/client";
import { SANDBOX_CONFIG } from "./sandbox-config";
import {
  ExecPodBridgeService,
  type ExecPodJobBinding,
  type SessionPodStagingFile
} from "./exec-pod-bridge.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import {
  WorkspaceFileBridgeService,
  type WorkspaceBridgeContext
} from "./workspace-file-bridge.service";
import { mirrorVisibleWorkspaceProducedFilesToGcs } from "./workspace-produced-gcs-mirror";
import {
  buildSessionInstallLayerTarExcludeArgs,
  purgeSessionInstallLayerTrees
} from "./session-install-layer-tar";
import {
  buildShellProducedFilesFromDocumentDiff,
  collectWorkspaceDocumentOutputSnapshots
} from "./shell-document-output-diff";
import {
  buildDefaultVisibleWorkspaceRoot,
  normalizeAndClampPath,
  WORKSPACE_MOUNT_ROOT
} from "./workspace-path";
import {
  isSessionDependencyVisiblePath,
  SESSION_DEPENDENCY_CONTOUR_LIMITS
} from "./session-runtime-contour";
import {
  buildScriptExecutionShellCommand,
  buildScriptResultMarker,
  computeScriptExecutableContentHash,
  computeScriptInputHash,
  parseScriptExecutionResultJson,
  parseSandboxScriptManifest,
  reconcileScriptSandboxPolicy,
  resolveEffectiveScriptOutputBytes,
  splitScriptExecutionStdout,
  type SandboxScriptVersionArtifact
} from "./script-execution-support";
import { ScriptBrowserBrokerService } from "./script-browser-broker.service";
import { ScriptBrowserFrameDecoder } from "./script-browser-frame";
import { ScriptBrowserResponseLifecycle } from "./script-browser-response-lifecycle";

const scriptSchemaValidator = new Ajv2020({
  strict: true,
  strictSchema: true,
  allErrors: true,
  validateSchema: true
});

type WorkspaceStats = {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
};

type WorkspaceTreeEntry = {
  kind: "file" | "directory";
  sizeBytes: number;
};

type WorkspacePolicyDelta = {
  addedFileCount: number;
  addedDirectoryCount: number;
  addedBytes: number;
};

const EMPTY_WORKSPACE_POLICY_DELTA: WorkspacePolicyDelta = {
  addedFileCount: 0,
  addedDirectoryCount: 0,
  addedBytes: 0
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
  execPodBinding?: ExecPodJobBinding | undefined;
  detached?: boolean;
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
  podBinding: ExecPodJobBinding | null;
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
  private readonly activeJobAbortControllers = new Map<string, AbortController>();
  private readonly activeJobBindings = new Map<
    string,
    {
      binding: ExecPodJobBinding;
      runtimeSessionId: string | null;
      processCleanupStarted: boolean;
      supervisedProcess: boolean;
    }
  >();
  private readonly sandboxInstanceHolderId = `${hostname()}:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly prisma: SandboxPrismaService,
    private readonly objectStorage: SandboxObjectStorageService,
    private readonly sandboxObservabilityService: SandboxObservabilityService,
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig,
    private readonly execPodBridgeService: ExecPodBridgeService,
    private readonly workspaceFileBridgeService: WorkspaceFileBridgeService,
    private readonly scriptBrowserBrokerService: ScriptBrowserBrokerService
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
    if (request.toolCode === "script.execute") {
      return this.submitScriptExecuteJob(request);
    }
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

  /**
   * ADR-151 — `script.execute` admission is atomic-create-by-`(assistantId,
   * scriptInvocationKey)` BEFORE the ordinary preflight/backlog checks run,
   * so a same-key retry never re-consumes quota/backlog capacity. Only the
   * winner of the unique-constraint race actually executes; every other
   * caller with the same key gets the winner's own live/terminal state —
   * queued/running jobs are polled normally, and a terminal job replays its
   * persisted result. A same-key call pinned to a different `scriptVersionId`
   * or a different canonical input hash is a stable `idempotency_conflict`,
   * never a silent second execution.
   */
  private async submitScriptExecuteJob(
    request: RuntimeSandboxJobRequest
  ): Promise<RuntimeSandboxJobResult> {
    const scriptVersionId = request.scriptVersionId;
    const scriptSkillId = request.scriptSkillId;
    const expectedContentHash = request.scriptContentHash;
    const scriptInvocationKey = request.scriptInvocationKey;
    if (
      scriptVersionId === null ||
      scriptSkillId === null ||
      expectedContentHash === null ||
      scriptInvocationKey === null
    ) {
      return this.synthesizeScriptFailure(
        request,
        "script_execute_missing_pin",
        "script.execute requires a complete pinned Script capability."
      );
    }
    let artifact: SandboxScriptVersionArtifact;
    try {
      artifact = await this.loadAuthorizedScriptVersionArtifact({
        assistantId: request.assistantId,
        skillId: scriptSkillId,
        scriptVersionId,
        expectedContentHash
      });
    } catch (error) {
      const { code, message } = this.normalizeSandboxError(error);
      return this.synthesizeScriptFailure(request, code, message);
    }
    const mappedInput = (request.args as { input?: unknown }).input ?? null;
    const inputValidation = this.validateScriptSchema(artifact.inputSchema, mappedInput);
    if (!inputValidation.ok) {
      return this.synthesizeScriptFailure(request, "script_input_invalid", inputValidation.message);
    }
    const inputHash = computeScriptInputHash(mappedInput);
    const reconciledPolicy = reconcileScriptSandboxPolicy(request.policy, artifact.limits);
    const resultMarker = buildScriptResultMarker(scriptInvocationKey);
    const effectiveOutputBytes = resolveEffectiveScriptOutputBytes(
      reconciledPolicy,
      artifact.limits,
      resultMarker
    );
    if (effectiveOutputBytes < 1) {
      return this.synthesizeScriptFailure(
        request,
        "script_output_limit_invalid",
        "The effective Script output limit is too small for the structured result protocol."
      );
    }
    const reconciledRequest: RuntimeSandboxJobRequest = { ...request, policy: reconciledPolicy };

    let created: { id: string } | null = null;
    let creationError: unknown = null;
    try {
      created = await this.prisma.sandboxJob.create({
        data: {
          assistantId: request.assistantId,
          workspaceId: request.workspaceId,
          runtimeRequestId: request.runtimeRequestId,
          runtimeSessionId: request.runtimeSessionId,
          toolCode: request.toolCode,
          scriptVersionId,
          scriptInvocationKey,
          status: "queued",
          relativeWorkspace: ".",
          policySnapshot: this.toJsonValue({
            ...reconciledPolicy,
            scriptInputHash: inputHash,
            scriptContentHash: artifact.contentHash,
            scriptRuntime: artifact.runtime,
            scriptLimits: artifact.limits,
            scriptEffectiveOutputBytes: effectiveOutputBytes,
            scriptResultMarker: resultMarker
          }),
          requestPayload: this.toJsonValue(request.args)
        },
        select: { id: true }
      });
    } catch (error) {
      if (!this.isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      creationError = error;
    }

    if (created === null) {
      const existing = await this.prisma.sandboxJob.findUnique({
        where: {
          assistantId_scriptInvocationKey: {
            assistantId: request.assistantId,
            scriptInvocationKey
          }
        }
      });
      if (existing === null) {
        throw creationError;
      }
      const existingSnapshot =
        existing.policySnapshot !== null &&
        typeof existing.policySnapshot === "object" &&
        !Array.isArray(existing.policySnapshot)
          ? (existing.policySnapshot as Record<string, unknown>)
          : {};
      const versionMatches = existing.scriptVersionId === scriptVersionId;
      const inputMatches = existingSnapshot.scriptInputHash === inputHash;
      if (!versionMatches || !inputMatches) {
        return {
          jobId: existing.id,
          status: "failed",
          toolCode: request.toolCode,
          reason: "idempotency_conflict",
          warning:
            "A script execution with this invocation key is already recorded with a different pinned version or input.",
          violationCode: "idempotency_conflict",
          violationMessage: "scriptInvocationKey collision with a different version or input.",
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null,
          files: []
        };
      }
      return this.pollJob(existing.id);
    }

    this.sandboxObservabilityService.recordSubmittedJob();
    const preflightViolation = await this.resolvePreflightViolation(reconciledRequest, created.id);
    if (preflightViolation !== null) {
      await this.prisma.sandboxJob.update({
        where: { id: created.id },
        data: {
          status: "blocked",
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
        }
      });
      return this.pollJob(created.id);
    }
    const createdJobId = created.id;
    void this.enqueueWorkspaceJob(
      this.buildWorkspaceSessionKey(request.assistantId, request.workspaceId),
      () => this.executeQueuedJob(createdJobId, reconciledRequest)
    ).catch((error) => {
      this.logger.error(`Sandbox script job ${createdJobId} crashed: ${String(error)}`);
    });
    return this.pollJob(createdJobId);
  }

  private synthesizeScriptFailure(
    request: RuntimeSandboxJobRequest,
    code: string,
    message: string
  ): RuntimeSandboxJobResult {
    return {
      jobId: randomUUID(),
      status: "blocked",
      toolCode: request.toolCode,
      reason: code,
      warning: message,
      violationCode: code,
      violationMessage: message,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: null,
      files: []
    };
  }

  private async loadAuthorizedScriptVersionArtifact(input: {
    assistantId: string;
    skillId: string;
    scriptVersionId: string;
    expectedContentHash: string;
  }): Promise<SandboxScriptVersionArtifact> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: { roleId: true }
    });
    if (assistant === null) {
      this.throwPolicy("runtime_script_assistant_not_found", "The Script assistant was not found.");
    }
    const roleSkill = await this.prisma.assistantRoleSkill.findUnique({
      where: { roleId_skillId: { roleId: assistant.roleId, skillId: input.skillId } },
      select: { skill: { select: { status: true, archivedAt: true } } }
    });
    if (
      roleSkill === null ||
      roleSkill.skill.status !== "active" ||
      roleSkill.skill.archivedAt !== null
    ) {
      this.throwPolicy(
        "runtime_script_skill_not_effective",
        "The referenced Skill is no longer effective for this assistant."
      );
    }
    const row = await this.prisma.scriptVersion.findUnique({
      where: { id: input.scriptVersionId },
      select: {
        id: true,
        scriptId: true,
        version: true,
        status: true,
        contentHash: true,
        code: true,
        runtime: true,
        entryCommand: true,
        manifest: true,
        inputSchema: true,
        outputSchema: true,
        limits: true,
        script: { select: { key: true, status: true } }
      }
    });
    if (row === null) {
      this.throwPolicy(
        "runtime_script_version_not_found",
        "The pinned Script version was not found."
      );
    }
    if (row.status !== "published") {
      this.throwPolicy(
        "runtime_script_version_not_published",
        "The pinned Script version is not published."
      );
    }
    if (row.script.status === "archived") {
      this.throwPolicy("runtime_script_archived", "The Script has been archived.");
    }
    if (row.script.status !== "published") {
      this.throwPolicy("runtime_script_not_published", "The Script is not published.");
    }
    const link = await this.prisma.skillScript.findUnique({
      where: { skillId_scriptId: { skillId: input.skillId, scriptId: row.scriptId } },
      select: { skillId: true }
    });
    if (link === null) {
      this.throwPolicy(
        "runtime_script_unlinked",
        "The Script is no longer linked to the referenced Skill."
      );
    }
    const artifact: SandboxScriptVersionArtifact = {
      id: row.id,
      scriptId: row.scriptId,
      scriptKey: row.script.key,
      version: row.version,
      contentHash: row.contentHash,
      status: row.status,
      code: row.code,
      runtime: row.runtime,
      entryCommand: row.entryCommand,
      manifest: parseSandboxScriptManifest(row.manifest),
      inputSchema: row.inputSchema as Record<string, unknown>,
      outputSchema: row.outputSchema as Record<string, unknown>,
      limits: row.limits as SandboxScriptVersionArtifact["limits"],
      scriptStatus: row.script.status
    };
    const recomputedHash = computeScriptExecutableContentHash(artifact);
    if (
      artifact.contentHash === null ||
      artifact.contentHash !== input.expectedContentHash ||
      recomputedHash !== input.expectedContentHash
    ) {
      this.throwPolicy(
        "runtime_script_content_hash_mismatch",
        "The pinned Script executable content hash does not match."
      );
    }
    return artifact;
  }

  private validateScriptSchema(
    schema: Record<string, unknown>,
    value: unknown
  ): { ok: true } | { ok: false; message: string } {
    try {
      const validate = scriptSchemaValidator.compile(schema);
      if (validate(value)) {
        return { ok: true };
      }
      const detail = (validate.errors ?? [])
        .slice(0, 5)
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ")
        .slice(0, 600);
      return { ok: false, message: detail || "Script value does not match its schema." };
    } catch {
      return { ok: false, message: "The published Script schema is invalid." };
    }
  }

  async cancelJob(
    jobId: string,
    options?: { forceDetachedOrphan?: boolean }
  ): Promise<RuntimeSandboxJobResult> {
    const job = await this.findJobRecord(jobId);
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
    if (this.isTerminalJobStatus(job.status)) {
      return this.pollJob(jobId);
    }
    // ADR-152: turn Stop must not kill detached retained work — no-op poll only.
    // Admission-orphan cleanup (failed register/context after detach) may force
    // terminate so unobserved detached work cannot burn the chat 8-cap forever.
    if (job.status === "detached") {
      if (options?.forceDetachedOrphan !== true) {
        return this.pollJob(jobId);
      }
      if (job.execPodName !== null) {
        await this.execPodBridgeService?.terminateDetachedSessionJob({
          jobId: job.id,
          assistantId: job.assistantId,
          workspaceId: job.workspaceId,
          podName: job.execPodName
        });
      }
      await this.prisma.sandboxJob.updateMany({
        where: {
          id: jobId,
          status: "detached",
          completedAt: null
        },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          violationCode: "admission_orphan",
          violationMessage:
            "Detached sandbox job cancelled because opaque registration/context failed.",
          resultPayload: {
            reason: "admission_orphan",
            warning: "Detached sandbox job cancelled because opaque registration/context failed.",
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          }
        }
      });
      return this.pollJob(jobId);
    }
    this.activeJobAbortControllers.get(jobId)?.abort();
    const processTerminated = await this.terminateActiveJobProcess(jobId);
    if (!processTerminated) {
      // Kill failed while the process may still be running (state.json PID retained).
      // Leave status=running so reconcile/cancel can retry; never stamp cancelled on a
      // failed terminate.
      this.logger.warn(
        `sandbox_job_cancel_skipped_after_kill_failure job=${jobId} status=${job.status}`
      );
      return this.pollJob(jobId);
    }
    await this.prisma.sandboxJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["queued", "running"] },
        completedAt: null
      },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        violationCode: "user_stopped",
        violationMessage: "Sandbox job cancelled because the turn was stopped.",
        resultPayload: {
          reason: "user_stopped",
          warning: "Sandbox job cancelled because the turn was stopped.",
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null
        }
      }
    });
    return this.pollJob(jobId);
  }

  /**
   * ADR-149 — best-effort mid-flight process kill using the existing session
   * TERM/KILL cleanup script (or ephemeral pod retirement). Closing the exec
   * WebSocket alone does not stop the in-pod process.
   *
   * Returns false when a kill was attempted and failed so cancelJob must not
   * stamp cancelled while a state.json PID may still be live.
   */
  private async terminateActiveJobProcess(jobId: string): Promise<boolean> {
    const live = this.activeJobBindings.get(jobId);
    if (live === undefined || live.processCleanupStarted) {
      return true;
    }
    if (this.execPodBridgeService === null || this.execPodBridgeService === undefined) {
      return true;
    }
    live.processCleanupStarted = true;
    try {
      if (live.runtimeSessionId === null) {
        await this.execPodBridgeService.retireModelJobPod({ binding: live.binding });
      } else if (live.supervisedProcess) {
        await this.execPodBridgeService.terminateBoundSessionJobProcess({ binding: live.binding });
      } else {
        await this.execPodBridgeService.cleanupBoundSessionPod({ binding: live.binding });
      }
      return true;
    } catch (error) {
      live.processCleanupStarted = false;
      this.logger.warn(
        `sandbox_job_cancel_process_kill_failed job=${jobId} error=${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  async pollJob(jobId: string, waitMs = 0): Promise<RuntimeSandboxJobResult> {
    const startedAtMs = waitMs > 0 ? Date.now() : 0;
    const deadlineMs =
      waitMs > 0 ? Date.now() + Math.min(waitMs, this.config.SANDBOX_MAX_POLL_WAIT_MS) : null;
    let job = await this.findJobRecord(jobId);
    job = await this.refreshDetachedJob(job);
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
      job = await this.refreshDetachedJob(job);
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

  async findTerminalScriptReplay(input: {
    assistantId: string;
    scriptInvocationKey: string;
    scriptVersionId: string;
    scriptContentHash: string;
    scriptInputHash: string;
  }): Promise<RuntimeSandboxJobResult | null> {
    const existing = await this.prisma.sandboxJob.findUnique({
      where: {
        assistantId_scriptInvocationKey: {
          assistantId: input.assistantId,
          scriptInvocationKey: input.scriptInvocationKey
        }
      }
    });
    if (
      existing === null ||
      !this.isTerminalJobStatus(existing.status) ||
      existing.scriptVersionId !== input.scriptVersionId
    ) {
      return null;
    }
    const snapshot =
      existing.policySnapshot !== null &&
      typeof existing.policySnapshot === "object" &&
      !Array.isArray(existing.policySnapshot)
        ? (existing.policySnapshot as Record<string, unknown>)
        : {};
    if (
      snapshot.scriptContentHash !== input.scriptContentHash ||
      snapshot.scriptInputHash !== input.scriptInputHash
    ) {
      return null;
    }
    return this.pollJob(existing.id);
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
   * the canonical copy in GCS and scoped session/shared hydrate will pull them
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
          input.assistantId,
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
   * ADR-146 Slice 3 — synchronous owner warm-pod reconcile after mode commit.
   */
  async reconcileAssistantSandboxEgress(input: {
    assistantId: string;
    mode: "restricted" | "full_public";
    scope: "all" | "stale_only";
  }): Promise<{ recycled: boolean; deletedPodCount: number }> {
    return this.execPodBridgeService.reconcileAssistantEgressPods({
      assistantId: input.assistantId,
      expectedMode: input.mode,
      scope: input.scope
    });
  }

  private async findJobRecord(jobId: string) {
    return await this.prisma.sandboxJob.findUnique({
      where: { id: jobId }
    });
  }

  private async refreshDetachedJob(
    job: Awaited<ReturnType<SandboxService["findJobRecord"]>>
  ): Promise<Awaited<ReturnType<SandboxService["findJobRecord"]>>> {
    if (job === null || job.status !== "detached") return job;
    if (job.execPodName === null) {
      await this.cancelDetachedJobAfterPodLoss(job.id);
      return this.findJobRecord(job.id);
    }
    let observed = await this.execPodBridgeService.observeDetachedSessionJob({
      jobId: job.id,
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      podName: job.execPodName
    });
    if (observed.status === "running") return job;
    if (observed.status === "failed" || observed.status === "missing") {
      // Dead-PID finalize race: re-observe before marking failed / pod-loss cancel.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        observed = await this.execPodBridgeService.observeDetachedSessionJob({
          jobId: job.id,
          assistantId: job.assistantId,
          workspaceId: job.workspaceId,
          podName: job.execPodName
        });
        if (observed.status === "running") return job;
        if (observed.status === "completed") break;
      }
      if (observed.status === "failed") {
        await this.prisma.sandboxJob.updateMany({
          where: { id: job.id, status: "detached", completedAt: null },
          data: {
            status: "failed",
            completedAt: new Date(),
            resultPayload: {
              reason: "process_failed",
              warning: null,
              exitCode: 1,
              stdout: null,
              stderr: null,
              content: null,
              producedFiles: []
            }
          }
        });
        return this.findJobRecord(job.id);
      }
      if (observed.status === "missing") {
        await this.cancelDetachedJobAfterPodLoss(job.id);
        return this.findJobRecord(job.id);
      }
    }
    if (observed.status !== "completed") {
      return job;
    }
    await this.prisma.sandboxJob.updateMany({
      where: { id: job.id, status: "detached", completedAt: null },
      data: {
        status: "completed",
        completedAt: new Date(),
        resultPayload: {
          reason: observed.exitCode === 0 ? null : "process_failed",
          warning: null,
          exitCode: observed.exitCode,
          stdout: this.stripNulCharacters(observed.stdout),
          stderr: this.stripNulCharacters(observed.stderr),
          content: null,
          producedFiles: []
        },
        resourceUsage: {
          stdoutBytes: Buffer.byteLength(observed.stdout, "utf8"),
          stderrBytes: Buffer.byteLength(observed.stderr, "utf8"),
          processDurationMs: observed.durationMs
        }
      }
    });
    return this.findJobRecord(job.id);
  }

  private async cancelDetachedJobAfterPodLoss(jobId: string): Promise<void> {
    await this.prisma.sandboxJob.updateMany({
      where: { id: jobId, status: "detached", completedAt: null },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        violationCode: "sandbox_session_idle_expired",
        violationMessage: "The warm sandbox session reached its idle TTL.",
        resultPayload: {
          reason: "sandbox_session_idle_expired",
          warning: "The warm sandbox session reached its idle TTL.",
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null,
          producedFiles: []
        }
      }
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
    if (job === null || this.isTerminalJobStatus(job.status) || job.status === "detached") {
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
    request: RuntimeSandboxJobRequest,
    excludeJobId?: string
  ): Promise<{ code: string; message: string } | null> {
    await this.failStalePendingJobsBeforeBacklogCount(request);

    const [pendingJobs, workspacePendingJobs] = await Promise.all([
      this.prisma.sandboxJob.count({
        where: {
          ...(excludeJobId === undefined ? {} : { id: { not: excludeJobId } }),
          status: {
            in: [...PENDING_SANDBOX_JOB_STATUSES]
          }
        }
      }),
      this.prisma.sandboxJob.count({
        where: {
          ...(excludeJobId === undefined ? {} : { id: { not: excludeJobId } }),
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
          ...(excludeJobId === undefined ? {} : { id: { not: excludeJobId } }),
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
    const jobAbortController = new AbortController();
    this.activeJobAbortControllers.set(jobId, jobAbortController);
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
    let execPodBinding: ExecPodJobBinding | null = null;
    let terminalWriteSucceeded = false;
    let detachedWriteSucceeded = false;
    let jobStartedAtMs: number | null = null;
    try {
      if (jobAbortController.signal.aborted) {
        throw this.createUserStoppedError();
      }
      const leaseHandle = await this.waitForWorkspaceLease({
        assistantId: request.assistantId,
        workspaceId: request.workspaceId,
        sandboxJobId: jobId,
        waitTimeoutMs: this.resolveWorkspaceLeaseWaitTimeoutMs(request.policy)
      });
      leaseGuard = this.startWorkspaceLeaseHeartbeat(leaseHandle);
      const started = await this.updateSandboxJobUnderActiveLease({
        guard: leaseGuard,
        jobId,
        expectedStatus: "queued",
        data: {
          status: "running",
          startedAt: new Date()
        }
      });
      if (!started) {
        throw this.createWorkspaceLeaseError(
          "workspace_lease_lost",
          "Workspace lease was lost before the sandbox job could enter running state."
        );
      }
      if (jobAbortController.signal.aborted) {
        throw this.createUserStoppedError();
      }
      jobStartedAtMs = Date.now();
      this.assertWorkspaceLeaseActive(leaseGuard);
      const assistantHandle = await this.resolveAssistantHandle(
        request.assistantId,
        request.assistantHandle ?? null
      );
      const defaultVisibleRoot = buildDefaultVisibleWorkspaceRoot(
        request.assistantId,
        request.runtimeSessionId ?? null
      );
      const sessionRuntimeId = request.runtimeSessionId ?? null;
      workspaceRoot = this.resolveWorkspaceRoot(request.workspaceId);
      currentRoot = this.resolveVisiblePathWithinWorkspaceRoot(workspaceRoot, defaultVisibleRoot);
      await this.ensureWorkspaceSessionReady(
        workspaceRoot,
        currentRoot,
        request.assistantId,
        request.runtimeSessionId ?? null
      );
      this.assertWorkspaceLeaseActive(leaseGuard);
      const baselineWorkspaceSnapshot = await this.collectWorkspacePolicySnapshot(workspaceRoot);

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
        siblingHandles,
        signal: jobAbortController.signal
      });
      execPodBinding = result.execPodBinding ?? null;
      this.assertWorkspaceLeaseActive(leaseGuard);
      if (
        request.runtimeSessionId !== null &&
        (request.toolCode === "shell" || request.toolCode === "exec") &&
        result.detached === true
      ) {
        detachedWriteSucceeded = await this.updateSandboxJobUnderActiveLease({
          guard: leaseGuard,
          jobId,
          expectedStatus: "running",
          data: {
            status: "detached",
            ...(result.execPodName !== undefined ? { execPodName: result.execPodName } : {}),
            resultPayload: {
              reason: "detached",
              warning: null,
              exitCode: null,
              stdout: null,
              stderr: null,
              content: null,
              producedFiles: []
            }
          }
        });
        if (!detachedWriteSucceeded || execPodBinding === null) {
          throw this.createWorkspaceLeaseError(
            "workspace_lease_lost",
            "Workspace lease was lost before Process-timeout detach could complete."
          );
        }
        // Founder semantics: detach stamp + lease release happen only after the
        // bridge waited through the plan Process-timeout yield threshold (or
        // equivalent). Short completions never take this path.
        await this.execPodBridgeService.releaseBoundSessionPod({ binding: execPodBinding });
        return;
      }

      const stats = await this.computeWorkspaceStats(workspaceRoot);
      this.assertWorkspaceLeaseActive(leaseGuard);
      const nextWorkspaceSnapshot = await this.collectWorkspacePolicySnapshot(workspaceRoot);
      this.assertWorkspacePolicySnapshot(
        nextWorkspaceSnapshot,
        request.policy,
        baselineWorkspaceSnapshot,
        request.assistantId,
        sessionRuntimeId
      );

      if (request.runtimeSessionId !== null && request.runtimeSessionId !== undefined) {
        await this.saveSessionWorkspaceSnapshot(
          request.assistantId,
          request.runtimeSessionId,
          currentRoot
        );
      }
      terminalWriteSucceeded = await this.updateSandboxJobUnderActiveLease({
        guard: leaseGuard,
        jobId,
        expectedStatus: "running",
        data: {
          status:
            request.toolCode === "script.execute" && result.reason !== null
              ? "failed"
              : "completed",
          completedAt: new Date(),
          ...(request.toolCode === "script.execute" && result.reason !== null
            ? {
                violationCode: this.stripNulCharacters(result.reason),
                violationMessage: this.stripNulCharacters(
                  result.warning ?? "Script execution failed."
                )
              }
            : {}),
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
      execPodBinding ??= leaseGuard?.podBinding ?? null;
      if (error !== null && typeof error === "object" && "execPodBinding" in error) {
        execPodBinding =
          (error as { execPodBinding?: ExecPodJobBinding }).execPodBinding ?? execPodBinding;
      }
      const { code, message, blocked, resourceUsage } = this.normalizeSandboxError(error);
      const aborted = jobAbortController.signal.aborted || code === "user_stopped";
      if (aborted) {
        const cancelledData: Prisma.SandboxJobUpdateManyMutationInput = {
          status: "cancelled",
          completedAt: new Date(),
          violationCode: "user_stopped",
          violationMessage: "Sandbox job cancelled because the turn was stopped.",
          resultPayload: {
            reason: "user_stopped",
            warning: "Sandbox job cancelled because the turn was stopped.",
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null
          }
        };
        const updated = await this.prisma.sandboxJob.updateMany({
          where: {
            id: jobId,
            status: { in: ["queued", "running"] },
            completedAt: null
          },
          data: cancelledData
        });
        const current = await this.findJobRecord(jobId);
        terminalWriteSucceeded = updated.count === 1 || current?.status === "cancelled";
      } else {
        const safeMessage = this.stripNulCharacters(message);
        const failureData: Prisma.SandboxJobUpdateManyMutationInput = {
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
        };
        terminalWriteSucceeded =
          leaseGuard === null
            ? (
                await this.prisma.sandboxJob.updateMany({
                  where: { id: jobId, status: "queued", completedAt: null },
                  data: failureData
                })
              ).count === 1
            : await this.updateSandboxJobUnderActiveLease({
                guard: leaseGuard,
                jobId,
                expectedStatus: "running",
                data: failureData
              });
        if (terminalWriteSucceeded && workspaceRoot !== null && currentRoot !== null) {
          await this.resetWorkspaceSessionOnFailure(
            request.assistantId,
            workspaceRoot,
            currentRoot,
            request.runtimeSessionId ?? null
          );
        }
      }
    } finally {
      if (terminalWriteSucceeded && jobStartedAtMs !== null && execPodBinding !== null) {
        this.sandboxObservabilityService.recordSandboxEgressJobDuration({
          mode: execPodBinding.mode,
          durationMs: Date.now() - jobStartedAtMs
        });
      }
      const liveBinding = this.activeJobBindings.get(jobId);
      let podFinalizationSucceeded = execPodBinding === null || detachedWriteSucceeded;
      if (leaseGuard !== null && execPodBinding !== null) {
        if (detachedWriteSucceeded) {
          podFinalizationSucceeded = true;
        } else {
          const cleanupAlreadyStarted = liveBinding?.processCleanupStarted === true;
          if (cleanupAlreadyStarted) {
            podFinalizationSucceeded = true;
          } else {
            if (liveBinding !== undefined) {
              liveBinding.processCleanupStarted = true;
            }
            try {
              if (request.runtimeSessionId === null) {
                const retirement = await this.execPodBridgeService.retireModelJobPod({
                  binding: execPodBinding
                });
                podFinalizationSucceeded = true;
                this.logger.log(
                  `sandbox_job_pod_retirement_complete job=${jobId} assistant=${request.assistantId} pod=${retirement.podName} uid=${retirement.podUid} retired=${String(retirement.retired)}`
                );
              } else {
                const cleanup = await this.execPodBridgeService.cleanupBoundSessionPod({
                  binding: execPodBinding
                });
                podFinalizationSucceeded = true;
                this.logger.log(
                  `sandbox_job_pod_cleanup_complete job=${jobId} assistant=${request.assistantId} pod=${cleanup.podName} uid=${cleanup.podUid}`
                );
              }
            } catch (cleanupError) {
              if (liveBinding !== undefined) {
                liveBinding.processCleanupStarted = false;
              }
              const cleanupMessage =
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              this.logger.error(
                `sandbox_job_pod_cleanup_failed job=${jobId} assistant=${request.assistantId} workspace=${request.workspaceId} pod=${execPodBinding.podName} uid=${execPodBinding.podUid} error=${cleanupMessage}`
              );
              try {
                const retirement = await this.execPodBridgeService.retireModelJobPod({
                  binding: execPodBinding
                });
                podFinalizationSucceeded = true;
                this.logger.warn(
                  `sandbox_job_pod_cleanup_retired job=${jobId} assistant=${request.assistantId} pod=${retirement.podName} uid=${retirement.podUid} retired=${String(retirement.retired)}`
                );
              } catch (retirementError) {
                const retirementMessage =
                  retirementError instanceof Error
                    ? retirementError.message
                    : String(retirementError);
                this.logger.error(
                  `sandbox_job_pod_retirement_failed job=${jobId} assistant=${request.assistantId} workspace=${request.workspaceId} pod=${execPodBinding.podName} uid=${execPodBinding.podUid} error=${retirementMessage}`
                );
              }
            }
          }
        }
      }
      await this.stopWorkspaceLeaseHeartbeat(leaseGuard, {
        release: (terminalWriteSucceeded || detachedWriteSucceeded) && podFinalizationSucceeded
      });
      this.activeJobBindings.delete(jobId);
      this.activeJobAbortControllers.delete(jobId);
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
    signal: AbortSignal;
  }): Promise<SandboxToolExecutionResult> {
    this.assertWorkspaceLeaseActive(input.leaseGuard);
    switch (input.request.toolCode) {
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
          input.request.workspaceId,
          input.signal
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
          input.request.workspaceId,
          input.signal
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
          input.request.workspaceId,
          input.signal
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
          input.request.workspaceId,
          input.signal
        );
      case "script.execute": {
        const scriptVersionId = input.request.scriptVersionId;
        if (scriptVersionId === null || scriptVersionId === undefined) {
          this.throwPolicy(
            "script_execute_missing_version",
            "script.execute requires a pinned scriptVersionId."
          );
        }
        return this.executeScriptRun(
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
          input.request.workspaceId,
          input.signal,
          scriptVersionId,
          input.request.scriptInvocationKey ?? null,
          input.request.scriptSkillId,
          input.request.scriptContentHash,
          input.request.scriptBrowserBroker ?? null
        );
      }
      default:
        this.throwPolicy(
          "tool_not_supported",
          `Unsupported sandbox tool "${input.request.toolCode}".`
        );
    }
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
    workspaceId: string,
    signal: AbortSignal
  ) {
    const absoluteCwd = this.resolveShellExecCwdPath(workspaceRoot, currentRoot, args.cwd);
    await fs.mkdir(absoluteCwd, { recursive: true });

    this.assertWorkspaceLeaseActive(leaseGuard);

    const beforeVisibleFiles = await this.collectVisibleProducedFileSnapshots(
      workspaceRoot,
      currentRoot
    );
    const command = this.requireString(args.command, "command");
    const childArgs: string[] = shellMode
      ? ["-lc", command]
      : Array.isArray(args.args)
        ? args.args.filter((item): item is string => typeof item === "string")
        : [];
    const result = await this.execPodBridgeService.runInPod({
      jobId,
      leaseToken: leaseGuard.handle.leaseToken,
      leaseHolderId: leaseGuard.handle.holderId,
      runtimeSessionId,
      assistantId,
      assistantHandle,
      siblingHandles,
      workspaceId,
      workspaceRoot,
      absoluteCwd,
      command: shellMode ? "/bin/bash" : command,
      args: childArgs,
      policy,
      visibleWorkspacePaths: [this.toVisibleWorkspaceAbsolutePath(workspaceRoot, absoluteCwd)],
      ...(runtimeSessionId === null ? {} : { supervisedDetach: true }),
      signal,
      onBound: (binding) => {
        this.activeJobBindings.set(jobId, {
          binding,
          runtimeSessionId,
          processCleanupStarted: false,
          supervisedProcess: runtimeSessionId !== null
        });
        leaseGuard.podBinding = binding;
      }
    });
    leaseGuard.podBinding = result.execPodBinding ?? null;
    if (result.detached === true) {
      return {
        reason: "detached",
        warning: null,
        exitCode: null,
        stdout: null,
        stderr: null,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        execPodBinding: result.execPodBinding,
        detached: true
      };
    }
    if (result.exitCode !== 0) {
      return {
        reason: "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        execPodBinding: result.execPodBinding
      };
    }
    const afterVisibleFiles = await this.collectVisibleProducedFileSnapshots(
      workspaceRoot,
      currentRoot
    );
    const producedFiles = await this.mirrorShellExecProducedFiles({
      workspaceId,
      workspaceRoot,
      before: beforeVisibleFiles,
      after: afterVisibleFiles
    });
    return {
      reason: null,
      warning: null,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      content: null,
      durationMs: result.durationMs,
      execPodName: result.execPodName,
      execPodBinding: result.execPodBinding,
      producedFiles
    };
  }

  /**
   * ADR-151 — execute a Script through the exact existing warm session
   * sandbox path: same lease/pod/workspace/cwd/egress/quota machinery as
   * `exec`/`shell`, with the Script's own immutable `code`/`entryCommand`
   * reloaded server-side by `scriptVersionId` (never trusted from the model
   * or the request payload). Code/input/output all stage under a transient
   * `/tmp` directory that is removed by the wrapper script itself on every
   * exit path and is never scanned as a produced/visible workspace file, so
   * it can never reach GCS/Files/snapshots. The Script's ordinary working
   * directory remains the session workspace root (`currentRoot`).
   */
  private async executeScriptRun(
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
    workspaceId: string,
    signal: AbortSignal,
    scriptVersionId: string,
    scriptInvocationKey: string | null,
    scriptSkillId: string | null,
    expectedContentHash: string | null,
    scriptBrowserBroker: RuntimeSandboxJobRequest["scriptBrowserBroker"]
  ): Promise<SandboxToolExecutionResult> {
    if (scriptSkillId === null || expectedContentHash === null || scriptInvocationKey === null) {
      this.throwPolicy("script_execute_missing_pin", "The Script capability pin is incomplete.");
    }
    const artifact = await this.loadAuthorizedScriptVersionArtifact({
      assistantId,
      skillId: scriptSkillId,
      scriptVersionId,
      expectedContentHash
    });
    const mappedInput = (args as { input?: unknown }).input ?? {};
    const inputValidation = this.validateScriptSchema(artifact.inputSchema, mappedInput);
    if (!inputValidation.ok) {
      this.throwPolicy("script_input_invalid", inputValidation.message);
    }
    const inputJson = JSON.stringify(mappedInput);
    const inputSizeBytes = Buffer.byteLength(inputJson, "utf8");
    if (inputSizeBytes > policy.maxSingleFileWriteBytes) {
      this.throwPolicy(
        "single_file_write_limit_exceeded",
        `Script input is ${String(inputSizeBytes)} bytes, above the per-file limit of ${String(
          policy.maxSingleFileWriteBytes
        )}.`
      );
    }

    this.assertWorkspaceLeaseActive(leaseGuard);

    const scriptDir = `/tmp/persai-script/${jobId}`;
    const resultMarker = buildScriptResultMarker(scriptInvocationKey);
    const effectiveOutputBytes = resolveEffectiveScriptOutputBytes(
      policy,
      artifact.limits,
      resultMarker
    );
    const stagingFiles: SessionPodStagingFile[] = [
      { absolutePath: `${scriptDir}/entry`, contents: Buffer.from(artifact.code, "utf8") },
      { absolutePath: `${scriptDir}/input.json`, contents: Buffer.from(inputJson, "utf8") }
    ];
    const wrapperScript = buildScriptExecutionShellCommand({
      scriptDir,
      entryCommand: artifact.entryCommand,
      invocationKey: scriptInvocationKey,
      manifestEnvironment: artifact.manifest.environment,
      resultMarker,
      maxOutputBytes: effectiveOutputBytes,
      browserEnabled: artifact.manifest.capabilities !== undefined
    });

    const absoluteCwd = this.resolveShellExecCwdPath(
      workspaceRoot,
      currentRoot,
      artifact.manifest.workingDirectory
    );
    await fs.mkdir(absoluteCwd, { recursive: true });
    let boundScriptPod: ExecPodJobBinding | null = null;
    let result: Awaited<ReturnType<ExecPodBridgeService["runInPod"]>> | null = null;
    let executionError: unknown = null;
    const browserCapabilityEnabled = artifact.manifest.capabilities !== undefined;
    const brokerBinding = browserCapabilityEnabled
      ? this.requireScriptBrowserBrokerBinding(scriptBrowserBroker)
      : null;
    if (!browserCapabilityEnabled && scriptBrowserBroker != null) {
      this.throwPolicy(
        "script_browser_capability_absent",
        "The immutable Script manifest does not authorize browser access."
      );
    }
    const brokerSession =
      brokerBinding === null
        ? null
        : await this.scriptBrowserBrokerService.openSession({
            binding: brokerBinding,
            sandboxJobId: jobId,
            deadlineAtMs: Date.now() + policy.maxProcessRuntimeMs
          });
    const interactiveStdin = brokerSession === null ? null : new PassThrough();
    let frameDecoder: ScriptBrowserFrameDecoder | null = null;
    const browserResponseLifecycle =
      interactiveStdin === null ? null : new ScriptBrowserResponseLifecycle(interactiveStdin);
    try {
      result = await this.execPodBridgeService.runInPod({
        jobId,
        leaseToken: leaseGuard.handle.leaseToken,
        leaseHolderId: leaseGuard.handle.holderId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd,
        command: "/bin/bash",
        args: ["-lc", wrapperScript],
        policy,
        stagingFiles,
        ...(brokerSession === null || interactiveStdin === null
          ? {}
          : {
              interactive: {
                stdin: interactiveStdin,
                wrapStdout: (ordinaryStdout) => {
                  frameDecoder = new ScriptBrowserFrameDecoder((request) => {
                    browserResponseLifecycle?.dispatch({
                      requestResponse: () => brokerSession.request(request),
                      failureResponse: (error) =>
                        this.buildScriptBrowserFailureFrame(request, error)
                    });
                  }, ordinaryStdout);
                  return frameDecoder;
                },
                finalizeStdout: () => frameDecoder?.flushRemainder(),
                getError: () => frameDecoder?.failure ?? null
              }
            }),
        signal,
        onBound: (binding) => {
          boundScriptPod = binding;
          this.activeJobBindings.set(jobId, {
            binding,
            runtimeSessionId,
            processCleanupStarted: false,
            supervisedProcess: false
          });
          leaseGuard.podBinding = binding;
        }
      });
      boundScriptPod = result.execPodBinding ?? boundScriptPod;
    } catch (error) {
      executionError = error;
    } finally {
      await browserResponseLifecycle?.close(async () => {
        await brokerSession?.close();
      });
    }
    const cleanupBinding = boundScriptPod ?? leaseGuard.podBinding;
    if (cleanupBinding !== null) {
      try {
        await this.execPodBridgeService.cleanupBoundScriptTransientDirectory({
          binding: cleanupBinding
        });
      } catch (cleanupError) {
        await this.execPodBridgeService.retireModelJobPod({ binding: cleanupBinding });
        throw cleanupError;
      }
    }
    if (executionError !== null) {
      throw executionError;
    }
    if (result === null) {
      this.throwPolicy("script_execution_failed", "Script execution returned no result.");
    }
    leaseGuard.podBinding = result.execPodBinding ?? null;

    const { diagnosticStdout, resultText } = splitScriptExecutionStdout(
      result.stdout,
      resultMarker
    );
    if (result.exitCode !== 0) {
      return {
        reason: "process_failed",
        warning: null,
        exitCode: result.exitCode,
        stdout: diagnosticStdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        execPodBinding: result.execPodBinding
      };
    }
    const parsed = parseScriptExecutionResultJson(resultText, effectiveOutputBytes);
    if (!parsed.ok) {
      return {
        reason: parsed.code,
        warning: parsed.message,
        exitCode: result.exitCode,
        stdout: diagnosticStdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        execPodBinding: result.execPodBinding
      };
    }
    const outputValidation = this.validateScriptSchema(artifact.outputSchema, parsed.value);
    if (!outputValidation.ok) {
      return {
        reason: "script_output_schema_invalid",
        warning: outputValidation.message,
        exitCode: result.exitCode,
        stdout: diagnosticStdout,
        stderr: result.stderr,
        content: null,
        durationMs: result.durationMs,
        execPodName: result.execPodName,
        execPodBinding: result.execPodBinding
      };
    }
    return {
      reason: null,
      warning: null,
      exitCode: result.exitCode,
      stdout: diagnosticStdout,
      stderr: result.stderr,
      content: resultText,
      durationMs: result.durationMs,
      execPodName: result.execPodName,
      execPodBinding: result.execPodBinding
    };
  }

  private requireScriptBrowserBrokerBinding(binding: unknown) {
    const brokerId =
      binding !== null && typeof binding === "object" && !Array.isArray(binding)
        ? (binding as Record<string, unknown>).brokerId
        : undefined;
    const authToken =
      binding !== null && typeof binding === "object" && !Array.isArray(binding)
        ? (binding as Record<string, unknown>).authToken
        : undefined;
    const expiresAt =
      binding !== null && typeof binding === "object" && !Array.isArray(binding)
        ? (binding as Record<string, unknown>).expiresAt
        : undefined;
    if (
      binding === null ||
      typeof binding !== "object" ||
      Array.isArray(binding) ||
      Object.keys(binding).sort().join(",") !== "authToken,brokerId,expiresAt" ||
      typeof brokerId !== "string" ||
      !/^[A-Za-z0-9_-]{32}$/.test(brokerId) ||
      typeof authToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(authToken) ||
      typeof expiresAt !== "string" ||
      !Number.isFinite(Date.parse(expiresAt))
    ) {
      this.throwPolicy(
        "script_browser_broker_missing",
        "Browser-capable Script execution requires an active platform broker."
      );
    }
    return binding as {
      brokerId: string;
      authToken: string;
      expiresAt: string;
    };
  }

  private buildScriptBrowserFailureFrame(
    request: RuntimeScriptBrowserSdkRequest,
    error: unknown
  ): string {
    const code =
      error instanceof Error && /^[a-z0-9_]{1,128}$/.test(error.message)
        ? error.message
        : "script_browser_broker_failed";
    const response = {
      version: 1,
      requestId: request.requestId,
      ok: false,
      error: {
        code,
        message: "The platform browser broker could not complete the request."
      }
    };
    return `${SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX}${Buffer.from(
      JSON.stringify(response),
      "utf8"
    ).toString("base64url")}\n`;
  }

  private async collectVisibleProducedFileSnapshots(
    workspaceRoot: string,
    scanRoot: string
  ): Promise<Map<string, import("./shell-document-output-diff").WorkspaceDocumentOutputSnapshot>> {
    return collectWorkspaceDocumentOutputSnapshots({
      workspaceRoot,
      scanRoot,
      workspaceMountRoot: WORKSPACE_MOUNT_ROOT,
      isVisibleDocumentPath: (workspacePath) =>
        this.isVisibleWorkspaceProducedFilePath(workspacePath),
      shouldSkipDirectory: (workspacePath) => isSessionInstallLayerPath(workspacePath),
      toVisibleWorkspaceAbsolutePath: (root, absolutePath) =>
        this.toVisibleWorkspaceAbsolutePath(root, absolutePath)
    });
  }

  private async mirrorShellExecProducedFiles(input: {
    workspaceId: string;
    workspaceRoot: string;
    before: Map<string, import("./shell-document-output-diff").WorkspaceDocumentOutputSnapshot>;
    after: Map<string, import("./shell-document-output-diff").WorkspaceDocumentOutputSnapshot>;
  }): Promise<RuntimeSandboxProducedFile[]> {
    const producedFiles = buildShellProducedFilesFromDocumentDiff({
      workspaceMountRoot: WORKSPACE_MOUNT_ROOT,
      before: input.before,
      after: input.after,
      inferMimeType: (workspacePath) => this.inferMimeType(workspacePath)
    });
    if (producedFiles.length === 0) {
      return producedFiles;
    }
    try {
      await mirrorVisibleWorkspaceProducedFilesToGcs({
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        workspaceMountRoot: WORKSPACE_MOUNT_ROOT,
        producedFiles,
        resolveLocalAbsolutePath: (root, visiblePath) =>
          this.resolveVisiblePathWithinWorkspaceRoot(root, visiblePath),
        objectStorage: this.objectStorage,
        readFile: (absolutePath) => fs.readFile(absolutePath)
      });
    } catch (error) {
      this.throwPolicy(
        "produced_file_mirror_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
    return producedFiles;
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
    workspaceId: string,
    signal: AbortSignal
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
    const podInputPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, inputAbsolutePath);
    const podOutputPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, outputAbsolutePath);
    const stagingFiles: SessionPodStagingFile[] = [
      { absolutePath: podInputPath, contents: Buffer.from(htmlContent, "utf8") }
    ];

    let renderBinding: ExecPodJobBinding | null = null;
    try {
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        leaseToken: leaseGuard.handle.leaseToken,
        leaseHolderId: leaseGuard.handle.holderId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd: currentRoot,
        command: "weasyprint",
        args: [podInputPath, podOutputPath],
        policy,
        stagingFiles,
        visibleWorkspacePaths: [podOutputPath],
        signal,
        onBound: (binding) => {
          this.activeJobBindings.set(jobId, {
            binding,
            runtimeSessionId,
            processCleanupStarted: false,
            supervisedProcess: false
          });
          leaseGuard.podBinding = binding;
        }
      });
      renderBinding = result.execPodBinding ?? null;
      leaseGuard.podBinding = renderBinding;
      if (result.exitCode !== 0) {
        return {
          reason: "process_failed",
          warning: null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          content: null,
          durationMs: result.durationMs,
          execPodName: result.execPodName,
          execPodBinding: result.execPodBinding
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
        execPodBinding: result.execPodBinding,
        producedFiles
      };
    } finally {
      if (runtimeSessionId !== null && renderBinding !== null) {
        await this.removeSessionPodPaths({
          assistantId,
          assistantHandle,
          siblingHandles,
          workspaceId,
          runtimeSessionId,
          jobBinding: renderBinding,
          policy,
          paths: [podInputPath]
        });
      } else {
        await fs.rm(inputAbsolutePath, { force: true });
      }
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
    workspaceId: string,
    signal: AbortSignal
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
    const podProgramPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, programAbsolutePath);
    const podSourcesDirPath = this.toVisibleWorkspaceAbsolutePath(
      workspaceRoot,
      sourcesDirAbsolute
    );
    const stagingFiles: SessionPodStagingFile[] = [];

    let documentBinding: ExecPodJobBinding | null = null;
    try {
      const sourceMounts = this.readDocumentCodeSourceMounts(args.sourceMounts);
      for (const mount of sourceMounts) {
        const buffer = await this.downloadWorkspaceStoragePathBytes(workspaceId, mount.storagePath);
        const targetAbsolute = this.resolveWorkspacePath(currentRoot, mount.mountPath);
        stagingFiles.push({
          absolutePath: this.toVisibleWorkspaceAbsolutePath(workspaceRoot, targetAbsolute),
          contents: buffer
        });
      }

      const textSidecars = this.readDocumentCodeTextSidecars(args.textSidecars);
      for (const sidecar of textSidecars) {
        const targetAbsolute = this.resolveWorkspacePath(currentRoot, sidecar.mountPath);
        stagingFiles.push({
          absolutePath: this.toVisibleWorkspaceAbsolutePath(workspaceRoot, targetAbsolute),
          contents: Buffer.from(sidecar.text, "utf8")
        });
      }

      stagingFiles.push({
        absolutePath: podProgramPath,
        contents: Buffer.from(programSource, "utf8")
      });

      const outputAbsolutePath = this.resolveDocumentToolTargetPath(
        workspaceRoot,
        currentRoot,
        outputFileName
      );
      const podOutputPath = this.toVisibleWorkspaceAbsolutePath(workspaceRoot, outputAbsolutePath);
      const result = await this.execPodBridgeService.runInPod({
        jobId,
        leaseToken: leaseGuard.handle.leaseToken,
        leaseHolderId: leaseGuard.handle.holderId,
        runtimeSessionId,
        assistantId,
        assistantHandle,
        siblingHandles,
        workspaceId,
        workspaceRoot,
        absoluteCwd: currentRoot,
        command: "python3",
        args: [podProgramPath],
        policy,
        stagingFiles,
        visibleWorkspacePaths: [podOutputPath],
        signal,
        onBound: (binding) => {
          this.activeJobBindings.set(jobId, {
            binding,
            runtimeSessionId,
            processCleanupStarted: false,
            supervisedProcess: false
          });
          leaseGuard.podBinding = binding;
        }
      });
      documentBinding = result.execPodBinding ?? null;
      leaseGuard.podBinding = documentBinding;
      if (result.exitCode !== 0) {
        return {
          reason: "process_failed",
          warning: null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          content: null,
          durationMs: result.durationMs,
          execPodName: result.execPodName,
          execPodBinding: result.execPodBinding
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
        execPodBinding: result.execPodBinding,
        producedFiles
      };
    } finally {
      if (runtimeSessionId !== null && documentBinding !== null) {
        await this.removeSessionPodPaths({
          assistantId,
          assistantHandle,
          siblingHandles,
          workspaceId,
          runtimeSessionId,
          jobBinding: documentBinding,
          policy,
          paths: [podProgramPath, podSourcesDirPath]
        });
      } else {
        await fs.rm(programAbsolutePath, { force: true });
        await fs.rm(sourcesDirAbsolute, { recursive: true, force: true });
      }
    }
  }

  private async removeSessionPodPaths(input: {
    assistantId: string;
    assistantHandle: string;
    siblingHandles: readonly string[];
    workspaceId: string;
    runtimeSessionId: string;
    jobBinding: ExecPodJobBinding;
    policy: RuntimeSandboxPolicy;
    paths: readonly string[];
  }): Promise<void> {
    if (input.paths.length === 0) {
      return;
    }
    const shellCommand = input.paths
      .map((path) => `rm -rf ${sandboxPosixSingleQuote(path)}`)
      .join(" && ");
    await this.execPodBridgeService.execShellInSessionPod({
      assistantId: input.assistantId,
      assistantHandle: input.assistantHandle,
      siblingHandles: input.siblingHandles,
      workspaceId: input.workspaceId,
      runtimeSessionId: input.runtimeSessionId,
      jobBinding: input.jobBinding,
      policy: input.policy,
      shellCommand
    });
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
      renewing: false,
      podBinding: null
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

  private async stopWorkspaceLeaseHeartbeat(
    guard: WorkspaceLeaseGuard | null,
    options: { release: boolean } = { release: true }
  ): Promise<void> {
    const heartbeatTimer = guard?.heartbeatTimer ?? null;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
    if (guard === null) {
      return;
    }
    guard.active = false;
    if (options.release) {
      await this.releaseWorkspaceLease(guard.handle);
    }
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

  private async updateSandboxJobUnderActiveLease(input: {
    guard: WorkspaceLeaseGuard;
    jobId: string;
    expectedStatus: "queued" | "running";
    data: Prisma.SandboxJobUpdateManyMutationInput;
  }): Promise<boolean> {
    const handle = input.guard.handle;
    const updated = await this.prisma.sandboxJob.updateMany({
      where: {
        id: input.jobId,
        assistantId: handle.assistantId,
        workspaceId: handle.workspaceId,
        status: input.expectedStatus,
        completedAt: null,
        workspaceLeases: {
          some: {
            assistantId: handle.assistantId,
            workspaceId: handle.workspaceId,
            sandboxJobId: input.jobId,
            leaseToken: handle.leaseToken,
            holderId: handle.holderId,
            expiresAt: { gt: new Date() }
          }
        }
      },
      data: input.data
    });
    if (updated.count !== 1) {
      input.guard.active = false;
      input.guard.renewalError = this.createWorkspaceLeaseError(
        "workspace_lease_lost",
        "Sandbox job state was not updated because its exact active workspace lease is no longer authoritative."
      );
      return false;
    }
    return true;
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
   * Persist the session workspace directory as a tar to GCS under the session key.
   * ADR-150 — install-layer trees are excluded from the archive.
   * This snapshot is restored on pod recreate to bring back work artifacts only.
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
   * ADR-150 — excludes session install-layer basenames.
   */
  private createTarFromDirectory(directory: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const tarChild = spawn(
        "tar",
        ["-cf", "-", ...buildSessionInstallLayerTarExcludeArgs(), "-C", directory, "."],
        {
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
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
      // ADR-150 — strip install-layer from legacy snapshots before overlay.
      await purgeSessionInstallLayerTrees(staging);
      await fs.cp(staging, directory, { recursive: true, force: false, errorOnExist: false });
      // Also clear leftovers already on the session destination (crash/upgrade residue).
      await purgeSessionInstallLayerTrees(directory);
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

  private async collectWorkspacePolicySnapshot(
    workspaceRoot: string
  ): Promise<Map<string, WorkspaceTreeEntry>> {
    const snapshot = new Map<string, WorkspaceTreeEntry>();
    const workspaceRootResolved = resolve(workspaceRoot);
    const visit = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = join(currentDir, entry.name);
        const relativePath = relative(workspaceRootResolved, absolutePath).replace(/\\/g, "/");
        const visiblePath =
          relativePath.length === 0
            ? WORKSPACE_MOUNT_ROOT
            : `${WORKSPACE_MOUNT_ROOT}/${relativePath}`;
        if (entry.isDirectory()) {
          snapshot.set(visiblePath, { kind: "directory", sizeBytes: 0 });
          await visit(absolutePath);
          continue;
        }
        const stat = await fs.lstat(absolutePath);
        snapshot.set(visiblePath, {
          kind: "file",
          sizeBytes: stat.isSymbolicLink() ? 0 : stat.size
        });
      }
    };
    await visit(workspaceRootResolved);
    return snapshot;
  }

  private buildWorkspacePolicyDeltas(
    snapshot: ReadonlyMap<string, WorkspaceTreeEntry>,
    baseline: ReadonlyMap<string, WorkspaceTreeEntry>,
    assistantId: string,
    runtimeSessionId: string | null
  ): {
    ordinary: WorkspacePolicyDelta;
    dependency: WorkspacePolicyDelta;
  } {
    const ordinary = { ...EMPTY_WORKSPACE_POLICY_DELTA };
    const dependency = { ...EMPTY_WORKSPACE_POLICY_DELTA };
    for (const [visiblePath, entry] of snapshot.entries()) {
      if (baseline.has(visiblePath)) {
        continue;
      }
      const target =
        runtimeSessionId !== null &&
        isSessionDependencyVisiblePath(visiblePath, assistantId, runtimeSessionId)
          ? dependency
          : ordinary;
      if (entry.kind === "directory") {
        target.addedDirectoryCount += 1;
        continue;
      }
      target.addedFileCount += 1;
      target.addedBytes += entry.sizeBytes;
    }
    return { ordinary, dependency };
  }

  private assertWorkspacePolicySnapshot(
    snapshot: ReadonlyMap<string, WorkspaceTreeEntry>,
    policy: RuntimeSandboxPolicy,
    baselineSnapshot: ReadonlyMap<string, WorkspaceTreeEntry>,
    assistantId: string,
    runtimeSessionId: string | null
  ): void {
    const { ordinary, dependency } = this.buildWorkspacePolicyDeltas(
      snapshot,
      baselineSnapshot,
      assistantId,
      runtimeSessionId
    );
    if (ordinary.addedFileCount > policy.maxFileCountPerJob) {
      this.throwPolicy(
        "file_count_limit_exceeded",
        `Sandbox job added ${String(ordinary.addedFileCount)} files, above the per-job limit of ${String(
          policy.maxFileCountPerJob
        )}.`
      );
    }
    if (ordinary.addedDirectoryCount > policy.maxDirectoryCountPerJob) {
      this.throwPolicy(
        "directory_count_limit_exceeded",
        `Sandbox job added ${String(ordinary.addedDirectoryCount)} directories, above the per-job limit of ${String(policy.maxDirectoryCountPerJob)}.`
      );
    }
    if (ordinary.addedBytes > policy.maxWorkspaceBytesPerJob) {
      this.throwPolicy(
        "workspace_size_limit_exceeded",
        `Sandbox job increased workspace bytes by ${String(ordinary.addedBytes)}, above the per-job limit of ${String(policy.maxWorkspaceBytesPerJob)} bytes.`
      );
    }
    if (dependency.addedFileCount > SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedFilesPerJob) {
      this.throwPolicy(
        "file_count_limit_exceeded",
        `Sandbox job added ${String(dependency.addedFileCount)} dependency files, above the dependency contour limit of ${String(SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedFilesPerJob)}.`
      );
    }
    if (
      dependency.addedDirectoryCount > SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedDirectoriesPerJob
    ) {
      this.throwPolicy(
        "directory_count_limit_exceeded",
        `Sandbox job added ${String(dependency.addedDirectoryCount)} dependency directories, above the dependency contour limit of ${String(SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedDirectoriesPerJob)}.`
      );
    }
    if (dependency.addedBytes > SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedBytesPerJob) {
      this.throwPolicy(
        "workspace_size_limit_exceeded",
        `Sandbox job increased dependency bytes by ${String(dependency.addedBytes)}, above the dependency contour limit of ${String(SESSION_DEPENDENCY_CONTOUR_LIMITS.maxAddedBytesPerJob)} bytes.`
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

  /**
   * Resolve shell/exec cwd without doubling when the model copies a full
   * `/workspace/...` path from Working Files into the cwd field.
   */
  private resolveShellExecCwdPath(
    workspaceRoot: string,
    currentRoot: string,
    rawCwd: unknown
  ): string {
    if (rawCwd === undefined || rawCwd === null) {
      return currentRoot;
    }
    const raw = this.requireString(rawCwd, "cwd");
    const normalized = raw.replace(/\\/g, "/");
    const strippedLeading = normalized.replace(/^\/+/, "");

    if (strippedLeading.length === 0 || strippedLeading === ".") {
      return currentRoot;
    }

    if (normalized.startsWith("/workspace/") || normalized === "/workspace") {
      return this.resolveVisiblePathWithinWorkspaceRoot(workspaceRoot, normalized);
    }

    if (strippedLeading.startsWith("workspace/")) {
      return this.resolveVisiblePathWithinWorkspaceRoot(workspaceRoot, `/${strippedLeading}`);
    }

    if (strippedLeading.startsWith("assistants/") || strippedLeading.startsWith("shared/")) {
      return this.resolveWorkspacePath(workspaceRoot, strippedLeading);
    }

    return this.resolveWorkspacePath(currentRoot, strippedLeading);
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

  private isVisibleWorkspaceProducedFilePath(workspacePath: string): boolean {
    if (isSessionInstallLayerPath(workspacePath)) {
      return false;
    }
    const info = classifyVisibleWorkspacePath(workspacePath);
    return (
      info.kind === "sessionDescendant" ||
      info.kind === "assistantSharedDescendant" ||
      info.kind === "workspaceSharedDescendant"
    );
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

  private createUserStoppedError(): SandboxPolicyError {
    return this.createWorkspaceLeaseError(
      "user_stopped",
      "Sandbox job cancelled because the turn was stopped.",
      true
    );
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
