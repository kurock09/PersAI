import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import { buildAssistantSessionRoot, buildAssistantWorkspaceRoot } from "@persai/runtime-contract";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { SANDBOX_CONFIG } from "./sandbox-config";
import { ExecPodBridgeService } from "./exec-pod-bridge.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { WorkspaceAuditService } from "./workspace-audit.service";

/**
 * ADR-128 Slice 4 — deferred garbage collector for sandbox workspace state.
 *
 * The reaper drains rows from `sandbox_workspace_gc_lease` whose
 * `scheduled_at <= now() AND purged_at IS NULL`, validates the kind-specific
 * `metadata` blob against a Zod schema, then performs the matching purge.
 *
 * ADR-133 Slice 2 keeps the existing producer rows in the database for now, but
 * maps them to hierarchy-aligned sandbox semantics at the boundary:
 *
 * - `session_subtree` cleanup purges one session directory under
 *   `/workspace/assistants/<assistantId>/sessions/<sessionId>/...` when
 *   `metadata.sessionId` is present; legacy leases without `sessionId` fall
 *   back to the assistant-wide sandbox-snapshot prefix.
 * - `assistant_subtree` cleanup purges `/workspace/assistants/<assistantId>/...`.
 * - `workspace_subtree` cleanup purges the whole visible workspace tree.
 *
 * On any failure the lease stays open; the next tick retries. Successful
 * purges set `purged_at = now()` so the row is no longer returned by the due
 * scan.
 */

const SESSION_SUBTREE_METADATA = z.object({
  workspaceId: z.string().uuid(),
  assistantId: z.string().uuid(),
  sessionId: z.string().uuid().optional()
});

const ASSISTANT_SUBTREE_METADATA = z.object({
  workspaceId: z.string().uuid(),
  assistantId: z.string().uuid()
});

const WORKSPACE_SUBTREE_METADATA = z.object({}).passthrough();

type WorkspaceGcKind = "session_subtree" | "assistant_subtree" | "workspace_subtree";
type DbWorkspaceGcKind = WorkspaceGcKind;

type RunDuePurgesNowFilter =
  | { kind: "session_subtree"; targetId: string }
  | { kind: "assistant_subtree"; targetId: string }
  | { kind: "workspace_subtree"; targetId: string };

type SandboxGcLease =
  | { id: string; kind: "session_subtree"; targetId: string; metadata: Prisma.JsonValue }
  | { id: string; kind: "assistant_subtree"; targetId: string; metadata: Prisma.JsonValue }
  | { id: string; kind: "workspace_subtree"; targetId: string; metadata: Prisma.JsonValue };

@Injectable()
export class WorkspaceGcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceGcService.name);
  private cronTimer: NodeJS.Timeout | null = null;
  private runningTick = false;

  constructor(
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig,
    private readonly prisma: SandboxPrismaService,
    private readonly execPodBridgeService: ExecPodBridgeService,
    private readonly sandboxObjectStorageService: SandboxObjectStorageService,
    private readonly workspaceAuditService: WorkspaceAuditService
  ) {}

  onModuleInit(): void {
    this.cronTimer = setInterval(() => {
      void this.runTickInternal({ source: "cron" }).catch((error: unknown) => {
        this.logger.warn(
          `workspace_gc_tick_error reason=${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, this.config.SANDBOX_GC_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.cronTimer !== null) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }
  }

  /**
   * Eager call from the in-process producer of a lease (e.g.
   * `ManageWebChatListService.hardDeleteChat`) to bypass the cron interval.
   * Returns when the matching lease has been purged (or definitively failed).
   * Safe to invoke fire-and-forget.
   */
  async runDuePurgesNow(filter?: RunDuePurgesNowFilter): Promise<void> {
    await this.runTickInternal(
      filter === undefined ? { source: "eager" } : { source: "eager", filter }
    );
  }

  private async runTickInternal(input: {
    source: "cron" | "eager";
    filter?: RunDuePurgesNowFilter;
  }): Promise<void> {
    if (this.runningTick) {
      return;
    }
    this.runningTick = true;
    try {
      const due = await this.prisma.sandboxWorkspaceGcLease.findMany({
        where: {
          purgedAt: null,
          scheduledAt: { lte: new Date() },
          ...(input.filter === undefined
            ? {}
            : {
                kind: input.filter.kind,
                targetId: input.filter.targetId
              })
        },
        orderBy: { scheduledAt: "asc" },
        take: 50
      });
      for (const lease of due) {
        await this.purgeLease(lease);
      }
    } finally {
      this.runningTick = false;
    }
  }

  private async purgeLease(lease: {
    id: string;
    kind: DbWorkspaceGcKind;
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    const sandboxLease = this.fromDbLease(lease);
    try {
      switch (sandboxLease.kind) {
        case "session_subtree":
          await this.purgeSessionSubtree(sandboxLease);
          break;
        case "assistant_subtree":
          await this.purgeAssistantSubtree(sandboxLease);
          break;
        case "workspace_subtree":
          await this.purgeWorkspaceSubtree(sandboxLease);
          break;
      }
      // purgeXyz handles its own audit emit because it owns the counters.
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.workspaceAuditService.recordGcPurgeFailed({
        leaseId: sandboxLease.id,
        kind: sandboxLease.kind,
        targetId: sandboxLease.targetId,
        reason
      });
      this.logger.warn(
        `workspace_gc_purge_failed lease_id=${sandboxLease.id} kind=${sandboxLease.kind} target=${sandboxLease.targetId} reason=${reason} duration_ms=${(Date.now() - startedAt).toFixed(1)}`
      );
    }
  }

  private async purgeSessionSubtree(lease: {
    id: string;
    kind: "session_subtree";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    const meta = SESSION_SUBTREE_METADATA.parse(lease.metadata);
    let metadataRowsRemoved = 0;
    let podsTouched = 0;

    if (meta.sessionId !== undefined) {
      const sessionRoot = buildAssistantSessionRoot(meta.assistantId, meta.sessionId);
      const prefix = this.sandboxObjectStorageService.buildWorkspacePrefix({
        workspaceId: meta.workspaceId,
        subPath: sessionRoot.replace(/^\/workspace\/?/, "")
      });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
      try {
        const snapshotPrefix = `${this.mediaPrefix()}/assistants/${meta.assistantId}/sandbox-sessions/${meta.sessionId}/`;
        await this.sandboxObjectStorageService.deletePrefix(snapshotPrefix);
      } catch (error) {
        this.logger.warn(
          `workspace_gc_session_subtree_snapshot_purge_failed target=${lease.targetId} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
      const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(
        meta.workspaceId
      );
      for (const pod of pods) {
        if (pod.assistantId !== meta.assistantId) {
          continue;
        }
        try {
          await this.execPodBridgeService.execShellInSessionPod({
            assistantId: pod.assistantId,
            assistantHandle: pod.handle,
            siblingHandles: pods.filter((p) => p.podName !== pod.podName).map((p) => p.handle),
            workspaceId: meta.workspaceId,
            policy: this.gcSandboxPolicy(),
            shellCommand: `rm -rf ${posixSingleQuote(sessionRoot)}`,
            stdin: null
          });
          podsTouched += 1;
        } catch (error) {
          this.logger.warn(
            `workspace_gc_session_subtree_pod_purge_failed pod=${pod.podName} workspace=${meta.workspaceId} sessionId=${meta.sessionId} reason=${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      metadataRowsRemoved = await this.deleteWorkspaceFileMetadataByPathPrefix({
        workspaceId: meta.workspaceId,
        relPathPrefix: `${sessionRoot}/`
      });
    } else {
      // Legacy leases without sessionId cannot target one session tree; snapshot-only
      // cleanup remains best-effort until the lease row ages out of the queue.
      const snapshotPrefix = `${this.mediaPrefix()}/assistants/${meta.assistantId}/sandbox-sessions/`;
      await this.sandboxObjectStorageService.deletePrefix(snapshotPrefix);
    }

    await this.markLeasePurged(lease.id);
    this.workspaceAuditService.recordGcPurged({
      leaseId: lease.id,
      kind: "session_subtree",
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved,
      podsTouched
    });
  }

  private async purgeAssistantSubtree(lease: {
    id: string;
    kind: "assistant_subtree";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    const meta = ASSISTANT_SUBTREE_METADATA.parse(lease.metadata);
    const assistantRoot = buildAssistantWorkspaceRoot(meta.assistantId);
    try {
      const prefix = this.sandboxObjectStorageService.buildWorkspacePrefix({
        workspaceId: meta.workspaceId,
        subPath: assistantRoot.replace(/^\/workspace\/?/, "")
      });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_assistant_subtree_gcs_purge_failed workspace=${meta.workspaceId} assistantId=${meta.assistantId} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(meta.workspaceId);
    let podsTouched = 0;
    for (const pod of pods) {
      try {
        await this.execPodBridgeService.execShellInSessionPod({
          assistantId: pod.assistantId,
          assistantHandle: pod.handle,
          siblingHandles: pods.filter((p) => p.podName !== pod.podName).map((p) => p.handle),
          workspaceId: meta.workspaceId,
          policy: this.gcSandboxPolicy(),
          shellCommand: `rm -rf ${posixSingleQuote(assistantRoot)}`,
          stdin: null
        });
        podsTouched += 1;
      } catch (error) {
        this.logger.warn(
          `workspace_gc_assistant_subtree_pod_purge_failed pod=${pod.podName} workspace=${meta.workspaceId} assistantId=${meta.assistantId} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const metadataRowsRemoved = await this.deleteWorkspaceFileMetadataByPathPrefix({
      workspaceId: meta.workspaceId,
      relPathPrefix: `${assistantRoot}/`
    });
    await this.markLeasePurged(lease.id);
    this.workspaceAuditService.recordGcPurged({
      leaseId: lease.id,
      kind: "assistant_subtree",
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved,
      podsTouched
    });
  }

  private async purgeWorkspaceSubtree(lease: {
    id: string;
    kind: "workspace_subtree";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    WORKSPACE_SUBTREE_METADATA.parse(lease.metadata);
    const workspaceId = lease.targetId;
    try {
      const prefix = this.sandboxObjectStorageService.buildWorkspacePrefix({ workspaceId });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_workspace_subtree_gcs_purge_failed workspace=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(workspaceId);
    let podsTouched = 0;
    for (const pod of pods) {
      try {
        await this.execPodBridgeService.execShellInSessionPod({
          assistantId: pod.assistantId,
          assistantHandle: pod.handle,
          siblingHandles: pods.filter((p) => p.podName !== pod.podName).map((p) => p.handle),
          workspaceId,
          policy: this.gcSandboxPolicy(),
          shellCommand: `rm -rf ${posixSingleQuote("/workspace")}/* ${posixSingleQuote("/workspace")}/.[!.]*`,
          stdin: null
        });
        podsTouched += 1;
      } catch (error) {
        this.logger.warn(
          `workspace_gc_workspace_subtree_pod_purge_failed pod=${pod.podName} workspace=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const metadataRowsRemoved = await this.deleteWorkspaceFileMetadataByPathPrefix({
      workspaceId,
      relPathPrefix: `/workspace/`
    });
    await this.markLeasePurged(lease.id);
    this.workspaceAuditService.recordGcPurged({
      leaseId: lease.id,
      kind: "workspace_subtree",
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved,
      podsTouched
    });
  }

  private fromDbLease(lease: {
    id: string;
    kind: DbWorkspaceGcKind;
    targetId: string;
    metadata: Prisma.JsonValue;
  }): SandboxGcLease {
    switch (lease.kind) {
      case "session_subtree":
      case "assistant_subtree":
      case "workspace_subtree":
        return lease;
    }
  }

  private async markLeasePurged(leaseId: string): Promise<void> {
    await this.prisma.sandboxWorkspaceGcLease.update({
      where: { id: leaseId },
      data: { purgedAt: new Date() }
    });
  }

  /**
   * Bulk-delete `workspace_file_metadata` rows in `workspaceId` whose canonical
   * `path` starts with the given prefix. The count is returned for the audit event.
   */
  private async deleteWorkspaceFileMetadataByPathPrefix(input: {
    workspaceId: string;
    relPathPrefix: string;
  }): Promise<number> {
    const result = await this.prisma.$executeRaw<number>(Prisma.sql`
      DELETE FROM "workspace_file_metadata"
      WHERE "workspace_id" = ${input.workspaceId}::uuid
        AND "path" LIKE ${input.relPathPrefix + "%"}
    `);
    return typeof result === "number" ? result : 0;
  }

  private mediaPrefix(): string {
    return this.config.PERSAI_MEDIA_OBJECT_PREFIX.trim().replace(/\/+$/g, "");
  }

  private gcSandboxPolicy(): RuntimeSandboxPolicyShape {
    return {
      enabled: true,
      maxSingleFileWriteBytes: 1 * 1024 * 1024,
      maxWorkspaceBytesPerJob: 1 * 1024 * 1024,
      maxPersistedArtifactsPerJob: 0,
      maxFileCountPerJob: 0,
      maxDirectoryCountPerJob: 0,
      maxProcessRuntimeMs: 30_000,
      maxCpuMsPerJob: 30_000,
      maxMemoryBytesPerJob: 64 * 1024 * 1024,
      maxConcurrentProcesses: 1,
      maxStdoutBytes: 8 * 1024,
      maxStderrBytes: 8 * 1024,
      artifactMimeAllowlist: ["*/*"],
      webMaxOutboundBytes: 0,
      telegramMaxOutboundBytes: 0,
      sandboxJobsPerDay: null,
      maxArtifactSendCountPerTurn: 0
    };
  }
}

type RuntimeSandboxPolicyShape = import("@persai/runtime-contract").RuntimeSandboxPolicy;

function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
