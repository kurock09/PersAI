import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  parseCreateSkillScenarioInput,
  parseUpdateSkillScenarioInput,
  toAdminSkillScenarioState,
  type AdminSkillScenarioState,
  type CreateSkillScenarioInput,
  type SkillScenarioStatus,
  type UpdateSkillScenarioInput
} from "./skill-scenario.types";

const ALLOWED_STATUS_TRANSITIONS: Record<SkillScenarioStatus, SkillScenarioStatus[]> = {
  draft: ["active"],
  active: ["archived"],
  archived: ["active"]
};

@Injectable()
export class ManageSkillScenariosService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseCreateInput(body: unknown): CreateSkillScenarioInput {
    try {
      return parseCreateSkillScenarioInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Skill scenario request.";
      throw new BadRequestException(message);
    }
  }

  parseUpdateInput(body: unknown): UpdateSkillScenarioInput {
    try {
      return parseUpdateSkillScenarioInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid Skill scenario update request.";
      throw new BadRequestException(message);
    }
  }

  async listScenarios(
    userId: string,
    skillId: string,
    options?: { includeArchived?: boolean }
  ): Promise<AdminSkillScenarioState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    await this.requireSkill(skillId);
    const whereStatus = options?.includeArchived ? undefined : { not: "archived" as const };
    const rows = await this.prisma.skillScenario.findMany({
      where: {
        skillId,
        ...(whereStatus !== undefined ? { status: whereStatus } : {})
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map(toAdminSkillScenarioState);
  }

  async getScenario(
    userId: string,
    skillId: string,
    key: string
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const row = await this.prisma.skillScenario.findFirst({
      where: { skillId, key }
    });
    if (row === null) {
      throw new NotFoundException("Skill scenario not found.");
    }
    return toAdminSkillScenarioState(row);
  }

  async createScenario(
    userId: string,
    skillId: string,
    input: CreateSkillScenarioInput
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    await this.requireSkill(skillId);

    const existing = await this.prisma.skillScenario.findFirst({
      where: { skillId, key: input.key }
    });
    if (existing !== null) {
      throw new ConflictException(
        `Skill scenario with key "${input.key}" already exists for this Skill.`
      );
    }

    const status = input.status ?? "draft";
    const row = await this.prisma.skillScenario.create({
      data: {
        skillId,
        key: input.key,
        displayName: input.displayName as Prisma.InputJsonValue,
        description: input.description as Prisma.InputJsonValue,
        iconEmoji: input.iconEmoji,
        intentExamples: input.intentExamples as Prisma.InputJsonValue,
        steps: input.steps as Prisma.InputJsonValue,
        recommendedTools: input.recommendedTools as Prisma.InputJsonValue,
        exitCondition: input.exitCondition,
        status,
        displayOrder: input.displayOrder ?? 100
      }
    });

    await this.markAssignedAssistantsDirty(skillId);
    return toAdminSkillScenarioState(row);
  }

  async updateScenario(
    userId: string,
    skillId: string,
    key: string,
    input: UpdateSkillScenarioInput
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);

    const existing = await this.prisma.skillScenario.findFirst({
      where: { skillId, key }
    });
    if (existing === null) {
      throw new NotFoundException("Skill scenario not found.");
    }

    if (input.status !== undefined && input.status !== existing.status) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status as SkillScenarioStatus];
      if (!allowed.includes(input.status)) {
        throw new BadRequestException(
          `Status transition from "${existing.status}" to "${input.status}" is not allowed. ` +
            `Allowed transitions from "${existing.status}": ${allowed.join(", ") || "none"}.`
        );
      }
    }

    const row = await this.prisma.skillScenario.update({
      where: { id: existing.id },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName as Prisma.InputJsonValue }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description as Prisma.InputJsonValue }
          : {}),
        ...(input.iconEmoji !== undefined ? { iconEmoji: input.iconEmoji } : {}),
        ...(input.intentExamples !== undefined
          ? { intentExamples: input.intentExamples as Prisma.InputJsonValue }
          : {}),
        ...(input.steps !== undefined ? { steps: input.steps as Prisma.InputJsonValue } : {}),
        ...(input.recommendedTools !== undefined
          ? { recommendedTools: input.recommendedTools as Prisma.InputJsonValue }
          : {}),
        ...(input.exitCondition !== undefined ? { exitCondition: input.exitCondition } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {})
      }
    });

    await this.markAssignedAssistantsDirty(skillId);
    return toAdminSkillScenarioState(row);
  }

  async archiveScenario(
    userId: string,
    skillId: string,
    key: string
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);

    const existing = await this.prisma.skillScenario.findFirst({
      where: { skillId, key }
    });
    if (existing === null) {
      throw new NotFoundException("Skill scenario not found.");
    }

    if (existing.status === "archived") {
      return toAdminSkillScenarioState(existing);
    }

    const row = await this.prisma.skillScenario.update({
      where: { id: existing.id },
      data: { status: "archived" }
    });

    await this.markAssignedAssistantsDirty(skillId);
    return toAdminSkillScenarioState(row);
  }

  private async requireSkill(skillId: string): Promise<void> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId } });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
  }

  private async markAssignedAssistantsDirty(skillId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: {
        skillAssignments: {
          some: { skillId }
        }
      },
      data: { configDirtyAt: new Date() }
    });
  }
}
