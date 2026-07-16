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
  type SkillScenarioStepState,
  type SkillScenarioStatus,
  type UpdateSkillScenarioInput
} from "./skill-scenario.types";
import {
  lockAssistantChatRows,
  lockAssistantRoleRows,
  lockAssistantRows,
  lockRoleSkillRowsForSkill,
  lockSkillRow
} from "./assistant-skill-mutation-locks";

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
    const row = await this.prisma.$transaction(async (tx) => {
      const assistantIds = await this.lockMutationScope(tx, skillId);
      const existing = await tx.skillScenario.findFirst({
        where: { skillId, key: input.key }
      });
      if (existing !== null) {
        throw new ConflictException(
          `Skill scenario with key "${input.key}" already exists for this Skill.`
        );
      }
      await this.assertScriptRefsAvailable(tx, skillId, input.steps);

      const status = input.status ?? "draft";
      const created = await tx.skillScenario.create({
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
          firstStepPreview: input.firstStepPreview ?? null,
          status,
          displayOrder: input.displayOrder ?? 100
        }
      });
      await this.invalidateAssistants(tx, assistantIds);
      return created;
    });
    return toAdminSkillScenarioState(row);
  }

  async updateScenario(
    userId: string,
    skillId: string,
    key: string,
    input: UpdateSkillScenarioInput
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const row = await this.prisma.$transaction(async (tx) => {
      const assistantIds = await this.lockMutationScope(tx, skillId);
      const existing = await tx.skillScenario.findFirst({
        where: { skillId, key }
      });
      if (existing === null) {
        throw new NotFoundException("Skill scenario not found.");
      }
      await this.lockScenarioRow(tx, existing.id);
      const existingState = toAdminSkillScenarioState(existing);
      await this.assertScriptRefsAvailable(tx, skillId, input.steps ?? existingState.steps);

      if (input.status !== undefined && input.status !== existing.status) {
        const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status as SkillScenarioStatus];
        if (!allowed.includes(input.status)) {
          throw new BadRequestException(
            `Status transition from "${existing.status}" to "${input.status}" is not allowed. ` +
              `Allowed transitions from "${existing.status}": ${allowed.join(", ") || "none"}.`
          );
        }
      }

      const updated = await tx.skillScenario.update({
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
          ...(input.firstStepPreview !== undefined
            ? { firstStepPreview: input.firstStepPreview }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {})
        }
      });
      await this.invalidateAssistants(tx, assistantIds);
      return updated;
    });
    return toAdminSkillScenarioState(row);
  }

  async archiveScenario(
    userId: string,
    skillId: string,
    key: string
  ): Promise<AdminSkillScenarioState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const row = await this.prisma.$transaction(async (tx) => {
      const assistantIds = await this.lockMutationScope(tx, skillId);
      const existing = await tx.skillScenario.findFirst({
        where: { skillId, key }
      });
      if (existing === null) {
        throw new NotFoundException("Skill scenario not found.");
      }
      await this.lockScenarioRow(tx, existing.id);
      if (existing.status === "archived") {
        return existing;
      }
      const archived = await tx.skillScenario.update({
        where: { id: existing.id },
        data: { status: "archived" }
      });
      await this.invalidateAssistants(tx, assistantIds);
      return archived;
    });
    return toAdminSkillScenarioState(row);
  }

  private async requireSkill(skillId: string): Promise<void> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId } });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
  }

  private async assertScriptRefsAvailable(
    tx: Prisma.TransactionClient,
    skillId: string,
    steps: SkillScenarioStepState[]
  ): Promise<void> {
    const scriptKeys = [
      ...new Set(
        steps
          .map((step) => step.scriptRef?.scriptKey)
          .filter((key): key is string => typeof key === "string")
      )
    ];
    if (scriptKeys.length === 0) {
      return;
    }
    const linked = await tx.script.findMany({
      where: {
        key: { in: scriptKeys },
        status: "published",
        currentPublishedVersionId: { not: null },
        skillLinks: { some: { skillId } }
      },
      select: { key: true }
    });
    const available = new Set(linked.map((script) => script.key));
    const unavailable = scriptKeys.filter((key) => !available.has(key));
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `Scenario Script reference must be linked to this Skill and currently published: ${unavailable.join(", ")}.`
      );
    }
  }

  private async lockMutationScope(
    tx: Prisma.TransactionClient,
    skillId: string
  ): Promise<string[]> {
    await lockSkillRow(tx, skillId);
    const skill = await tx.skill.findUnique({
      where: { id: skillId },
      select: { id: true }
    });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
    const candidateRoles = await tx.assistantRole.findMany({
      where: {
        status: "active",
        skillLinks: { some: { skillId } }
      },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const lockedRoles = await lockAssistantRoleRows(
      tx,
      candidateRoles.map((role) => role.id)
    );
    const activeLinkedRoles =
      lockedRoles.length === 0
        ? []
        : await tx.assistantRole.findMany({
            where: {
              id: { in: lockedRoles.map((role) => role.id) },
              status: "active",
              skillLinks: { some: { skillId } }
            },
            select: { id: true },
            orderBy: { id: "asc" }
          });
    const affected = await tx.assistant.findMany({
      where: { roleId: { in: activeLinkedRoles.map((role) => role.id) } },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const assistantIds = affected.map((assistant) => assistant.id);
    await lockAssistantRows(tx, assistantIds);
    await lockAssistantChatRows(tx, assistantIds);
    await lockRoleSkillRowsForSkill(tx, skillId);
    return assistantIds;
  }

  private async lockScenarioRow(tx: Prisma.TransactionClient, scenarioId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "skill_scenarios"
      WHERE "id" = ${scenarioId}::uuid
      FOR UPDATE
    `);
  }

  private async invalidateAssistants(
    tx: Prisma.TransactionClient,
    assistantIds: string[]
  ): Promise<void> {
    if (assistantIds.length === 0) {
      return;
    }
    const clockRows = await tx.$queryRaw<Array<{ dirtyAt: Date }>>(Prisma.sql`
      SELECT clock_timestamp() AS "dirtyAt"
    `);
    const dirtyAt = clockRows[0]?.dirtyAt;
    if (dirtyAt === undefined) {
      throw new Error("Database clock did not return a Skill scenario invalidation timestamp.");
    }
    await tx.assistant.updateMany({
      where: { id: { in: assistantIds } },
      data: { configDirtyAt: dirtyAt }
    });
    await tx.assistantChat.updateMany({
      where: { assistantId: { in: assistantIds } },
      data: {
        skillDecisionState: Prisma.DbNull,
        skillRetrievalState: Prisma.DbNull
      }
    });
  }
}
