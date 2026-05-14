import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  type MaterializationRolloutCriticality,
  type MaterializationRolloutItem,
  type MaterializationRolloutItemStatus,
  type MaterializationRolloutStatus,
  type MaterializationRolloutScopeType,
  type MaterializationRolloutTriggerSource,
  type MaterializationRolloutType
} from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type MaterializationRolloutQueueSummary = {
  id: string;
  rolloutType: string;
  targetGeneration: number;
  totalItems: number;
  pendingCount: number;
  runningCount: number;
  succeededCount: number;
  degradedCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterializationRolloutItemView = {
  id: string;
  rolloutId: string;
  assistantId: string;
  workspaceId: string;
  userId: string;
  targetGeneration: number;
  priority: number;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  claimedAt: string | null;
  materializedSpecId: string | null;
  materializedContentHash: string | null;
  runtimeBundleHash: string | null;
  createdAt: string;
  updatedAt: string;
};

type ManualReapplyTarget = {
  assistantId: string;
  userId: string;
  workspaceId: string;
};

type AutomaticRolloutInput = {
  actorUserId: string | null;
  workspaceId: string;
  rolloutType: MaterializationRolloutType;
  triggerSource: MaterializationRolloutTriggerSource;
  scopeType: MaterializationRolloutScopeType;
  criticality: MaterializationRolloutCriticality;
  targetGeneration: number;
  scopeMetadata: Record<string, unknown>;
  auditEventCode: string;
  auditSummary: string;
  concurrencyLimit?: number;
  priority?: number;
};

@Injectable()
export class MaterializationRolloutService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository
  ) {}

  async createManualReapplyRollout(
    userId: string,
    stepUpToken: string | null
  ): Promise<MaterializationRolloutQueueSummary> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.force_reapply_all",
      stepUpToken
    );
    const targetGeneration = await this.bumpConfigGenerationService.execute();
    return this.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "manual_reapply",
      triggerSource: "admin",
      scopeType: "all_published_assistants",
      criticality: "maintenance",
      targetGeneration,
      scopeMetadata: {
        requestedByAction: "admin.force_reapply_all"
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a manual materialization rollout.",
      concurrencyLimit: 2,
      priority: 100
    });
  }

  async createAutomaticGlobalRollout(
    input: AutomaticRolloutInput
  ): Promise<MaterializationRolloutQueueSummary> {
    const eligibleTargets = await this.listPublishedAssistantTargets(input.workspaceId);
    const created = await this.queueRollout({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      rolloutType: input.rolloutType,
      triggerSource: input.triggerSource,
      scopeType: input.scopeType,
      criticality: input.criticality,
      targetGeneration: input.targetGeneration,
      scopeMetadata: input.scopeMetadata,
      eligibleTargets,
      concurrencyLimit: input.concurrencyLimit ?? 2,
      priority: input.priority ?? 100
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: input.workspaceId,
      assistantId: null,
      actorUserId: input.actorUserId,
      eventCategory: "admin_action",
      eventCode: input.auditEventCode,
      summary: input.auditSummary,
      details: {
        rolloutId: created.id,
        rolloutType: input.rolloutType,
        triggerSource: input.triggerSource,
        targetGeneration: input.targetGeneration,
        totalItems: eligibleTargets.length,
        scopeType: input.scopeType,
        criticality: input.criticality,
        scopeMetadata: input.scopeMetadata
      }
    });

    return this.mapSummary(
      await this.prisma.materializationRollout.findUniqueOrThrow({
        where: { id: created.id }
      })
    );
  }

  async listRollouts(userId: string): Promise<MaterializationRolloutQueueSummary[]> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.materializationRollout.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    return rows.map((row) => this.mapSummary(row));
  }

  async getRolloutOrThrow(rolloutId: string): Promise<MaterializationRolloutQueueSummary> {
    const rollout = await this.prisma.materializationRollout.findUnique({
      where: { id: rolloutId }
    });
    if (rollout === null) {
      throw new NotFoundException("Materialization rollout not found.");
    }
    return this.mapSummary(rollout);
  }

  async listFailedItems(
    userId: string,
    rolloutId: string
  ): Promise<{
    rollout: MaterializationRolloutQueueSummary;
    items: MaterializationRolloutItemView[];
  }> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rollout = await this.prisma.materializationRollout.findFirst({
      where: { id: rolloutId, workspaceId: context.workspaceId }
    });
    if (rollout === null) {
      throw new NotFoundException("Materialization rollout not found.");
    }
    const items = await this.prisma.materializationRolloutItem.findMany({
      where: {
        rolloutId,
        workspaceId: context.workspaceId,
        status: "failed"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return {
      rollout: this.mapSummary(rollout),
      items: items.map((item) => this.mapItem(item))
    };
  }

  async retryFailedItems(
    userId: string,
    rolloutId: string,
    stepUpToken: string | null
  ): Promise<{
    rollout: MaterializationRolloutQueueSummary;
    retriedCount: number;
  }> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.force_reapply_all",
      stepUpToken
    );
    const retriedCount = await this.prisma.$transaction(async (tx) => {
      const rollout = await tx.materializationRollout.findFirst({
        where: { id: rolloutId, workspaceId: context.workspaceId }
      });
      if (rollout === null) {
        throw new NotFoundException("Materialization rollout not found.");
      }
      const result = await tx.materializationRolloutItem.updateMany({
        where: {
          rolloutId,
          workspaceId: context.workspaceId,
          status: "failed"
        },
        data: {
          status: "pending",
          nextRetryAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          startedAt: null,
          finishedAt: null,
          claimedAt: null
        }
      });
      if (result.count > 0) {
        await tx.materializationRollout.update({
          where: { id: rolloutId },
          data: {
            status: "pending",
            finishedAt: null
          }
        });
      }
      return result.count;
    });
    await this.refreshRolloutSummary(rolloutId);
    if (retriedCount > 0) {
      await this.appendAssistantAuditEventService.execute({
        workspaceId: context.workspaceId,
        assistantId: null,
        actorUserId: userId,
        eventCategory: "admin_action",
        eventCode: "admin.materialization_rollout_retry_failed",
        summary: "Admin retried failed materialization rollout items.",
        details: {
          rolloutId,
          retriedCount
        }
      });
    }
    return {
      rollout: await this.getRolloutOrThrow(rolloutId),
      retriedCount
    };
  }

  async cancelPendingItems(
    userId: string,
    rolloutId: string,
    stepUpToken: string | null
  ): Promise<{
    rollout: MaterializationRolloutQueueSummary;
    cancelledCount: number;
  }> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.force_reapply_all",
      stepUpToken
    );
    const cancelledCount = await this.prisma.$transaction(async (tx) => {
      const rollout = await tx.materializationRollout.findFirst({
        where: { id: rolloutId, workspaceId: context.workspaceId }
      });
      if (rollout === null) {
        throw new NotFoundException("Materialization rollout not found.");
      }
      const result = await tx.materializationRolloutItem.updateMany({
        where: {
          rolloutId,
          workspaceId: context.workspaceId,
          status: "pending"
        },
        data: {
          status: "cancelled",
          finishedAt: new Date()
        }
      });
      return result.count;
    });
    await this.refreshRolloutSummary(rolloutId);
    if (cancelledCount > 0) {
      await this.appendAssistantAuditEventService.execute({
        workspaceId: context.workspaceId,
        assistantId: null,
        actorUserId: userId,
        eventCategory: "admin_action",
        eventCode: "admin.materialization_rollout_cancel_pending",
        summary: "Admin cancelled pending materialization rollout items.",
        details: {
          rolloutId,
          cancelledCount
        }
      });
    }
    return {
      rollout: await this.getRolloutOrThrow(rolloutId),
      cancelledCount
    };
  }

  private async listPublishedAssistantTargets(workspaceId: string): Promise<ManualReapplyTarget[]> {
    const assistants = await this.prisma.assistant.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        workspaceId: true
      }
    });

    const eligibleTargets: ManualReapplyTarget[] = [];
    for (const assistant of assistants) {
      const latest = await this.publishedVersionRepository.findLatestByAssistantId(assistant.id);
      if (latest === null) {
        continue;
      }
      eligibleTargets.push({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId
      });
    }
    return eligibleTargets;
  }

  private async queueRollout(input: {
    actorUserId: string | null;
    workspaceId: string;
    rolloutType: MaterializationRolloutType;
    triggerSource: MaterializationRolloutTriggerSource;
    scopeType: MaterializationRolloutScopeType;
    criticality: MaterializationRolloutCriticality;
    targetGeneration: number;
    scopeMetadata: Record<string, unknown>;
    eligibleTargets: ManualReapplyTarget[];
    concurrencyLimit: number;
    priority: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const rollout = await tx.materializationRollout.create({
        data: {
          workspaceId: input.workspaceId,
          createdByUserId: input.actorUserId,
          rolloutType: input.rolloutType,
          triggerSource: input.triggerSource,
          scopeType: input.scopeType,
          scopeMetadata: input.scopeMetadata as Prisma.InputJsonValue,
          criticality: input.criticality,
          targetGeneration: input.targetGeneration,
          status: input.eligibleTargets.length > 0 ? "pending" : "succeeded",
          totalItems: input.eligibleTargets.length,
          pendingCount: input.eligibleTargets.length,
          concurrencyLimit: input.concurrencyLimit
        }
      });

      if (input.eligibleTargets.length > 0) {
        await tx.materializationRolloutItem.createMany({
          data: input.eligibleTargets.map((assistant) => ({
            rolloutId: rollout.id,
            assistantId: assistant.assistantId,
            workspaceId: assistant.workspaceId,
            userId: assistant.userId,
            targetGeneration: input.targetGeneration,
            priority: input.priority,
            status: "pending" as MaterializationRolloutItemStatus
          }))
        });
      } else {
        await tx.materializationRollout.update({
          where: { id: rollout.id },
          data: {
            finishedAt: new Date()
          }
        });
      }

      return rollout;
    });
  }

  private mapSummary(
    rollout: Awaited<
      ReturnType<WorkspaceManagementPrismaService["materializationRollout"]["findUniqueOrThrow"]>
    >
  ): MaterializationRolloutQueueSummary {
    return {
      id: rollout.id,
      rolloutType: rollout.rolloutType,
      targetGeneration: rollout.targetGeneration,
      totalItems: rollout.totalItems,
      pendingCount: rollout.pendingCount,
      runningCount: rollout.runningCount,
      succeededCount: rollout.succeededCount,
      degradedCount: rollout.degradedCount,
      failedCount: rollout.failedCount,
      skippedCount: rollout.skippedCount,
      cancelledCount: rollout.cancelledCount,
      status: rollout.status,
      startedAt: rollout.startedAt?.toISOString() ?? null,
      finishedAt: rollout.finishedAt?.toISOString() ?? null,
      createdAt: rollout.createdAt.toISOString(),
      updatedAt: rollout.updatedAt.toISOString()
    };
  }

  private mapItem(item: MaterializationRolloutItem): MaterializationRolloutItemView {
    return {
      id: item.id,
      rolloutId: item.rolloutId,
      assistantId: item.assistantId,
      workspaceId: item.workspaceId,
      userId: item.userId,
      targetGeneration: item.targetGeneration,
      priority: item.priority,
      status: item.status,
      attempts: item.attempts,
      nextRetryAt: item.nextRetryAt?.toISOString() ?? null,
      lastErrorCode: item.lastErrorCode,
      lastErrorMessage: item.lastErrorMessage,
      startedAt: item.startedAt?.toISOString() ?? null,
      finishedAt: item.finishedAt?.toISOString() ?? null,
      claimedAt: item.claimedAt?.toISOString() ?? null,
      materializedSpecId: item.materializedSpecId,
      materializedContentHash: item.materializedContentHash,
      runtimeBundleHash: item.runtimeBundleHash,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private async refreshRolloutSummary(rolloutId: string): Promise<void> {
    const grouped = await this.prisma.materializationRolloutItem.groupBy({
      by: ["status"],
      where: { rolloutId },
      _count: { _all: true }
    });
    const counts: Record<MaterializationRolloutItemStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      degraded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    const hasActive = counts.pending > 0 || counts.running > 0;
    const nextStatus: MaterializationRolloutStatus = hasActive
      ? counts.running > 0
        ? "running"
        : "pending"
      : counts.failed > 0
        ? "failed"
        : counts.cancelled > 0 &&
            counts.succeeded === 0 &&
            counts.degraded === 0 &&
            counts.skipped === 0
          ? "cancelled"
          : "succeeded";
    await this.prisma.materializationRollout.update({
      where: { id: rolloutId },
      data: {
        status: nextStatus,
        pendingCount: counts.pending,
        runningCount: counts.running,
        succeededCount: counts.succeeded,
        degradedCount: counts.degraded,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
        cancelledCount: counts.cancelled,
        finishedAt: hasActive ? null : new Date()
      }
    });
  }
}
