import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";
import { AdminSystemNotificationProducerService } from "./admin-system-notification-producer.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { EnforceAssistantCreationLimitService } from "./enforce-assistant-creation-limit.service";

@Injectable()
export class CreateAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminSystemNotificationProducerService: AdminSystemNotificationProducerService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly enforceAssistantCreationLimitService: EnforceAssistantCreationLimitService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const assistantCreationLimit = await this.enforceAssistantCreationLimitService.execute(userId);

    const assistant = await this.assistantRepository.create(
      userId,
      assistantCreationLimit.workspaceId
    );
    await this.prisma.workspaceMember.update({
      where: { id: assistantCreationLimit.workspaceMemberId },
      data: { activeAssistantId: assistant.id }
    });
    const governance = await this.assistantGovernanceRepository.createBaseline(assistant.id);
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      assistant.id
    );
    const appUser = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "assistant_lifecycle",
      eventCode: "assistant.created",
      summary: "Assistant baseline created.",
      details: {
        governanceBaselineCreated: true
      }
    });
    const email = appUser?.email ?? userId;
    const isFirstAssistantInWorkspace = assistantCreationLimit.usedAssistants === 0;
    void this.adminSystemNotificationProducerService
      .emitEvent({
        eventCode: isFirstAssistantInWorkspace ? "new_user_registered" : "assistant_created",
        summary: isFirstAssistantInWorkspace
          ? `New user registered: ${email}`
          : `User ${email} created a new assistant`,
        details: {
          sourceWorkspaceId: assistant.workspaceId,
          sourceAssistantId: assistant.id,
          sourceUserId: userId,
          email: appUser?.email ?? null,
          assistantDisplayName: assistant.draftDisplayName,
          isFirstAssistantInWorkspace
        },
        traceId: `assistant-created:${assistant.id}`
      })
      .catch(() => {});
    return toAssistantLifecycleState(assistant, null, governance, materialization);
  }
}
