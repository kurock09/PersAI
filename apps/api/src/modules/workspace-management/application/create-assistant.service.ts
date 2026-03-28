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
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

@Injectable()
export class CreateAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
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

    const assistant = await this.assistantRepository.create(userId, membership.workspaceId);
    const governance = await this.assistantGovernanceRepository.createBaseline(assistant.id);
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      assistant.id
    );
    try {
      await this.runtimeAdapter.resetMemoryWorkspace(assistant.id);
    } catch (err) {
      console.warn("[assistant.create] Non-fatal: failed to initialize memory workspace:", err);
    }
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
    return toAssistantLifecycleState(assistant, null, governance, materialization);
  }
}
