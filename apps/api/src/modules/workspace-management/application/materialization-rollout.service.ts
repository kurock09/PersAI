import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  type MaterializationRolloutCriticality,
  type MaterializationRolloutItemStatus,
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
}
