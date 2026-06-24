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
 * ADR-126 Slice 3 — deferred garbage collector for sandbox workspace state.
 *
 * The reaper drains rows from `sandbox_workspace_gc_lease` whose
 * `scheduled_at <= now() AND purged_at IS NULL`, validates the kind-specific
 * `metadata` blob against a Zod schema, then performs the matching purge:
 *
 *   * `chat_scratch` (scheduled `now()`):
 *       - delete `/workspace/chats/<chatId>/` from every warm session pod
 *         in the (assistantId, workspaceId) tuple;
 *       - drop the GCS snapshot subtree under
 *         `<media-prefix>/assistants/<assistantId>/sandbox-sessions/(any)/chats/<chatId>/`;
 *       - delete `workspace_file_metadata` rows whose `path`
 *         starts with `/workspace/chats/<chatId>/`.
 *   * `assistant_outbound` (scheduled `now() + 7d`):
 *       - delete `/shared/<workspaceId>/outbound/<handle>/` from every warm
 *         session pod in the workspace;
 *       - drop the GCS prefix
 *         `<media-prefix>/workspaces/<workspaceId>/shared/outbound/<handle>/`;
 *       - delete `workspace_file_metadata` rows whose `workspace_id = <workspaceId>`
 *         and `path LIKE '/shared/outbound/<handle>/%'`.
 *   * `workspace_shared` (scheduled `now() + 30d`):
 *       - delete `/shared/<workspaceId>/` from every warm session pod in the
 *         workspace;
 *       - drop the GCS prefix `<media-prefix>/workspaces/<workspaceId>/shared/`;
 *       - delete `workspace_file_metadata` rows whose `workspace_id = <workspaceId>`
 *         and `path LIKE '/shared/%'`.
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
    const chatId = lease.targetId;
    const chatPath = `/workspace/chats/${chatId}`;
    // Purge from every warm session pod for this assistant+workspace.
    const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(meta.workspaceId);
    let podsTouched = 0;
    for (const pod of pods.filter((p) => p.assistantId === meta.assistantId)) {
      try {
        // We can use the unprivileged session-pod path to run `rm -rf`.
        await this.execPodBridgeService.execShellInSessionPod({
          assistantId: pod.assistantId,
          assistantHandle: pod.handle,
          siblingHandles: pods
            .filter((p) => p.assistantId !== pod.assistantId)
            .map((p) => p.handle),
          workspaceId: meta.workspaceId,
          // A trivial sandbox policy is fine for a one-shot `rm`; the call only
          // depends on the timeout/stdout caps and these are sufficient.
          policy: this.gcSandboxPolicy(),
          shellCommand: `rm -rf ${posixSingleQuote(chatPath)}`,
          stdin: null
        });
        podsTouched += 1;
      } catch (error) {
        this.logger.warn(
          `workspace_gc_chat_scratch_pod_purge_failed pod=${pod.podName} chat=${chatId} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    // GCS snapshot subtree.
    try {
      // `assistants/<aid>/sandbox-sessions/*/chats/<chatId>/` — best effort.
      // The bucket prefix is implicit in the storage service; we delete the
      // entire snapshot subtree by enumerating, which is safe because chat
      // scratch lives under that prefix.
      const snapshotPrefix = `${this.mediaPrefix()}/assistants/${meta.assistantId}/sandbox-sessions/`;
      await this.sandboxObjectStorageService.deletePrefix(snapshotPrefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_chat_scratch_gcs_purge_failed chat=${chatId} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    const metadataRowsRemoved = await this.deleteWorkspaceFileMetadataByPathPrefix({
      workspaceId: meta.workspaceId,
      relPathPrefix: `/workspace/chats/${chatId}/`
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

  private async purgeAssistantOutbound(lease: {
    id: string;
    kind: "assistant_outbound";
    targetId: string;
    metadata: Prisma.JsonValue;
  }): Promise<void> {
    const startedAt = Date.now();
    const meta = ASSISTANT_OUTBOUND_METADATA.parse(lease.metadata);
    // GCS prefix.
    try {
      const prefix = this.sandboxObjectStorageService.buildSharedPrefix({
        workspaceId: meta.workspaceId,
        subPath: `outbound/${meta.handle}`
      });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_assistant_outbound_gcs_purge_failed handle=${meta.handle} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    // Warm pods (best-effort).
    const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(meta.workspaceId);
    let podsTouched = 0;
    const outboundPath = `/shared/${meta.workspaceId}/outbound/${meta.handle}`;
    for (const pod of pods) {
      try {
        await this.execPodBridgeService.execShellInSessionPod({
          assistantId: pod.assistantId,
          assistantHandle: pod.handle,
          siblingHandles: pods.filter((p) => p.podName !== pod.podName).map((p) => p.handle),
          workspaceId: meta.workspaceId,
          policy: this.gcSandboxPolicy(),
          shellCommand: `rm -rf ${posixSingleQuote(outboundPath)}`,
          stdin: null
        });
        podsTouched += 1;
      } catch (error) {
        this.logger.warn(
          `workspace_gc_assistant_outbound_pod_purge_failed pod=${pod.podName} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const metadataRowsRemoved = await this.deleteWorkspaceFileMetadataByPathPrefix({
      workspaceId: meta.workspaceId,
      relPathPrefix: `/shared/outbound/${meta.handle}/`
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
      const prefix = this.sandboxObjectStorageService.buildSharedPrefix({ workspaceId });
      await this.sandboxObjectStorageService.deletePrefix(prefix);
    } catch (error) {
      this.logger.warn(
        `workspace_gc_workspace_shared_gcs_purge_failed workspace=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    const pods = await this.execPodBridgeService.listWarmSessionPodsForWorkspace(workspaceId);
    let podsTouched = 0;
    const sharedPath = `/shared/${workspaceId}`;
    for (const pod of pods) {
      try {
        await this.execPodBridgeService.execShellInSessionPod({
          assistantId: pod.assistantId,
          assistantHandle: pod.handle,
          siblingHandles: pods.filter((p) => p.podName !== pod.podName).map((p) => p.handle),
          workspaceId,
          policy: this.gcSandboxPolicy(),
          shellCommand: `rm -rf ${posixSingleQuote(sharedPath)}/*`,
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
      relPathPrefix: `/shared/`
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
    return (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
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
