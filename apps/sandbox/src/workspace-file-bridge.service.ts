import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeSandboxPolicy } from "@persai/runtime-contract";
import { ExecPodBridgeService } from "./exec-pod-bridge.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { WorkspaceAuditService, type WorkspaceFileBridgeEvent } from "./workspace-audit.service";
import { resolveMacOsCollisionBasename } from "./shared-outbound-basename";
import {
  WorkspacePathError,
  assertAllowedMountPrefix,
  WORKSPACE_MOUNT_ROOT,
  type ResolvedWorkspacePath
} from "./workspace-path";

/**
 * ADR-128 Slice 4 — model-facing path primitives (list/read/stat/write/delete/copy)
 * for the `files.*` tool, operating on the single flat `/workspace` namespace
 * via the exec API.
 *
 * Every model-supplied path is validated by {@link assertAllowedMountPrefix}
 * before any shell command is composed; every interpolated value is
 * single-quote escaped via {@link posixSingleQuote}. There are no roles,
 * no read-only sub-trees, and no sibling-handle classification — anything
 * under `/workspace/` is read/write/delete for the model.
 */

export type WorkspaceBridgeContext = {
  assistantId: string;
  assistantHandle: string;
  siblingHandles: readonly string[];
  workspaceId: string;
  policy: RuntimeSandboxPolicy;
  workspaceQuotaBytes: number | null;
  sharedQuotaBytes: number | null;
};

export type WorkspaceFileBridgeFailureReason =
  | "write_denied"
  | "create_only_collision"
  | "write_failed"
  | "workspace_quota_exhausted"
  | "path_not_found"
  | "read_failed"
  | "list_failed"
  | "stat_failed"
  | "delete_denied"
  | "delete_failed"
  | "copy_failed"
  | "publish_failed";

export type WorkspaceFileBridgeResult<T> = {
  success: boolean;
  reason: WorkspaceFileBridgeFailureReason | null;
  latencyMs: number;
  data: T;
};

export type WorkspaceFileListing = {
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  modifiedAt: string;
};

export type WorkspaceFileStat = {
  path: string;
  type: "file" | "directory" | "missing";
  sizeBytes: number;
  modifiedAt: string | null;
};

export type WorkspaceFileReadResult = {
  path: string;
  bytes: Buffer;
  truncated: boolean;
};

/**
 * Maximum bytes returned from a single bridge read. `files.read` rejects
 * larger requests upstream via the model-facing policy; this is the
 * bridge-level hard ceiling.
 */
const MAX_READ_BYTES = 16 * 1024 * 1024;

function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * ADR-128 Slice 4 — defense-in-depth check on basenames that flow into a
 * control-plane workspace write. Rules mirror
 * `resolveMacOsCollisionBasename`'s assumptions: non-empty, no path
 * separators, no `..`, no NUL.
 */
function isValidWorkspaceBasename(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value === "." || value === "..") {
    return false;
  }
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return true;
}

@Injectable()
export class WorkspaceFileBridgeService {
  private readonly logger = new Logger(WorkspaceFileBridgeService.name);

  constructor(
    private readonly execPodBridgeService: ExecPodBridgeService,
    private readonly sandboxObjectStorageService: SandboxObjectStorageService,
    private readonly sandboxObservabilityService: SandboxObservabilityService,
    private readonly workspaceAuditService: WorkspaceAuditService
  ) {}

  /**
   * Resolve and validate a model-supplied path. Throws
   * {@link WorkspacePathError} on any escape attempt.
   */
  resolveModelPath(_ctx: WorkspaceBridgeContext, modelPath: string): ResolvedWorkspacePath {
    return assertAllowedMountPrefix(modelPath);
  }

  /**
   * ADR-128 Slice 4 — control-plane artefact write into
   * `/workspace/<basename>` with macOS-style collision resolution.
   */
  async writeWorkspaceFileWithCollision(
    ctx: WorkspaceBridgeContext,
    input: {
      basename: string;
      contents: Buffer;
      collisionStrategy?: "overwrite" | "numeric_suffix";
    }
  ): Promise<
    WorkspaceFileBridgeResult<{
      resolvedPath: string;
      workspaceRelPath: string;
      resolvedBasename: string;
      bytes: number;
    }>
  > {
    let resolvedBasename = input.basename;
    if (input.collisionStrategy === "numeric_suffix") {
      const listResult = await this.workspaceFileList(ctx, { path: WORKSPACE_MOUNT_ROOT });
      const existingNames = new Set(
        (listResult.success ? listResult.data : [])
          .filter((entry) => entry.type === "file")
          .map((entry) => {
            const slash = entry.path.lastIndexOf("/");
            return slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
          })
      );
      resolvedBasename = resolveMacOsCollisionBasename(input.basename, existingNames);
    }
    const targetPath = `${WORKSPACE_MOUNT_ROOT}/${resolvedBasename}`;
    const writeResult = await this.workspaceFileWrite(ctx, {
      path: targetPath,
      contents: input.contents,
      mode: "overwrite"
    });
    return {
      success: writeResult.success,
      reason: writeResult.reason,
      latencyMs: writeResult.latencyMs,
      data: {
        resolvedPath: writeResult.data.resolvedPath,
        workspaceRelPath: targetPath,
        resolvedBasename,
        bytes: writeResult.data.bytes
      }
    };
  }

  /**
   * ADR-128 Slice 4 — control-plane workspace bytes-push.
   *
   * Writes directly to `/workspace/<basename>` so a web upload becomes
   * visible to the running pod immediately, not only after the next
   * cold-pod hydrate. Caller (API `manage-chat-media.stageForWebThread`) is
   * responsible for:
   *   * GCS mirror (already done before this call — single source of truth),
   *   * basename uniqueness,
   *   * quota accounting (already booked by the API; nullable quotas are
   *     passed through so the pod-side bridge does NOT double-count).
   *
   * Behaviour matrix:
   *   * explicit path writes are turn-critical internal sidecars and use the
   *     normal workspace writer, so the file is visible immediately.
   *   * basename-only uploads stay best-effort: pod not Running → `success:
   *     true, mode: "deferred"` (next cold-start hydrate will pull the bytes
   *     from GCS).
   *   * pod Running but exec fails → `success: false, reason="write_failed"`.
   *   * pod Running + exec ok → `success: true, mode="written"`.
   */
  async writeWorkspaceFileControlPlane(
    ctx: WorkspaceBridgeContext,
    input: {
      basename?: string | null;
      path?: string | null;
      contents: Buffer;
    }
  ): Promise<
    WorkspaceFileBridgeResult<{
      workspaceRelPath: string;
      absolutePath: string;
      bytes: number;
      mode: "written" | "deferred";
    }>
  > {
    const explicitPath =
      typeof input.path === "string" && input.path.trim().length > 0 ? input.path.trim() : null;
    if (explicitPath !== null) {
      const writeResult = await this.workspaceFileWrite(ctx, {
        path: explicitPath,
        contents: input.contents,
        mode: "overwrite"
      });
      const resolvedPath = writeResult.data.resolvedPath;
      return {
        success: writeResult.success,
        reason: writeResult.reason,
        latencyMs: writeResult.latencyMs,
        data: {
          workspaceRelPath: resolvedPath,
          absolutePath: resolvedPath,
          bytes: writeResult.success ? writeResult.data.bytes : 0,
          mode: "written"
        }
      };
    }

    const targetPath =
      typeof input.basename === "string" && isValidWorkspaceBasename(input.basename)
        ? `${WORKSPACE_MOUNT_ROOT}/${input.basename}`
        : null;
    if (targetPath === null) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: `${WORKSPACE_MOUNT_ROOT}/${input.basename ?? ""}`,
        relativePath: input.basename ?? "",
        status: "error",
        exitCode: null,
        bytes: null,
        latencyMs: 0,
        reason: "write_denied"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("write", event);
      return {
        success: false,
        reason: "write_denied",
        latencyMs: 0,
        data: {
          workspaceRelPath: `${WORKSPACE_MOUNT_ROOT}/${input.basename ?? ""}`,
          absolutePath: `${WORKSPACE_MOUNT_ROOT}/${input.basename ?? ""}`,
          bytes: 0,
          mode: "written"
        }
      };
    }
    const quotedDir = posixSingleQuote(WORKSPACE_MOUNT_ROOT);
    const quotedTarget = posixSingleQuote(targetPath);
    const shellCommand = [
      "set -e",
      `mkdir -p ${quotedDir}`,
      `mkdir -p ${posixSingleQuote(this.parentDir(targetPath))}`,
      `chmod 0755 ${quotedDir}`,
      `cat > ${quotedTarget}`
    ].join(" && ");

    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.tryExecShellInExistingSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: input.contents
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("write", latencyMs);

    if (podResult === null) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: targetPath,
        relativePath: this.toWorkspaceRelPath(targetPath).replace(`${WORKSPACE_MOUNT_ROOT}/`, ""),
        status: "ok",
        exitCode: 0,
        bytes: input.contents.length,
        latencyMs,
        reason: null
      };
      this.workspaceAuditService.recordWorkspaceFileOp("write", event);
      return {
        success: true,
        reason: null,
        latencyMs,
        data: {
          workspaceRelPath: targetPath,
          absolutePath: targetPath,
          bytes: input.contents.length,
          mode: "deferred"
        }
      };
    }

    const success = podResult.exitCode === 0;
    const reason: WorkspaceFileBridgeFailureReason | null = success ? null : "write_failed";
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: targetPath,
      relativePath: this.toWorkspaceRelPath(targetPath).replace(`${WORKSPACE_MOUNT_ROOT}/`, ""),
      status: success ? "ok" : "error",
      exitCode: podResult.exitCode,
      bytes: success ? input.contents.length : null,
      latencyMs,
      reason
    };
    this.workspaceAuditService.recordWorkspaceFileOp("write", event);
    return {
      success,
      reason,
      latencyMs,
      data: {
        workspaceRelPath: targetPath,
        absolutePath: targetPath,
        bytes: success ? input.contents.length : 0,
        mode: "written"
      }
    };
  }

  async workspaceFileWrite(
    ctx: WorkspaceBridgeContext,
    input: {
      path: string;
      contents: Buffer;
      mode?: "overwrite" | "create_only";
    }
  ): Promise<WorkspaceFileBridgeResult<{ resolvedPath: string; bytes: number }>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    const quotaExhaustedReason = await this.checkStorageQuotaBeforeWrite(
      ctx,
      input.contents.length
    );
    if (quotaExhaustedReason !== null) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: null,
        bytes: null,
        latencyMs: 0,
        reason: quotaExhaustedReason
      };
      this.workspaceAuditService.recordWorkspaceFileOp("write", event);
      return {
        success: false,
        reason: quotaExhaustedReason,
        latencyMs: 0,
        data: { resolvedPath: resolved.absolutePath, bytes: 0 }
      };
    }
    const mode = input.mode ?? "overwrite";
    const shellCommand = [
      `mkdir -p ${posixSingleQuote(this.parentDir(resolved.absolutePath))}`,
      mode === "create_only"
        ? `if [ -e ${posixSingleQuote(resolved.absolutePath)} ]; then echo create_only_collision >&2; exit 64; fi`
        : ":",
      `cat > ${posixSingleQuote(resolved.absolutePath)}`
    ].join(" && ");

    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: input.contents
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("write", latencyMs);

    const success = podResult.exitCode === 0;
    const reason = success
      ? null
      : podResult.exitCode === 64
        ? "create_only_collision"
        : "write_failed";
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      status: success ? "ok" : "error",
      exitCode: podResult.exitCode,
      bytes: success ? input.contents.length : null,
      latencyMs,
      reason
    };
    this.workspaceAuditService.recordWorkspaceFileOp("write", event);

    if (success) {
      try {
        await this.sandboxObjectStorageService.saveObject({
          objectKey: this.sandboxObjectStorageService.buildWorkspaceObjectKey({
            workspaceId: ctx.workspaceId,
            workspaceRelPath: this.toWorkspaceRelPath(resolved.absolutePath)
          }),
          buffer: input.contents,
          mimeType: "application/octet-stream"
        });
      } catch (error) {
        this.logger.warn(
          `workspace_file_write_gcs_persist_failed workspace=${ctx.workspaceId} path=${resolved.absolutePath} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      success,
      reason,
      latencyMs,
      data: {
        resolvedPath: resolved.absolutePath,
        bytes: input.contents.length
      }
    };
  }

  async workspaceFileRead(
    ctx: WorkspaceBridgeContext,
    input: { path: string; maxBytes?: number }
  ): Promise<WorkspaceFileBridgeResult<WorkspaceFileReadResult | null>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    const maxBytes = Math.min(input.maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);

    const shellCommand = `if [ ! -f ${posixSingleQuote(resolved.absolutePath)} ]; then echo path_not_found >&2; exit 65; fi; head -c ${String(maxBytes)} ${posixSingleQuote(resolved.absolutePath)} | base64 -w 0; printf '\\n'; if [ "$(wc -c < ${posixSingleQuote(resolved.absolutePath)})" -gt ${String(maxBytes)} ]; then echo TRUNCATED; fi`;
    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: null
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("read", latencyMs);

    if (podResult.exitCode === 65) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: 65,
        bytes: null,
        latencyMs,
        reason: "path_not_found"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("read", event);
      return { success: false, reason: "path_not_found", latencyMs, data: null };
    }
    if (podResult.exitCode !== 0) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: podResult.exitCode,
        bytes: null,
        latencyMs,
        reason: "read_failed"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("read", event);
      return { success: false, reason: "read_failed", latencyMs, data: null };
    }

    const lines = podResult.stdout.split("\n");
    const base64Body = lines[0] ?? "";
    const truncated = lines.includes("TRUNCATED");
    const buffer = Buffer.from(base64Body, "base64");
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      status: "ok",
      exitCode: 0,
      bytes: buffer.length,
      latencyMs,
      reason: null
    };
    this.workspaceAuditService.recordWorkspaceFileOp("read", event);
    return {
      success: true,
      reason: null,
      latencyMs,
      data: {
        path: resolved.absolutePath,
        bytes: buffer,
        truncated
      }
    };
  }

  async workspaceFileList(
    ctx: WorkspaceBridgeContext,
    input: { path: string; maxEntries?: number }
  ): Promise<WorkspaceFileBridgeResult<WorkspaceFileListing[]>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    const maxEntries = Math.min(Math.max(input.maxEntries ?? 200, 1), 1_000);
    const shellCommand = `if [ ! -d ${posixSingleQuote(resolved.absolutePath)} ]; then echo path_not_found >&2; exit 65; fi; find ${posixSingleQuote(resolved.absolutePath)} -mindepth 1 -maxdepth 1 -printf '%p\\t%y\\t%s\\t%T@\\n' | head -n ${String(maxEntries)}`;
    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: null
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("list", latencyMs);

    if (podResult.exitCode === 65) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: 65,
        bytes: null,
        latencyMs,
        reason: "path_not_found"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("list", event);
      return { success: false, reason: "path_not_found", latencyMs, data: [] };
    }
    if (podResult.exitCode !== 0) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: podResult.exitCode,
        bytes: null,
        latencyMs,
        reason: "list_failed"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("list", event);
      return { success: false, reason: "list_failed", latencyMs, data: [] };
    }
    const entries: WorkspaceFileListing[] = [];
    for (const rawLine of podResult.stdout.split("\n")) {
      const line = rawLine.trimEnd();
      if (line.length === 0) {
        continue;
      }
      const parts = line.split("\t");
      if (parts.length < 4) {
        continue;
      }
      const [path, type, sizePart, mtimePart] = parts;
      if (path === undefined || type === undefined) {
        continue;
      }
      const sizeBytes = Number.parseInt(sizePart ?? "0", 10);
      const mtimeEpoch = Number.parseFloat(mtimePart ?? "0");
      entries.push({
        path,
        type: type === "d" ? "directory" : "file",
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        modifiedAt: Number.isFinite(mtimeEpoch)
          ? new Date(mtimeEpoch * 1000).toISOString()
          : new Date(0).toISOString()
      });
    }
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      status: "ok",
      exitCode: 0,
      bytes: entries.length,
      latencyMs,
      reason: null
    };
    this.workspaceAuditService.recordWorkspaceFileOp("list", event);
    return {
      success: true,
      reason: null,
      latencyMs,
      data: entries
    };
  }

  async workspaceFileStat(
    ctx: WorkspaceBridgeContext,
    input: { path: string }
  ): Promise<WorkspaceFileBridgeResult<WorkspaceFileStat>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    const shellCommand = `if [ ! -e ${posixSingleQuote(resolved.absolutePath)} ]; then echo missing; exit 0; fi; if [ -d ${posixSingleQuote(resolved.absolutePath)} ]; then echo directory; printf '%s\\n%s\\n' "$(du -sb ${posixSingleQuote(resolved.absolutePath)} | cut -f1)" "$(stat -c '%Y' ${posixSingleQuote(resolved.absolutePath)})"; else echo file; printf '%s\\n%s\\n' "$(stat -c '%s' ${posixSingleQuote(resolved.absolutePath)})" "$(stat -c '%Y' ${posixSingleQuote(resolved.absolutePath)})"; fi`;
    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: null
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("stat", latencyMs);
    const lines = podResult.stdout.split("\n").map((line) => line.trim());
    const kind = lines[0] ?? "missing";
    let stat: WorkspaceFileStat;
    if (kind === "missing") {
      stat = {
        path: resolved.absolutePath,
        type: "missing",
        sizeBytes: 0,
        modifiedAt: null
      };
    } else {
      const sizeBytes = Number.parseInt(lines[1] ?? "0", 10);
      const mtimeEpoch = Number.parseInt(lines[2] ?? "0", 10);
      stat = {
        path: resolved.absolutePath,
        type: kind === "directory" ? "directory" : "file",
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        modifiedAt: Number.isFinite(mtimeEpoch) ? new Date(mtimeEpoch * 1000).toISOString() : null
      };
    }
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      status: podResult.exitCode === 0 ? "ok" : "error",
      exitCode: podResult.exitCode,
      bytes: stat.sizeBytes,
      latencyMs,
      reason: podResult.exitCode === 0 ? null : "stat_failed"
    };
    this.workspaceAuditService.recordWorkspaceFileOp("stat", event);
    return {
      success: podResult.exitCode === 0,
      reason: podResult.exitCode === 0 ? null : "stat_failed",
      latencyMs,
      data: stat
    };
  }

  async workspaceFileCopy(
    ctx: WorkspaceBridgeContext,
    input: {
      sourcePath: string;
      targetPath: string;
      chatId?: string | null;
    }
  ): Promise<
    WorkspaceFileBridgeResult<{
      sourcePath: string;
      targetPath: string;
      bytes: number;
    }>
  > {
    const sourceResolved = this.resolveModelPath(ctx, input.sourcePath);
    const targetResolved = this.resolveModelPath(ctx, input.targetPath);
    if (sourceResolved.absolutePath === targetResolved.absolutePath) {
      const stat = await this.workspaceFileStat(ctx, { path: sourceResolved.absolutePath });
      const bytes = stat.success && stat.data.type === "file" ? stat.data.sizeBytes : 0;
      return {
        success: true,
        reason: null,
        latencyMs: stat.latencyMs,
        data: {
          sourcePath: sourceResolved.absolutePath,
          targetPath: targetResolved.absolutePath,
          bytes
        }
      };
    }

    const shellCommand = [
      `mkdir -p ${posixSingleQuote(this.parentDir(targetResolved.absolutePath))}`,
      `cp -f ${posixSingleQuote(sourceResolved.absolutePath)} ${posixSingleQuote(targetResolved.absolutePath)}`
    ].join(" && ");
    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: null
    });
    const latencyMs = Date.now() - startedAt;
    const success = podResult.exitCode === 0;
    const reason = success ? null : "copy_failed";
    this.sandboxObservabilityService.recordWorkspaceFileAttachLatency(
      success ? "ok" : "error",
      latencyMs
    );

    if (!success) {
      this.workspaceAuditService.recordWorkspaceFileAttached({
        assistantId: ctx.assistantId,
        workspaceId: ctx.workspaceId,
        chatId: input.chatId ?? null,
        sourcePath: sourceResolved.absolutePath,
        targetPath: targetResolved.absolutePath,
        bytes: 0
      });
      return {
        success: false,
        reason,
        latencyMs,
        data: {
          sourcePath: sourceResolved.absolutePath,
          targetPath: targetResolved.absolutePath,
          bytes: 0
        }
      };
    }

    const readResult = await this.workspaceFileRead(ctx, {
      path: targetResolved.absolutePath
    });
    const bytes = readResult.success && readResult.data !== null ? readResult.data.bytes.length : 0;
    if (readResult.success && readResult.data !== null) {
      try {
        await this.sandboxObjectStorageService.saveObject({
          objectKey: this.sandboxObjectStorageService.buildWorkspaceObjectKey({
            workspaceId: ctx.workspaceId,
            workspaceRelPath: this.toWorkspaceRelPath(targetResolved.absolutePath)
          }),
          buffer: readResult.data.bytes,
          mimeType: "application/octet-stream"
        });
      } catch (error) {
        this.logger.warn(
          `workspace_file_copy_gcs_persist_failed workspace=${ctx.workspaceId} path=${targetResolved.absolutePath} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.workspaceAuditService.recordWorkspaceFileAttached({
      assistantId: ctx.assistantId,
      workspaceId: ctx.workspaceId,
      chatId: input.chatId ?? null,
      sourcePath: sourceResolved.absolutePath,
      targetPath: targetResolved.absolutePath,
      bytes
    });

    return {
      success: true,
      reason: null,
      latencyMs,
      data: {
        sourcePath: sourceResolved.absolutePath,
        targetPath: targetResolved.absolutePath,
        bytes
      }
    };
  }

  async workspaceFilePersist(
    ctx: WorkspaceBridgeContext,
    input: {
      path: string;
      mimeType: string;
    }
  ): Promise<
    WorkspaceFileBridgeResult<{
      path: string;
      bytes: number;
    }>
  > {
    const resolved = this.resolveModelPath(ctx, input.path);
    const startedAt = Date.now();
    let bytes: Buffer;
    try {
      const readResult = await this.execPodBridgeService.readWorkspaceFileFromSessionPod({
        assistantId: ctx.assistantId,
        assistantHandle: ctx.assistantHandle,
        siblingHandles: ctx.siblingHandles,
        workspaceId: ctx.workspaceId,
        policy: ctx.policy,
        absolutePath: resolved.absolutePath,
        maxBytes: Math.max(ctx.policy.webMaxOutboundBytes, ctx.policy.telegramMaxOutboundBytes)
      });
      bytes = readResult.bytes;
    } catch (error) {
      this.logger.warn(
        `workspace_file_publish_pod_read_failed workspace=${ctx.workspaceId} path=${resolved.absolutePath} reason=${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        reason: "publish_failed",
        latencyMs: Date.now() - startedAt,
        data: {
          path: resolved.absolutePath,
          bytes: 0
        }
      };
    }

    try {
      await this.sandboxObjectStorageService.saveObject({
        objectKey: this.sandboxObjectStorageService.buildWorkspaceObjectKey({
          workspaceId: ctx.workspaceId,
          workspaceRelPath: this.toWorkspaceRelPath(resolved.absolutePath)
        }),
        buffer: bytes,
        mimeType: input.mimeType
      });
    } catch (error) {
      this.logger.warn(
        `workspace_file_publish_gcs_persist_failed workspace=${ctx.workspaceId} path=${resolved.absolutePath} reason=${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        reason: "publish_failed",
        latencyMs: Date.now() - startedAt,
        data: {
          path: resolved.absolutePath,
          bytes: bytes.length
        }
      };
    }

    return {
      success: true,
      reason: null,
      latencyMs: Date.now() - startedAt,
      data: {
        path: resolved.absolutePath,
        bytes: bytes.length
      }
    };
  }

  async workspaceFileDelete(
    ctx: WorkspaceBridgeContext,
    input: { path: string; recursive?: boolean }
  ): Promise<WorkspaceFileBridgeResult<{ removed: boolean }>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    const recursive = input.recursive === true;
    const shellCommand = `if [ ! -e ${posixSingleQuote(resolved.absolutePath)} ]; then echo path_not_found >&2; exit 65; fi; rm ${recursive ? "-rf" : "-f"} ${posixSingleQuote(resolved.absolutePath)}`;
    const startedAt = Date.now();
    const podResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand,
      stdin: null
    });
    const latencyMs = Date.now() - startedAt;
    this.sandboxObservabilityService.recordWorkspaceFileLatency("delete", latencyMs);
    if (podResult.exitCode === 65) {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: 65,
        bytes: null,
        latencyMs,
        reason: "path_not_found"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("delete", event);
      return { success: false, reason: "path_not_found", latencyMs, data: { removed: false } };
    }
    const success = podResult.exitCode === 0;
    const event: WorkspaceFileBridgeEvent = {
      workspaceId: ctx.workspaceId,
      assistantId: ctx.assistantId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      status: success ? "ok" : "error",
      exitCode: podResult.exitCode,
      bytes: null,
      latencyMs,
      reason: success ? null : "delete_failed"
    };
    this.workspaceAuditService.recordWorkspaceFileOp("delete", event);

    if (success) {
      try {
        const relPath = this.toWorkspaceRelPath(resolved.absolutePath);
        const objectKey = this.sandboxObjectStorageService.buildWorkspaceObjectKey({
          workspaceId: ctx.workspaceId,
          workspaceRelPath: relPath
        });
        await this.sandboxObjectStorageService.deletePrefix(objectKey);
      } catch (error) {
        this.logger.warn(
          `workspace_file_delete_gcs_purge_failed workspace=${ctx.workspaceId} path=${resolved.absolutePath} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      success,
      reason: success ? null : "delete_failed",
      latencyMs,
      data: { removed: success }
    };
  }

  private parentDir(absolutePath: string): string {
    const idx = absolutePath.lastIndexOf("/");
    if (idx <= 0) {
      return "/";
    }
    return absolutePath.slice(0, idx);
  }

  private async checkStorageQuotaBeforeWrite(
    ctx: WorkspaceBridgeContext,
    newBytes: number
  ): Promise<"workspace_quota_exhausted" | null> {
    // ADR-128 Slice 4: a single flat workspace has a single quota. We respect
    // whichever non-null cap the caller supplied (the API books bytes against
    // `sharedQuotaBytes`; older surfaces still pass `workspaceQuotaBytes`).
    // Pick the tighter of the two so neither plumbing path can over-consume.
    const candidateCaps = [ctx.sharedQuotaBytes, ctx.workspaceQuotaBytes].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    if (candidateCaps.length === 0) {
      return null;
    }
    const cap = candidateCaps.reduce(
      (acc, value) => Math.min(acc, value),
      Number.POSITIVE_INFINITY
    );
    const subtree = `${WORKSPACE_MOUNT_ROOT}/`;

    const duCommand = `du -sb ${posixSingleQuote(subtree)} | cut -f1`;
    const duResult = await this.execPodBridgeService.execShellInSessionPod({
      assistantId: ctx.assistantId,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: ctx.siblingHandles,
      workspaceId: ctx.workspaceId,
      policy: ctx.policy,
      shellCommand: duCommand,
      stdin: null
    });
    if (duResult.exitCode !== 0) {
      this.logger.warn(
        `workspace_file_write_quota_du_failed workspace=${ctx.workspaceId} subtree=${subtree} exitCode=${String(duResult.exitCode)}`
      );
      return null;
    }
    const currentBytes = Number.parseInt(duResult.stdout.trim(), 10);
    if (!Number.isFinite(currentBytes) || currentBytes < 0) {
      this.logger.warn(
        `workspace_file_write_quota_du_parse_failed workspace=${ctx.workspaceId} subtree=${subtree} stdout=${duResult.stdout.trim()}`
      );
      return null;
    }
    if (currentBytes + newBytes > cap) {
      return "workspace_quota_exhausted";
    }
    return null;
  }

  private toWorkspaceRelPath(absolutePath: string): string {
    return absolutePath.startsWith(`${WORKSPACE_MOUNT_ROOT}/`)
      ? absolutePath
      : `${WORKSPACE_MOUNT_ROOT}/${absolutePath}`;
  }
}

// Defensive: callers may still pattern-match `WorkspacePathError` instances.
export { WorkspacePathError };
