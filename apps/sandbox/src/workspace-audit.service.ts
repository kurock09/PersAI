import { Injectable, Logger } from "@nestjs/common";

/**
 * ADR-128 Slice 4 — structured audit events emitted by the unified files
 * contract. Every primitive on {@link WorkspaceFileBridgeService} produces an
 * event here so the unified files trail is queryable end-to-end (web /
 * Telegram upload → pod exec primitives → GC purge).
 *
 * The service intentionally writes to the Nest logger as structured key=value
 * lines instead of taking a Prisma write dependency. Prod log shipping picks
 * these up by event name and they roll up into the standard pod metrics
 * pipeline — no extra storage layer for events that are already covered by
 * Prometheus counters on the read side.
 */

export type WorkspaceFileOp = "write" | "read" | "list" | "stat" | "delete";

export type WorkspaceFilePublishedEvent = {
  workspaceId: string;
  assistantId: string;
  uploadOriginalName: string | null;
  resolvedRelPath: string;
  resolvedAbsPath: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  surface: "web" | "telegram";
};

export type WorkspaceFileBridgeEvent = {
  workspaceId: string;
  assistantId: string;
  /** Absolute pod path the primitive ran against. */
  absolutePath: string;
  /** Mount-relative form for audit/log readability. */
  relativePath: string;
  /** Result of the underlying exec — `"ok"` for success or an error code. */
  status: "ok" | "error";
  /** Pod exec exit code when available. */
  exitCode: number | null;
  /** Bytes written/read/listed where applicable. */
  bytes: number | null;
  /** Wall-clock duration in ms. */
  latencyMs: number;
  /** Op-specific error reason string when status === "error". */
  reason: string | null;
};

export type WorkspaceGcPurgedEvent = {
  leaseId: string;
  kind: "chat_scratch" | "assistant_outbound" | "workspace_shared";
  targetId: string;
  durationMs: number;
  /** Number of `workspace_file_metadata` rows removed by the purge. */
  metadataRowsRemoved: number;
  /** Number of warm pods touched. */
  podsTouched: number;
};

export type WorkspaceGcPurgeFailedEvent = {
  leaseId: string;
  kind: "chat_scratch" | "assistant_outbound" | "workspace_shared";
  targetId: string;
  reason: string;
};

export type WorkspaceFileAttachedEvent = {
  assistantId: string;
  workspaceId: string;
  chatId: string | null;
  sourcePath: string;
  targetPath: string;
  bytes: number;
};

@Injectable()
export class WorkspaceAuditService {
  private readonly logger = new Logger(WorkspaceAuditService.name);

  recordWorkspaceFilePublished(event: WorkspaceFilePublishedEvent): void {
    this.logger.log(
      [
        "audit_event=workspace_file_published",
        `workspace_id=${event.workspaceId}`,
        `assistant_id=${event.assistantId}`,
        `surface=${event.surface}`,
        `storage_path=${event.storagePath}`,
        `mime=${event.mimeType}`,
        `bytes=${String(event.sizeBytes)}`,
        `rel_path=${event.resolvedRelPath}`,
        `abs_path=${event.resolvedAbsPath}`,
        `upload_name=${event.uploadOriginalName ?? ""}`
      ].join(" ")
    );
  }

  recordWorkspaceFileAttached(event: WorkspaceFileAttachedEvent): void {
    this.logger.log(
      [
        "audit_event=workspace_file_attached",
        `workspace_id=${event.workspaceId}`,
        `assistant_id=${event.assistantId}`,
        `chat_id=${event.chatId ?? ""}`,
        `source_path=${event.sourcePath}`,
        `target_path=${event.targetPath}`,
        `bytes=${String(event.bytes)}`
      ].join(" ")
    );
  }

  recordWorkspaceFileOp(op: WorkspaceFileOp, event: WorkspaceFileBridgeEvent): void {
    const codeName = `workspace_file_${op === "delete" ? "deleted" : `${op}ed`}`;
    const line = [
      `audit_event=${codeName}`,
      `workspace_id=${event.workspaceId}`,
      `assistant_id=${event.assistantId}`,
      `abs_path=${event.absolutePath}`,
      `rel_path=${event.relativePath}`,
      `status=${event.status}`,
      `exit_code=${event.exitCode === null ? "" : String(event.exitCode)}`,
      `bytes=${event.bytes === null ? "" : String(event.bytes)}`,
      `latency_ms=${event.latencyMs.toFixed(1)}`,
      `reason=${event.reason ?? ""}`
    ].join(" ");
    if (event.status === "ok") {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
  }

  recordGcPurged(event: WorkspaceGcPurgedEvent): void {
    this.logger.log(
      [
        "audit_event=workspace_gc_purged",
        `lease_id=${event.leaseId}`,
        `kind=${event.kind}`,
        `target_id=${event.targetId}`,
        `duration_ms=${event.durationMs.toFixed(1)}`,
        `workspace_file_metadata_removed=${String(event.metadataRowsRemoved)}`,
        `pods_touched=${String(event.podsTouched)}`
      ].join(" ")
    );
  }

  recordGcPurgeFailed(event: WorkspaceGcPurgeFailedEvent): void {
    this.logger.warn(
      [
        "audit_event=workspace_gc_purge_failed",
        `lease_id=${event.leaseId}`,
        `kind=${event.kind}`,
        `target_id=${event.targetId}`,
        `reason=${event.reason}`
      ].join(" ")
    );
  }
}
