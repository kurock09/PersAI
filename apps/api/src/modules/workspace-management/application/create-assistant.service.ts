import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { WorkspaceStatus } from "@prisma/client";
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
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

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
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const existingAssistant = await this.assistantRepository.findByUserId(userId);
    if (existingAssistant !== null) {
      throw new ConflictException("Assistant already exists for this user.");
    }

    const activeMembership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspace: { status: WorkspaceStatus.active }
      },
      orderBy: { createdAt: "desc" }
    });

    const membership =
      activeMembership ??
      (await this.prisma.workspaceMember.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" }
      }));

    if (membership === null) {
      throw new BadRequestException(
        "Cannot create assistant without workspace membership. Complete onboarding first."
      );
    }

    const workspaceSubscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: membership.workspaceId },
      select: { id: true }
    });
    if (workspaceSubscription === null) {
      await this.resolveEffectiveSubscriptionStateService.initializeLifecycleNow({
        workspaceId: membership.workspaceId,
        userId,
        source: "system"
      });
    }

    const assistant = await this.assistantRepository.create(userId, membership.workspaceId);
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
    void this.adminSystemNotificationProducerService
      .emitEvent({
        eventCode: "new_user_registered",
        summary: `New user registered: ${appUser?.email ?? userId}`,
        details: {
          sourceWorkspaceId: assistant.workspaceId,
          sourceAssistantId: assistant.id,
          sourceUserId: userId,
          email: appUser?.email ?? null
        },
        traceId: `assistant-created:${assistant.id}`
      })
      .catch(() => {});
    return toAssistantLifecycleState(assistant, null, governance, materialization);
  }
}
