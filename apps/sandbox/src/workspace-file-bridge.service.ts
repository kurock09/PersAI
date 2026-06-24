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
  buildSharedRoot,
  buildWorkspaceRoot,
  type ResolvedWorkspacePath,
  type WorkspaceMountRoots
} from "./workspace-path";

/**
 * ADR-126 Slice 3 — model-facing path primitives (list/read/stat/write/delete)
 * for the `files.*` tool, operating on the unified `/workspace` +
 * `/shared/<workspaceId>` namespace via the exec API. The runtime tool
 * (`apps/runtime/src/modules/turns/runtime-files-tool.service.ts`) delegates
 * here for every read/write/list/stat/delete it issues on behalf of the model.
 *
 * This bridge is *not* the upload ingestion path. Founder/web uploads land in
 * GCS via the API's `assistant-file-registry.service.ts`
 * (`mirrorUploadToSharedGcs`) and are hydrated into pods lazily by the warm
 * pod's mount layer — they do not flow through this file.
 *
 * Responsibilities owned here: container-side path containment (via
 * {@link assertAllowedMountPrefix}), audit emission (via
 * {@link WorkspaceAuditService}), and `chmod` role enforcement (workspace vs
 * shared-input vs outbound). Path containment runs before any shell command is
 * composed; every model-supplied path is single-quote escaped via
 * {@link posixSingleQuote} before interpolation.
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
  | "shared_quota_exhausted"
  | "path_not_found"
  | "read_failed"
  | "list_failed"
  | "stat_failed"
  | "delete_denied"
  | "delete_failed"
  | "copy_failed";

/**
 * Outcome of a bridge primitive. Returned to the caller and emitted to the
 * audit log via {@link WorkspaceAuditService}. The bridge never throws on
 * non-existent-path read/delete; instead the result carries `success=false`
 * with a stable reason code that the model-facing tool surfaces verbatim.
 */
export type WorkspaceFileBridgeResult<T> = {
  success: boolean;
  /** Stable, model-visible reason when `success === false`. */
  reason: WorkspaceFileBridgeFailureReason | null;
  /** Latency in milliseconds for the underlying pod exec. */
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
 * Maximum bytes we will return from a single bridge read. The pod-side `head`
 * we shell into is bounded so a runaway file does not stream gigabytes through
 * the exec WebSocket. `files.read` will reject anything larger via the
 * model-facing policy; this is the bridge-level hard ceiling.
 */
const MAX_READ_BYTES = 16 * 1024 * 1024;

function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
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

  /** Build the canonical mount-root pair for a workspace. */
  static buildMountRoots(workspaceId: string): WorkspaceMountRoots {
    return {
      workspaceRoot: buildWorkspaceRoot(),
      sharedRoot: buildSharedRoot(workspaceId)
    };
  }

  /**
   * Resolve and validate a model-supplied path against the canonical mount
   * roots for this assistant. Throws `WorkspacePathError` on any escape
   * attempt. Exposed publicly so the runtime tool layer can compute the
   * resolved role (e.g. to decide whether `files.write` is allowed) without
   * re-running the bridge.
   */
  resolveModelPath(ctx: WorkspaceBridgeContext, modelPath: string): ResolvedWorkspacePath {
    const roots = WorkspaceFileBridgeService.buildMountRoots(ctx.workspaceId);
    return assertAllowedMountPrefix(modelPath, {
      roots,
      assistantHandle: ctx.assistantHandle,
      siblingHandles: new Set(ctx.siblingHandles)
    });
  }

  /**
   * ADR-126 Slice 4 Wave 2 — control-plane artefact dual-write into
   * `/shared/outbound/self/<basename>` with macOS-style collision resolution.
   */
  async writeSharedOutboundWithCollision(
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
    const outboundDir = `/shared/${ctx.workspaceId}/outbound/self`;
    let resolvedBasename = input.basename;
    if (input.collisionStrategy === "numeric_suffix") {
      const listResult = await this.workspaceFileList(ctx, { path: outboundDir });
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
    const targetPath = `${outboundDir}/${resolvedBasename}`;
    const writeResult = await this.workspaceFileWrite(ctx, {
      path: targetPath,
      contents: input.contents,
      mode: "overwrite"
    });
    const workspaceRelPath = `/shared/outbound/self/${resolvedBasename}`;
    return {
      success: writeResult.success,
      reason: writeResult.reason,
      latencyMs: writeResult.latencyMs,
      data: {
        resolvedPath: writeResult.data.resolvedPath,
        workspaceRelPath,
        resolvedBasename,
        bytes: writeResult.data.bytes
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
    // Sibling outbound and shared input are not writable from the model
    // surface. The bridge service is the only legitimate write path; we treat
    // the model attempt to write here as a typed bridge-layer rejection (the
    // sandbox file tool surfaces this as a stable reason code rather than a
    // generic file-not-allowed error).
    if (resolved.role.kind === "shared_outbound_other" || resolved.role.kind === "shared_input") {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
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
        data: { resolvedPath: resolved.absolutePath, bytes: 0 }
      };
    }
    const quotaExhaustedReason = await this.checkStorageQuotaBeforeWrite(
      ctx,
      resolved,
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

    if (success && this.isSharedRole(resolved)) {
      // Mirror the bytes to GCS so cold pods can rematerialise them.
      try {
        await this.sandboxObjectStorageService.saveObject({
          objectKey: this.sandboxObjectStorageService.buildSharedObjectKey({
            workspaceId: ctx.workspaceId,
            workspaceRelPath: this.toSharedRelPath(resolved.absolutePath, ctx.workspaceId)
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
    // `find -maxdepth 1` lists the direct children of the directory only,
    // mirroring the model's expectation of `files.list <dir>`. `printf` uses
    // tab as the field separator so a single split call recovers the columns.
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
    if (
      sourceResolved.role.kind !== "workspace" &&
      sourceResolved.role.kind !== "shared_outbound_self"
    ) {
      throw new WorkspacePathError(
        "outside_allowed_mount",
        "files.attach source must be under /workspace/ or /shared/outbound/self/"
      );
    }
    if (targetResolved.role.kind !== "shared_outbound_self") {
      throw new WorkspacePathError(
        "outside_allowed_mount",
        "files.attach target must be under /shared/outbound/self/"
      );
    }
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
          objectKey: this.sandboxObjectStorageService.buildSharedObjectKey({
            workspaceId: ctx.workspaceId,
            workspaceRelPath: this.toSharedRelPath(targetResolved.absolutePath, ctx.workspaceId)
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

  async workspaceFileDelete(
    ctx: WorkspaceBridgeContext,
    input: { path: string; recursive?: boolean }
  ): Promise<WorkspaceFileBridgeResult<{ removed: boolean }>> {
    const resolved = this.resolveModelPath(ctx, input.path);
    if (resolved.role.kind === "shared_outbound_other" || resolved.role.kind === "shared_input") {
      const event: WorkspaceFileBridgeEvent = {
        workspaceId: ctx.workspaceId,
        assistantId: ctx.assistantId,
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        status: "error",
        exitCode: null,
        bytes: null,
        latencyMs: 0,
        reason: "delete_denied"
      };
      this.workspaceAuditService.recordWorkspaceFileOp("delete", event);
      return {
        success: false,
        reason: "delete_denied",
        latencyMs: 0,
        data: { removed: false }
      };
    }
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

    if (success && this.isSharedRole(resolved)) {
      try {
        const relPath = this.toSharedRelPath(resolved.absolutePath, ctx.workspaceId);
        const objectKey = this.sandboxObjectStorageService.buildSharedObjectKey({
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
    resolved: ResolvedWorkspacePath,
    newBytes: number
  ): Promise<"workspace_quota_exhausted" | "shared_quota_exhausted" | null> {
    let cap: number | null;
    let subtree: string;
    let exhaustedReason: "workspace_quota_exhausted" | "shared_quota_exhausted";

    if (resolved.role.kind === "workspace") {
      cap = ctx.workspaceQuotaBytes;
      subtree = "/workspace/";
      exhaustedReason = "workspace_quota_exhausted";
    } else if (this.isSharedRole(resolved)) {
      cap = ctx.sharedQuotaBytes;
      subtree = `/shared/${ctx.workspaceId}/`;
      exhaustedReason = "shared_quota_exhausted";
    } else {
      return null;
    }

    if (cap === null) {
      return null;
    }

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
      return exhaustedReason;
    }
    return null;
  }

  private isSharedRole(resolved: ResolvedWorkspacePath): boolean {
    return resolved.role.kind !== "workspace";
  }

  private toSharedRelPath(absolutePath: string, workspaceId: string): string {
    const sharedRoot = `/shared/${workspaceId}/`;
    if (!absolutePath.startsWith(sharedRoot)) {
      return absolutePath.replace(/^\/shared\/[^/]+\//, "/shared/");
    }
    return `/shared/${absolutePath.slice(sharedRoot.length)}`;
  }
}
