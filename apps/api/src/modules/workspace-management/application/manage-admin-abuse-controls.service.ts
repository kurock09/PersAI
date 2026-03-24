import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_ABUSE_GUARD_REPOSITORY,
  type AssistantAbuseGuardRepository
} from "../domain/assistant-abuse-guard.repository";
import type { AbuseSurface } from "../domain/assistant-abuse-guard.entity";
import { Inject } from "@nestjs/common";

export type AdminAbuseUnblockInput = {
  assistantId: string;
  userId: string | null;
  surface: AbuseSurface;
  overrideMinutes: number | null;
};

@Injectable()
export class ManageAdminAbuseControlsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_ABUSE_GUARD_REPOSITORY)
    private readonly assistantAbuseGuardRepository: AssistantAbuseGuardRepository
  ) {}

  parseUnblockInput(body: unknown): AdminAbuseUnblockInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId is required.");
    }
    const assistantId = row.assistantId.trim();
    const userId =
      row.userId === undefined || row.userId === null
        ? null
        : typeof row.userId === "string" && row.userId.trim().length > 0
          ? row.userId.trim()
          : (() => {
              throw new BadRequestException("userId must be a non-empty string when provided.");
            })();
    const surfaceRaw = row.surface;
    const surface: AbuseSurface =
      surfaceRaw === "telegram" || surfaceRaw === "whatsapp" || surfaceRaw === "max"
        ? surfaceRaw
        : "web_chat";
    const overrideMinutes =
      row.overrideMinutes === undefined || row.overrideMinutes === null
        ? null
        : typeof row.overrideMinutes === "number" &&
            Number.isInteger(row.overrideMinutes) &&
            row.overrideMinutes > 0 &&
            row.overrideMinutes <= 24 * 60
          ? row.overrideMinutes
          : (() => {
              throw new BadRequestException(
                "overrideMinutes must be an integer between 1 and 1440."
              );
            })();
    return {
      assistantId,
      userId,
      surface,
      overrideMinutes
    };
  }

  async unblock(
    adminUserId: string,
    input: AdminAbuseUnblockInput
  ): Promise<{
    assistantId: string;
    userId: string | null;
    surface: AbuseSurface;
    adminOverrideUntil: string;
    affectedUserRows: number;
    affectedAssistantRows: number;
  }> {
    const context = await this.adminAuthorizationService.assertCanManageAbuseControls(adminUserId);
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true
      }
    });
    if (assistant === null || assistant.workspaceId !== context.workspaceId) {
      throw new NotFoundException("Assistant not found in admin workspace.");
    }
    if (input.userId !== null && input.userId !== assistant.userId) {
      throw new BadRequestException("userId does not match target assistant owner.");
    }
    const config = loadApiConfig(process.env);
    const overrideMinutes = input.overrideMinutes ?? config.ABUSE_ADMIN_OVERRIDE_MINUTES_DEFAULT;
    const adminOverrideUntil = new Date(Date.now() + overrideMinutes * 60 * 1000);
    const applyResult = await this.assistantAbuseGuardRepository.applyAdminUnblock({
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface,
      adminOverrideUntil
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: input.assistantId,
      actorUserId: adminUserId,
      eventCategory: "admin_action",
      eventCode: "admin.abuse_unblock_applied",
      summary: "Admin abuse/rate-limit unblock override applied.",
      details: {
        assistantId: input.assistantId,
        userId: input.userId,
        surface: input.surface,
        adminOverrideUntil: adminOverrideUntil.toISOString(),
        affectedUserRows: applyResult.userRows,
        affectedAssistantRows: applyResult.assistantRows,
        actorRoles: context.roles,
        legacyOwnerFallback: context.hasLegacyOwnerFallback
      }
    });
    return {
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface,
      adminOverrideUntil: adminOverrideUntil.toISOString(),
      affectedUserRows: applyResult.userRows,
      affectedAssistantRows: applyResult.assistantRows
    };
  }
}
