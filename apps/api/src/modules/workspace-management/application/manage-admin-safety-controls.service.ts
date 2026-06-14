import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  USER_RESTRICTION_REPOSITORY,
  type UserRestrictionRepository
} from "../domain/user-restriction.repository";
import type { UserRestriction } from "../domain/user-restriction.entity";

export type AdminSafetyRestrictionSummary = {
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  reasonCode: string;
  source: "moderation_auto" | "admin";
  sourceAssistantId: string | null;
  sourceModerationCaseId: string | null;
  blockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSafetyModerationCaseSummary = {
  id: string;
  userId: string;
  assistantId: string | null;
  chatId: string | null;
  surface: string | null;
  decision: string;
  reasonCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSafetyUnblockInput = {
  userId: string;
};

export type AdminSafetyRestrictInput = {
  userId: string;
  reasonCode: string;
  sourceAssistantId: string | null;
  blockedUntil: Date | null;
};

const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

function mapRestrictionSummary(
  restriction: UserRestriction,
  user: { email: string; displayName: string | null }
): AdminSafetyRestrictionSummary {
  return {
    userId: restriction.userId,
    userEmail: user.email,
    userDisplayName: user.displayName,
    reasonCode: restriction.reasonCode,
    source: restriction.source,
    sourceAssistantId: restriction.sourceAssistantId,
    sourceModerationCaseId: restriction.sourceModerationCaseId,
    blockedUntil: restriction.blockedUntil?.toISOString() ?? null,
    createdAt: restriction.createdAt.toISOString(),
    updatedAt: restriction.updatedAt.toISOString()
  };
}

@Injectable()
export class ManageAdminSafetyControlsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(USER_RESTRICTION_REPOSITORY)
    private readonly userRestrictionRepository: UserRestrictionRepository
  ) {}

  parseUnblockInput(body: unknown): AdminSafetyUnblockInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.userId !== "string" || row.userId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    return { userId: row.userId.trim() };
  }

  parseRestrictInput(body: unknown): AdminSafetyRestrictInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.userId !== "string" || row.userId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const reasonCode = this.parseReasonCode(row.reasonCode);
    const sourceAssistantId =
      row.sourceAssistantId === undefined || row.sourceAssistantId === null
        ? null
        : typeof row.sourceAssistantId === "string" && row.sourceAssistantId.trim().length > 0
          ? row.sourceAssistantId.trim()
          : (() => {
              throw new BadRequestException(
                "sourceAssistantId must be a non-empty string when provided."
              );
            })();
    const blockedUntil =
      row.blockedUntil === undefined || row.blockedUntil === null
        ? null
        : typeof row.blockedUntil === "string" && row.blockedUntil.trim().length > 0
          ? this.parseBlockedUntil(row.blockedUntil.trim())
          : (() => {
              throw new BadRequestException("blockedUntil must be an ISO timestamp when provided.");
            })();
    return {
      userId: row.userId.trim(),
      reasonCode,
      sourceAssistantId,
      blockedUntil
    };
  }

  async listActiveRestrictions(
    adminUserId: string,
    userId?: string
  ): Promise<{ activeCount: number; restrictions: AdminSafetyRestrictionSummary[] }> {
    const context = await this.adminAuthorizationService.assertCanManageSafetyControls(adminUserId);
    const trimmedUserId = userId?.trim() || null;
    if (trimmedUserId !== null) {
      await this.assertTargetUserInAdminScope(trimmedUserId, context);
      const restriction =
        await this.userRestrictionRepository.findActiveSafetyRestriction(trimmedUserId);
      if (restriction === null) {
        return { activeCount: 0, restrictions: [] };
      }
      const user = await this.requireUser(trimmedUserId);
      return {
        activeCount: 1,
        restrictions: [mapRestrictionSummary(restriction, user)]
      };
    }

    const rows = await this.prisma.userRestriction.findMany({
      where: {
        kind: "safety",
        status: "active",
        OR: [{ blockedUntil: null }, { blockedUntil: { gt: new Date() } }],
        ...(context.hasGlobalPlatformAdminScope
          ? {}
          : {
              user: {
                workspaceLinks: {
                  some: {
                    workspaceId: context.workspaceId
                  }
                }
              }
            })
      },
      include: {
        user: {
          select: {
            email: true,
            displayName: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100
    });
    const restrictions = rows.map((row) =>
      mapRestrictionSummary(
        {
          id: row.id,
          userId: row.userId,
          kind: "safety",
          status: "active",
          blockedUntil: row.blockedUntil,
          reasonCode: row.reasonCode,
          source: row.source,
          sourceAssistantId: row.sourceAssistantId,
          sourceModerationCaseId: row.sourceModerationCaseId,
          clearedAt: row.clearedAt,
          clearedByUserId: row.clearedByUserId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        },
        row.user
      )
    );
    const activeCount = await this.prisma.userRestriction.count({
      where: {
        kind: "safety",
        status: "active",
        OR: [{ blockedUntil: null }, { blockedUntil: { gt: new Date() } }],
        ...(context.hasGlobalPlatformAdminScope
          ? {}
          : {
              user: {
                workspaceLinks: {
                  some: {
                    workspaceId: context.workspaceId
                  }
                }
              }
            })
      }
    });
    return { activeCount, restrictions };
  }

  async listModerationCases(
    adminUserId: string,
    query: { userId?: string; caseId?: string }
  ): Promise<{ cases: AdminSafetyModerationCaseSummary[] }> {
    const context = await this.adminAuthorizationService.assertCanManageSafetyControls(adminUserId);
    const trimmedCaseId = query.caseId?.trim() || null;
    const trimmedUserId = query.userId?.trim() || null;
    if (trimmedCaseId === null && trimmedUserId === null) {
      throw new BadRequestException("userId or caseId is required.");
    }
    if (trimmedCaseId !== null && trimmedUserId !== null) {
      throw new BadRequestException("Provide only one of userId or caseId.");
    }

    const rows =
      trimmedCaseId !== null
        ? await this.prisma.moderationCase.findMany({
            where: { id: trimmedCaseId },
            take: 1
          })
        : await this.prisma.moderationCase.findMany({
            where: { userId: trimmedUserId as string },
            orderBy: { createdAt: "desc" },
            take: 20
          });

    const filteredRows = [];
    for (const row of rows) {
      await this.assertTargetUserInAdminScope(row.userId, context);
      filteredRows.push(row);
    }

    return {
      cases: filteredRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        assistantId: row.assistantId,
        chatId: row.chatId,
        surface: row.surface,
        decision: row.decision,
        reasonCode: row.reasonCode,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }))
    };
  }

  async unblock(
    adminUserId: string,
    input: AdminSafetyUnblockInput
  ): Promise<{ userId: string; cleared: boolean }> {
    const context = await this.adminAuthorizationService.assertCanManageSafetyControls(adminUserId);
    await this.assertTargetUserInAdminScope(input.userId, context);
    const cleared = await this.userRestrictionRepository.clearActiveSafetyRestriction(
      input.userId,
      adminUserId
    );
    if (cleared === null) {
      return { userId: input.userId, cleared: false };
    }
    const workspaceId = await this.resolvePrimaryWorkspaceId(input.userId);
    await this.appendAssistantAuditEventService.execute({
      workspaceId,
      assistantId: cleared.sourceAssistantId,
      actorUserId: adminUserId,
      eventCategory: "admin_action",
      eventCode: "admin.safety_user_unrestricted",
      summary: "Admin cleared active platform safety restriction.",
      details: {
        userId: input.userId,
        previousReasonCode: cleared.reasonCode,
        previousSource: cleared.source,
        previousSourceAssistantId: cleared.sourceAssistantId,
        previousSourceModerationCaseId: cleared.sourceModerationCaseId,
        actorRoles: context.roles
      }
    });
    return { userId: input.userId, cleared: true };
  }

  async restrict(
    adminUserId: string,
    input: AdminSafetyRestrictInput,
    stepUpToken: string | null
  ): Promise<{ userId: string; restricted: true; reasonCode: string }> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      adminUserId,
      "admin.safety_user.restrict",
      stepUpToken
    );
    await this.assertTargetUserInAdminScope(input.userId, context);
    if (input.sourceAssistantId !== null) {
      const assistant = await this.prisma.assistant.findUnique({
        where: { id: input.sourceAssistantId },
        select: { id: true, userId: true, workspaceId: true }
      });
      if (assistant === null || assistant.userId !== input.userId) {
        throw new BadRequestException("sourceAssistantId does not belong to target user.");
      }
      if (!context.hasGlobalPlatformAdminScope && assistant.workspaceId !== context.workspaceId) {
        throw new NotFoundException("Assistant not found in admin workspace.");
      }
    }
    const restriction = await this.userRestrictionRepository.upsertAdminSafetyRestriction({
      userId: input.userId,
      reasonCode: input.reasonCode,
      sourceAssistantId: input.sourceAssistantId,
      blockedUntil: input.blockedUntil
    });
    const workspaceId = await this.resolvePrimaryWorkspaceId(input.userId);
    await this.appendAssistantAuditEventService.execute({
      workspaceId,
      assistantId: restriction.sourceAssistantId,
      actorUserId: adminUserId,
      eventCategory: "admin_action",
      eventCode: "admin.safety_user_restricted",
      summary: "Admin applied platform safety restriction.",
      details: {
        userId: input.userId,
        reasonCode: restriction.reasonCode,
        source: restriction.source,
        sourceAssistantId: restriction.sourceAssistantId,
        blockedUntil: restriction.blockedUntil?.toISOString() ?? null,
        actorRoles: context.roles
      }
    });
    return { userId: input.userId, restricted: true, reasonCode: restriction.reasonCode };
  }

  private parseReasonCode(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException("reasonCode is required.");
    }
    const reasonCode = value.trim();
    if (!REASON_CODE_PATTERN.test(reasonCode)) {
      throw new BadRequestException(
        "reasonCode must start with a letter and contain only lowercase letters, digits, and underscores."
      );
    }
    return reasonCode;
  }

  private parseBlockedUntil(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("blockedUntil must be a valid ISO timestamp.");
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException("blockedUntil must be in the future.");
    }
    return parsed;
  }

  private async requireUser(
    userId: string
  ): Promise<{ email: string; displayName: string | null }> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true }
    });
    if (user === null) {
      throw new NotFoundException("User not found.");
    }
    return user;
  }

  private async assertTargetUserInAdminScope(
    targetUserId: string,
    context: {
      workspaceId: string;
      hasGlobalPlatformAdminScope: boolean;
    }
  ): Promise<void> {
    if (context.hasGlobalPlatformAdminScope) {
      const exists = await this.prisma.appUser.findUnique({
        where: { id: targetUserId },
        select: { id: true }
      });
      if (exists === null) {
        throw new NotFoundException("User not found.");
      }
      return;
    }
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId: targetUserId,
        workspaceId: context.workspaceId
      },
      select: { userId: true }
    });
    if (membership === null) {
      throw new NotFoundException("User not found in admin workspace.");
    }
  }

  private async resolvePrimaryWorkspaceId(userId: string): Promise<string | null> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true }
    });
    return membership?.workspaceId ?? null;
  }
}
