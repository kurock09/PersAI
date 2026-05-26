import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { WorkspaceStatus } from "@prisma/client";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import type { Assistant } from "../domain/assistant.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveAssistantPolicy } from "./assistant-policy";

export type WorkspaceMembershipResolution = {
  workspaceId: string;
  workspaceMemberId: string;
  activeAssistantId: string | null;
};

export type ActiveAssistantLimitState = {
  maxAssistants: number;
};

export type ResolvedActiveAssistantContext = {
  userId: string;
  workspaceId: string;
  workspaceMemberId: string;
  assistantId: string;
  assistant: Assistant;
  plan: AssistantPlanCatalog | null;
  assistantLimit: ActiveAssistantLimitState;
};

@Injectable()
export class ResolveActiveAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(input: {
    userId: string;
    assistantId?: string | null;
  }): Promise<ResolvedActiveAssistantContext> {
    const resolved = await this.executeOptional(input);
    if (resolved !== null) {
      return resolved;
    }
    throw new NotFoundException("Assistant does not exist for this workspace.");
  }

  async executeOptional(input: {
    userId: string;
    assistantId?: string | null;
  }): Promise<ResolvedActiveAssistantContext | null> {
    const membership = await this.resolveMembership(input.userId);
    const selectedAssistantId = await this.resolveAssistantId({
      userId: input.userId,
      membership,
      assistantId: input.assistantId ?? null
    });
    if (selectedAssistantId === null) {
      return null;
    }

    const assistant = await this.assistantRepository.findById(selectedAssistantId);
    if (assistant === null || assistant.workspaceId !== membership.workspaceId) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }

    const plan = await this.resolveWorkspacePlan(membership.workspaceId);
    return {
      userId: input.userId,
      workspaceId: membership.workspaceId,
      workspaceMemberId: membership.workspaceMemberId,
      assistantId: assistant.id,
      assistant,
      plan,
      assistantLimit: {
        maxAssistants: resolveAssistantPolicy({
          billingProviderHints: plan?.billingProviderHints ?? null
        }).maxAssistants
      }
    };
  }

  async resolveMembership(userId: string): Promise<WorkspaceMembershipResolution> {
    const activeMembership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspace: { status: WorkspaceStatus.active }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        workspaceId: true,
        activeAssistantId: true
      }
    });
    const membership =
      activeMembership ??
      (await this.prisma.workspaceMember.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          workspaceId: true,
          activeAssistantId: true
        }
      }));

    if (membership === null) {
      throw new BadRequestException(
        "Cannot resolve assistant without workspace membership. Complete onboarding first."
      );
    }

    return {
      workspaceId: membership.workspaceId,
      workspaceMemberId: membership.id,
      activeAssistantId: membership.activeAssistantId
    };
  }

  private async resolveAssistantId(input: {
    userId: string;
    membership: WorkspaceMembershipResolution;
    assistantId: string | null;
  }): Promise<string | null> {
    if (input.assistantId !== null) {
      const explicitAssistant = await this.prisma.assistant.findFirst({
        where: {
          id: input.assistantId,
          workspaceId: input.membership.workspaceId
        },
        select: { id: true }
      });
      if (explicitAssistant === null) {
        throw new NotFoundException("Assistant does not exist for this workspace.");
      }
      return explicitAssistant.id;
    }

    if (input.membership.activeAssistantId !== null) {
      const activeAssistant = await this.prisma.assistant.findFirst({
        where: {
          id: input.membership.activeAssistantId,
          workspaceId: input.membership.workspaceId
        },
        select: { id: true }
      });
      if (activeAssistant !== null) {
        return activeAssistant.id;
      }
      throw new ConflictException("Stored active assistant is invalid for this workspace.");
    }

    const workspaceAssistants = await this.prisma.assistant.findMany({
      where: { workspaceId: input.membership.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: 2
    });
    if (workspaceAssistants.length === 0) {
      return null;
    }
    if (workspaceAssistants.length > 1) {
      throw new ConflictException(
        "Active assistant selection is required because this workspace has multiple assistants."
      );
    }

    const singleAssistant = workspaceAssistants[0];
    if (singleAssistant === undefined) {
      return null;
    }
    await this.prisma.workspaceMember.update({
      where: { id: input.membership.workspaceMemberId },
      data: { activeAssistantId: singleAssistant.id }
    });
    return singleAssistant.id;
  }

  private async resolveWorkspacePlan(workspaceId: string): Promise<AssistantPlanCatalog | null> {
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
