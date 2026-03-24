import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PlatformRolloutItemOutcome, Prisma } from "@prisma/client";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import type { PlatformRolloutPatch, PlatformRolloutState } from "./platform-rollout.types";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { Inject } from "@nestjs/common";

export type CreatePlatformRolloutInput = {
  rolloutPercent: number;
  targetPatch: PlatformRolloutPatch;
};

const PATCH_KEYS: Array<keyof PlatformRolloutPatch> = [
  "capabilityEnvelope",
  "secretRefs",
  "policyEnvelope",
  "memoryControl",
  "tasksControl",
  "quotaHook",
  "auditHook"
];

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapOutcomeFromApplyStatus(status: string | null): PlatformRolloutItemOutcome {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "degraded") {
    return "degraded";
  }
  if (status === null) {
    return "skipped";
  }
  return "failed";
}

@Injectable()
export class ManagePlatformRolloutsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository
  ) {}

  parseCreateInput(body: unknown): CreatePlatformRolloutInput {
    const row = asObject(body);
    if (row === null) {
      throw new BadRequestException("Request body must be an object.");
    }
    const rolloutPercent = row.rolloutPercent;
    if (
      typeof rolloutPercent !== "number" ||
      !Number.isInteger(rolloutPercent) ||
      rolloutPercent < 1 ||
      rolloutPercent > 100
    ) {
      throw new BadRequestException("rolloutPercent must be an integer between 1 and 100.");
    }
    const patch = asObject(row.targetPatch);
    if (patch === null) {
      throw new BadRequestException("targetPatch must be an object.");
    }
    const targetPatch: PlatformRolloutPatch = {};
    for (const key of PATCH_KEYS) {
      if (key in patch) {
        targetPatch[key] = patch[key];
      }
    }
    if (Object.keys(targetPatch).length === 0) {
      throw new BadRequestException(
        `targetPatch must include at least one of: ${PATCH_KEYS.join(", ")}.`
      );
    }
    return {
      rolloutPercent,
      targetPatch
    };
  }

  async listRollouts(userId: string): Promise<PlatformRolloutState[]> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.assistantPlatformRollout.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    return rows.map((row) => this.mapRollout(row));
  }

  async createRollout(
    userId: string,
    input: CreatePlatformRolloutInput,
    stepUpToken: string | null
  ): Promise<PlatformRolloutState> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.rollout.apply",
      stepUpToken
    );

    const assistants = await this.prisma.assistant.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true }
    });
    const totalAssistants = assistants.length;
    const targetCount =
      totalAssistants === 0
        ? 0
        : Math.max(1, Math.ceil((totalAssistants * input.rolloutPercent) / 100));
    const targetedAssistants = assistants.slice(0, targetCount);

    const rollout = await this.prisma.assistantPlatformRollout.create({
      data: {
        workspaceId: context.workspaceId,
        createdByUserId: userId,
        status: "in_progress",
        rolloutPercent: input.rolloutPercent,
        targetPatch: input.targetPatch as Prisma.InputJsonValue,
        totalAssistants,
        targetedAssistants: targetCount
      }
    });

    let applySucceededCount = 0;
    let applyDegradedCount = 0;
    let applyFailedCount = 0;

    for (const target of targetedAssistants) {
      let governance = await this.prisma.assistantGovernance.findUnique({
        where: { assistantId: target.id }
      });
      if (governance === null) {
        await this.assistantGovernanceRepository.createBaseline(target.id);
        governance = await this.prisma.assistantGovernance.findUnique({
          where: { assistantId: target.id }
        });
      }
      if (governance === null) {
        continue;
      }

      const previousGovernance = {
        capabilityEnvelope: governance.capabilityEnvelope,
        secretRefs: governance.secretRefs,
        policyEnvelope: governance.policyEnvelope,
        memoryControl: governance.memoryControl,
        tasksControl: governance.tasksControl,
        quotaHook: governance.quotaHook,
        auditHook: governance.auditHook
      };
      const updatedGovernance = {
        ...previousGovernance,
        ...input.targetPatch
      };

      await this.prisma.assistantGovernance.update({
        where: { assistantId: target.id },
        data: {
          capabilityEnvelope: updatedGovernance.capabilityEnvelope as never,
          secretRefs: updatedGovernance.secretRefs as never,
          policyEnvelope: updatedGovernance.policyEnvelope as never,
          memoryControl: updatedGovernance.memoryControl as never,
          tasksControl: updatedGovernance.tasksControl as never,
          quotaHook: updatedGovernance.quotaHook as never,
          auditHook: updatedGovernance.auditHook as never
        }
      });

      const latestPublished =
        await this.assistantPublishedVersionRepository.findLatestByAssistantId(target.id);

      let applyOutcome: PlatformRolloutItemOutcome = "skipped";
      let applyStatus: string | null = null;
      let applyErrorCode: string | null = null;
      let applyErrorMessage: string | null = null;

      if (latestPublished !== null) {
        await this.applyAssistantPublishedVersionService.execute(
          target.userId,
          latestPublished,
          true
        );
        const afterApply = await this.prisma.assistant.findUnique({
          where: { id: target.id },
          select: {
            applyStatus: true,
            applyErrorCode: true,
            applyErrorMessage: true
          }
        });
        applyStatus = afterApply?.applyStatus ?? null;
        applyErrorCode = afterApply?.applyErrorCode ?? null;
        applyErrorMessage = afterApply?.applyErrorMessage ?? null;
        applyOutcome = mapOutcomeFromApplyStatus(applyStatus);
      }

      if (applyOutcome === "succeeded") {
        applySucceededCount += 1;
      } else if (applyOutcome === "degraded") {
        applyDegradedCount += 1;
      } else if (applyOutcome === "failed") {
        applyFailedCount += 1;
      }

      await this.prisma.assistantPlatformRolloutItem.create({
        data: {
          rolloutId: rollout.id,
          assistantId: target.id,
          userId: target.userId,
          previousGovernance: previousGovernance as never,
          updatedGovernance: updatedGovernance as never,
          applyOutcome,
          applyStatus: applyStatus as never,
          applyErrorCode,
          applyErrorMessage,
          appliedAt: new Date()
        }
      });
    }

    const updatedRollout = await this.prisma.assistantPlatformRollout.update({
      where: { id: rollout.id },
      data: {
        status: "applied",
        applySucceededCount,
        applyDegradedCount,
        applyFailedCount
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.platform_rollout_applied",
      summary: "Platform-managed rollout applied.",
      details: {
        rolloutId: updatedRollout.id,
        rolloutPercent: updatedRollout.rolloutPercent,
        totalAssistants: updatedRollout.totalAssistants,
        targetedAssistants: updatedRollout.targetedAssistants,
        applySucceededCount: updatedRollout.applySucceededCount,
        applyDegradedCount: updatedRollout.applyDegradedCount,
        applyFailedCount: updatedRollout.applyFailedCount,
        targetPatchKeys: Object.keys(input.targetPatch)
      }
    });

    return this.mapRollout(updatedRollout);
  }

  async rollbackRollout(
    userId: string,
    rolloutId: string,
    stepUpToken: string | null
  ): Promise<PlatformRolloutState> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.rollout.rollback",
      stepUpToken
    );
    const rollout = await this.prisma.assistantPlatformRollout.findFirst({
      where: {
        id: rolloutId,
        workspaceId: context.workspaceId
      }
    });
    if (rollout === null) {
      throw new NotFoundException("Platform rollout not found.");
    }
    if (rollout.status === "rolled_back") {
      throw new BadRequestException("Platform rollout has already been rolled back.");
    }

    const items = await this.prisma.assistantPlatformRolloutItem.findMany({
      where: { rolloutId: rollout.id },
      orderBy: { createdAt: "asc" }
    });

    for (const item of items) {
      const previous = asObject(item.previousGovernance);
      if (previous !== null) {
        await this.prisma.assistantGovernance.update({
          where: { assistantId: item.assistantId },
          data: {
            capabilityEnvelope: previous.capabilityEnvelope as never,
            secretRefs: previous.secretRefs as never,
            policyEnvelope: previous.policyEnvelope as never,
            memoryControl: previous.memoryControl as never,
            tasksControl: previous.tasksControl as never,
            quotaHook: previous.quotaHook as never,
            auditHook: previous.auditHook as never
          }
        });
      }

      const latestPublished =
        await this.assistantPublishedVersionRepository.findLatestByAssistantId(item.assistantId);
      let rollbackOutcome: PlatformRolloutItemOutcome = "skipped";
      let rollbackStatus: string | null = null;
      let rollbackErrorCode: string | null = null;
      let rollbackErrorMessage: string | null = null;
      if (latestPublished !== null) {
        await this.applyAssistantPublishedVersionService.execute(
          item.userId,
          latestPublished,
          true
        );
        const afterApply = await this.prisma.assistant.findUnique({
          where: { id: item.assistantId },
          select: {
            applyStatus: true,
            applyErrorCode: true,
            applyErrorMessage: true
          }
        });
        rollbackStatus = afterApply?.applyStatus ?? null;
        rollbackErrorCode = afterApply?.applyErrorCode ?? null;
        rollbackErrorMessage = afterApply?.applyErrorMessage ?? null;
        rollbackOutcome = mapOutcomeFromApplyStatus(rollbackStatus);
      }

      await this.prisma.assistantPlatformRolloutItem.update({
        where: { id: item.id },
        data: {
          rollbackOutcome,
          rollbackStatus: rollbackStatus as never,
          rollbackErrorCode,
          rollbackErrorMessage,
          rolledBackAt: new Date()
        }
      });
    }

    const rolledBack = await this.prisma.assistantPlatformRollout.update({
      where: { id: rollout.id },
      data: {
        status: "rolled_back",
        rolledBackAt: new Date()
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.platform_rollout_rolled_back",
      summary: "Platform-managed rollout rolled back.",
      details: {
        rolloutId: rolledBack.id
      }
    });

    return this.mapRollout(rolledBack);
  }

  private mapRollout(row: {
    id: string;
    status: "in_progress" | "applied" | "rolled_back" | "failed";
    rolloutPercent: number;
    targetPatch: unknown;
    totalAssistants: number;
    targetedAssistants: number;
    applySucceededCount: number;
    applyDegradedCount: number;
    applyFailedCount: number;
    rolledBackAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): PlatformRolloutState {
    return {
      id: row.id,
      status: row.status,
      rolloutPercent: row.rolloutPercent,
      targetPatch: (asObject(row.targetPatch) ?? {}) as PlatformRolloutPatch,
      totalAssistants: row.totalAssistants,
      targetedAssistants: row.targetedAssistants,
      applySucceededCount: row.applySucceededCount,
      applyDegradedCount: row.applyDegradedCount,
      applyFailedCount: row.applyFailedCount,
      rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
