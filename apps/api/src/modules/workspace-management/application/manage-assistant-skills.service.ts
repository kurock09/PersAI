import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  createEnabledSkillBootstrapCadenceState,
  createInactiveSkillDecisionState
} from "./auto-skill-routing-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import {
  parseAssistantSkillAssignmentsInput,
  toAdminSkillState,
  toAssistantSkillAssignmentState,
  type AssistantSkillCatalogItemState,
  type AssistantSkillsState
} from "./skill-management.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const DEFAULT_ENABLED_SKILL_LIMIT: number | null = null;

@Injectable()
export class ManageAssistantSkillsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  parseAssignmentsInput(body: unknown): { skillIds: string[] } {
    try {
      return parseAssistantSkillAssignmentsInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Skill assignments request.";
      throw new BadRequestException(message);
    }
  }

  async list(userId: string): Promise<AssistantSkillsState> {
    const assistant = await this.resolveAssistant(userId);
    const limit = await this.resolveEnabledSkillLimit(assistant);
    const [skills, assignments] = await Promise.all([
      this.prisma.skill.findMany({
        where: {
          OR: [
            { status: "active" },
            {
              assignments: {
                some: {
                  assistantId: assistant.id,
                  userId: assistant.userId
                }
              }
            }
          ]
        },
        include: { documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }]
      }),
      this.prisma.assistantSkillAssignment.findMany({
        where: {
          assistantId: assistant.id,
          userId: assistant.userId
        }
      })
    ]);
    const assignmentBySkillId = new Map(
      assignments.map((assignment) => [assignment.skillId, assignment])
    );
    const assignedSkillIds = assignments
      .filter((assignment) => assignment.status === "active")
      .map((assignment) => assignment.skillId);
    const assignedCount = assignedSkillIds.length;

    return {
      skills: skills.map((skill) => {
        const assignment = assignmentBySkillId.get(skill.id) ?? null;
        const active = skill.status === "active";
        const alreadyAssigned = assignment?.status === "active";
        const overLimit = limit !== null && assignedCount >= limit && !alreadyAssigned;
        return {
          skill: toAdminSkillState(skill),
          assignment: assignment === null ? null : toAssistantSkillAssignmentState(assignment),
          selectable: active && !overLimit,
          disabledReason: active ? (overLimit ? "skill_limit_reached" : null) : "skill_archived"
        } satisfies AssistantSkillCatalogItemState;
      }),
      assignedSkillIds,
      limit
    };
  }

  async replaceAssignments(userId: string, skillIds: string[]): Promise<AssistantSkillsState> {
    const assistant = await this.resolveAssistant(userId);
    const limit = await this.resolveEnabledSkillLimit(assistant);
    if (limit !== null && skillIds.length > limit) {
      throw new BadRequestException(`This plan allows at most ${String(limit)} enabled Skills.`);
    }
    const skills = await this.prisma.skill.findMany({
      where: {
        id: { in: skillIds }
      },
      select: {
        id: true,
        status: true
      }
    });
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
    for (const skillId of skillIds) {
      const skill = skillById.get(skillId);
      if (skill === undefined) {
        throw new BadRequestException(`Skill ${skillId} is not available.`);
      }
      if (skill.status !== "active") {
        throw new BadRequestException(`Skill ${skillId} is not active.`);
      }
    }
    const selected = new Set(skillIds);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.assistantSkillAssignment.findMany({
        where: {
          assistantId: assistant.id,
          userId: assistant.userId
        }
      });
      for (const assignment of existing) {
        if (!selected.has(assignment.skillId) && assignment.status === "active") {
          await tx.assistantSkillAssignment.update({
            where: { id: assignment.id },
            data: {
              status: "disabled",
              disabledReason: "user_disabled",
              disabledAt: now
            }
          });
        }
      }
      for (const skillId of selected) {
        await tx.assistantSkillAssignment.upsert({
          where: {
            assistantId_skillId: {
              assistantId: assistant.id,
              skillId
            }
          },
          create: {
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            skillId,
            status: "active",
            disabledReason: null,
            enabledAt: now,
            disabledAt: null
          },
          update: {
            status: "active",
            disabledReason: null,
            enabledAt: now,
            disabledAt: null
          }
        });
      }
      await tx.assistantChat.updateMany({
        where: {
          assistantId: assistant.id
        },
        data: {
          skillDecisionState:
            selected.size === 0
              ? Prisma.DbNull
              : (createInactiveSkillDecisionState() as unknown as Prisma.InputJsonValue),
          skillCadenceState:
            selected.size === 0
              ? Prisma.DbNull
              : (createEnabledSkillBootstrapCadenceState() as unknown as Prisma.InputJsonValue),
          skillRetrievalState: Prisma.DbNull
        }
      });
    });
    await this.prisma.assistant.update({
      where: { id: assistant.id },
      data: { configDirtyAt: new Date() }
    });
    return this.list(userId);
  }

  private async resolveAssistant(userId: string): Promise<{
    id: string;
    userId: string;
    workspaceId: string;
    governance: {
      assistantPlanOverrideCode: string | null;
      quotaPlanCode: string | null;
    } | null;
  }> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: (await this.resolveActiveAssistantService.execute({ userId })).assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        governance: {
          select: {
            assistantPlanOverrideCode: true,
            quotaPlanCode: true
          }
        }
      }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }
    return assistant;
  }

  private async resolveEnabledSkillLimit(assistant: {
    id: string;
    userId: string;
    workspaceId: string;
    governance: {
      assistantPlanOverrideCode: string | null;
      quotaPlanCode: string | null;
    } | null;
  }): Promise<number | null> {
    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: assistant.governance?.assistantPlanOverrideCode ?? null,
      assistantQuotaPlanCode: assistant.governance?.quotaPlanCode ?? null
    });
    if (effectiveSubscription.planCode === null) {
      return DEFAULT_ENABLED_SKILL_LIMIT;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: effectiveSubscription.planCode },
      select: {
        billingProviderHints: true,
        entitlement: {
          select: {
            limitsPermissions: true
          }
        }
      }
    });
    return (
      readLimitFromBillingHints(plan?.billingProviderHints ?? null) ??
      readLimitFromLimitsPermissions(plan?.entitlement?.limitsPermissions ?? null) ??
      DEFAULT_ENABLED_SKILL_LIMIT
    );
  }
}

function readLimitFromBillingHints(value: unknown): number | null {
  const row = asObject(value);
  const skillPolicy = asObject(row?.skillPolicy ?? null);
  return (
    asNonNegativeInteger(skillPolicy?.maxEnabledSkills) ??
    asNonNegativeInteger(row?.maxEnabledSkills)
  );
}

function readLimitFromLimitsPermissions(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    const row = asObject(item);
    if (
      row?.key === "enabled_skills_limit" ||
      row?.key === "max_enabled_skills" ||
      row?.key === "skill_assignments_limit"
    ) {
      const limit = asNonNegativeInteger(row.limit) ?? asNonNegativeInteger(row.value);
      if (limit !== null) {
        return limit;
      }
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
