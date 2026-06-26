import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
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
 * After ADR-128 Slice 4 the workspace is flat (no input/outbound/handle
 * subdirectories), so the per-chat and per-assistant subtree purges become
 * cleanup of their respective auxiliary state only — session snapshot GCS
 * for `chat_scratch`, lease bookkeeping for `assistant_outbound`. The
 * `workspace_shared` purge still wipes the entire `/workspace/` subtree for
 * the workspace.
 *
 * On any failure the lease stays open; the next tick retries. Successful
 * purges set `purged_at = now()` so the row is no longer returned by the due
 * scan.
 */

const CHAT_SCRATCH_METADATA = z.object({
  workspaceId: z.string().uuid(),
  assistantId: z.string().uuid()
});

const ASSISTANT_OUTBOUND_METADATA = z.object({
  workspaceId: z.string().uuid(),
  handle: z.string().min(1).max(64)
});

const WORKSPACE_SHARED_METADATA = z.object({}).passthrough();

type RunDuePurgesNowFilter =
  | { kind: "chat_scratch"; targetId: string }
  | { kind: "assistant_outbound"; targetId: string }
  | { kind: "workspace_shared"; targetId: string };

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
            : { kind: input.filter.kind, targetId: input.filter.targetId })
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
    kind: "chat_scratch" | "assistant_outbound" | "workspace_shared";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    try {
      switch (lease.kind) {
        case "chat_scratch":
          await this.purgeChatScratch({ ...lease, kind: "chat_scratch" });
          break;
        case "assistant_outbound":
          await this.purgeAssistantOutbound({ ...lease, kind: "assistant_outbound" });
          break;
        case "workspace_shared":
          await this.purgeWorkspaceShared({ ...lease, kind: "workspace_shared" });
          break;
      }
      // purgeXyz handles its own audit emit because it owns the counters.
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.workspaceAuditService.recordGcPurgeFailed({
        leaseId: lease.id,
        kind: lease.kind,
        targetId: lease.targetId,
        reason
      });
      this.logger.warn(
        `workspace_gc_purge_failed lease_id=${lease.id} kind=${lease.kind} target=${lease.targetId} reason=${reason} duration_ms=${(Date.now() - startedAt).toFixed(1)}`
      );
    }
  }

  private async purgeChatScratch(lease: {
    id: string;
    kind: "chat_scratch";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    const meta = CHAT_SCRATCH_METADATA.parse(lease.metadata);
    // ADR-128 Slice 4 — the flat workspace has no chat-scoped subtree, so the
    // only remaining work is to drop the assistant's session-snapshot GCS
    // subtree (per-session tarballs that are no longer addressable once the
    // chat is gone).
    try {
      const snapshotPrefix = `${this.mediaPrefix()}/assistants/${meta.assistantId}/sandbox-sessions/`;
      await this.sandboxObjectStorageService.deletePrefix(snapshotPrefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_chat_scratch_gcs_purge_failed chat=${lease.targetId} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    await this.markLeasePurged(lease.id);
    this.workspaceAuditService.recordGcPurged({
      leaseId: lease.id,
      kind: lease.kind,
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved: 0,
      podsTouched: 0
    });
  }

  private async purgeAssistantOutbound(lease: {
    id: string;
    kind: "assistant_outbound";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    // ADR-128 Slice 4 — the flat workspace has no per-assistant subtree, so
    // this lease has nothing path-shaped to purge anymore. We still validate
    // the metadata blob and mark the lease purged so producers do not stall.
    const startedAt = Date.now();
    ASSISTANT_OUTBOUND_METADATA.parse(lease.metadata);
    await this.markLeasePurged(lease.id);
    this.workspaceAuditService.recordGcPurged({
      leaseId: lease.id,
      kind: lease.kind,
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved: 0,
      podsTouched: 0
    });
  }

  private async purgeWorkspaceShared(lease: {
    id: string;
    kind: "workspace_shared";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    WORKSPACE_SHARED_METADATA.parse(lease.metadata);
    const workspaceId = lease.targetId;
    try {
      const prefix = this.sandboxObjectStorageService.buildWorkspacePrefix({ workspaceId });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_workspace_shared_gcs_purge_failed workspace=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
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
          `workspace_gc_workspace_shared_pod_purge_failed pod=${pod.podName} workspace=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
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
      kind: lease.kind,
      targetId: lease.targetId,
      durationMs: Date.now() - startedAt,
      metadataRowsRemoved,
      podsTouched
    });
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
      networkAccessEnabled: false,
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
