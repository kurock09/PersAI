import { Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type ForceReapplyAllSummary = {
  totalAssistants: number;
  withPublishedVersion: number;
  succeeded: number;
  degraded: number;
  failed: number;
  skipped: number;
};

@Injectable()
export class ForceReapplyAllService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository
  ) {}

  async execute(userId: string, stepUpToken: string | null): Promise<ForceReapplyAllSummary> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.force_reapply_all",
      stepUpToken
    );

    const newGeneration = await this.bumpConfigGenerationService.execute();

    const assistants = await this.prisma.assistant.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true }
    });

    const summary: ForceReapplyAllSummary = {
      totalAssistants: assistants.length,
      withPublishedVersion: 0,
      succeeded: 0,
      degraded: 0,
      failed: 0,
      skipped: 0
    };

    for (const assistant of assistants) {
      const latest = await this.publishedVersionRepository.findLatestByAssistantId(assistant.id);
      if (latest === null) {
        summary.skipped += 1;
        continue;
      }

      summary.withPublishedVersion += 1;

      try {
        await this.applyAssistantPublishedVersionService.execute(assistant.userId, latest, true);
        const afterApply = await this.prisma.assistant.findUnique({
          where: { id: assistant.id },
          select: { applyStatus: true }
        });
        const status = afterApply?.applyStatus ?? null;
        if (status === "succeeded") {
          summary.succeeded += 1;
        } else if (status === "degraded") {
          summary.degraded += 1;
        } else {
          summary.failed += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.force_reapply_all",
      summary: "Admin triggered force reapply for all assistants.",
      details: { ...summary, configGeneration: newGeneration }
    });

    return summary;
  }
}
