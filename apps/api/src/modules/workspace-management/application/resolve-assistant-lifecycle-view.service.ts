import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveAssistantPolicy } from "./assistant-policy";
import { toAssistantLifecycleState, toAssistantListItemState } from "./assistant-lifecycle.mapper";
import type {
  AssistantDirectoryState,
  AssistantLifecycleState,
  AssistantLifecycleViewState
} from "./assistant-lifecycle.types";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const ACTIVE_ASSISTANT_REQUIRED_MESSAGE =
  "Active assistant selection is required because this workspace has multiple assistants.";

@Injectable()
export class ResolveAssistantLifecycleViewService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleViewState> {
    const membership = await this.resolveActiveAssistantService.resolveMembership(userId);
    const [assistants, plan] = await Promise.all([
      this.prisma.assistant.findMany({
        where: { workspaceId: membership.workspaceId },
        orderBy: { createdAt: "asc" }
      }),
      this.resolveWorkspacePlan(membership.workspaceId)
    ]);

    const directoryState: AssistantDirectoryState = {
      assistants: assistants.map((assistant) => toAssistantListItemState(assistant)),
      activeAssistantId: null,
      assistantLimit: {
        usedAssistants: assistants.length,
        maxAssistants: resolveAssistantPolicy({
          billingProviderHints: plan?.billingProviderHints ?? null
        }).maxAssistants
      }
    };

    if (assistants.length === 0) {
      return { assistant: null, ...directoryState };
    }

    try {
      const resolved = await this.resolveActiveAssistantService.executeOptional({ userId });
      if (resolved === null) {
        return { assistant: null, ...directoryState };
      }
      return {
        assistant: await this.mapAssistantLifecycleState(resolved.assistant),
        ...directoryState,
        activeAssistantId: resolved.assistantId
      };
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === ACTIVE_ASSISTANT_REQUIRED_MESSAGE
      ) {
        return { assistant: null, ...directoryState };
      }
      throw error;
    }
  }

  assertActiveAssistant(
    state: AssistantLifecycleViewState,
    notFoundMessage: string
  ): AssistantLifecycleState {
    if (state.assistant !== null) {
      return state.assistant;
    }
    if (state.assistants.length > 1 && state.activeAssistantId === null) {
      throw new ConflictException(ACTIVE_ASSISTANT_REQUIRED_MESSAGE);
    }
    throw new NotFoundException(notFoundMessage);
  }

  private async mapAssistantLifecycleState(
    assistant: Parameters<typeof toAssistantLifecycleState>[0]
  ): Promise<AssistantLifecycleState> {
    const [latestPublishedVersion, governance, materialization] = await Promise.all([
      this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id),
      this.assistantGovernanceRepository.findByAssistantId(assistant.id),
      this.assistantMaterializedSpecRepository.findLatestByAssistantId(assistant.id)
    ]);

    return toAssistantLifecycleState(
      assistant,
      latestPublishedVersion,
      governance,
      materialization
    );
  }

  private async resolveWorkspacePlan(workspaceId: string) {
    const workspaceSubscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
      select: { planCode: true }
    });
    if (workspaceSubscription?.planCode) {
      return this.assistantPlanCatalogRepository.findByCode(workspaceSubscription.planCode);
    }
    return this.assistantPlanCatalogRepository.findDefaultRegistrationPlan();
  }
}
