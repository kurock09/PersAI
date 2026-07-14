import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_ASSISTANT_ROLE_ID,
  DEFAULT_ASSISTANT_ROLE_KEY
} from "../../../../prisma/assistant-role-seed-data";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  parseAdminRoleCreateInput,
  parseAdminRolePreviewInput,
  parseAdminRoleSkillsReplaceInput,
  parseAdminRoleUpdateInput,
  toAdminRoleState,
  type AdminRolePreviewInput,
  type AdminRolePreviewState,
  type AdminRoleSkillsReplaceInput,
  type AdminRoleState,
  type AdminRoleUpsertInput
} from "./admin-role-management.types";
import { renderAssistantRoleMissionBlock } from "./assistant-role-prompt";
import {
  localizeAssistantRoleText,
  resolveAssistantRoleEffectiveSkillsPrompt
} from "./assistant-role-effective-skills-prompt";
import {
  lockAssistantChatRows,
  lockAssistantRoleRows,
  lockAssistantRows,
  lockRoleSkillRowsForRole,
  lockSkillRows
} from "./assistant-skill-mutation-locks";

const MAX_SKILL_REPLACE_ATTEMPTS = 3;
const MAX_ROLE_ACTIVATION_ATTEMPTS = 3;
const ROLE_INCLUDE = {
  _count: { select: { assistants: true } },
  skillLinks: {
    include: { skill: true },
    orderBy: [
      { displayOrder: "asc" as const },
      { createdAt: "asc" as const },
      { skillId: "asc" as const }
    ]
  }
};

@Injectable()
export class ManageAdminRolesService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseCreateInput(body: unknown): AdminRoleUpsertInput {
    try {
      return parseAdminRoleCreateInput(body);
    } catch (error) {
      throw this.validationError(
        "admin_role_invalid_body",
        error instanceof Error ? error.message : "Invalid Role create request."
      );
    }
  }

  parseUpdateInput(body: unknown): AdminRoleUpsertInput {
    try {
      return parseAdminRoleUpdateInput(body);
    } catch (error) {
      throw this.validationError(
        "admin_role_invalid_body",
        error instanceof Error ? error.message : "Invalid Role update request."
      );
    }
  }

  parseSkillsReplaceInput(body: unknown): AdminRoleSkillsReplaceInput {
    try {
      return parseAdminRoleSkillsReplaceInput(body);
    } catch (error) {
      throw this.validationError(
        "admin_role_invalid_skills",
        error instanceof Error ? error.message : "Invalid Role skills replace request."
      );
    }
  }

  parsePreviewInput(body: unknown): AdminRolePreviewInput {
    try {
      return parseAdminRolePreviewInput(body);
    } catch (error) {
      throw this.validationError(
        "admin_role_invalid_preview",
        error instanceof Error ? error.message : "Invalid Role preview request."
      );
    }
  }

  async list(userId: string): Promise<AdminRoleState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.assistantRole.findMany({
      include: ROLE_INCLUDE,
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map((row) => toAdminRoleState(row, DEFAULT_ASSISTANT_ROLE_KEY));
  }

  async get(userId: string, roleId: string): Promise<AdminRoleState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.requireRoleState(roleId);
  }

  async create(userId: string, input: AdminRoleUpsertInput): Promise<AdminRoleState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    if (input.key === null) {
      throw this.validationError("admin_role_invalid_key", "key is required on create.");
    }
    const status = input.status ?? "draft";
    try {
      const created = await this.prisma.assistantRole.create({
        data: {
          key: input.key,
          name: input.name as Prisma.InputJsonValue,
          description: input.description as Prisma.InputJsonValue,
          mission: input.mission as Prisma.InputJsonValue,
          category: input.category,
          iconEmoji: input.iconEmoji,
          color: input.color,
          displayOrder: input.displayOrder ?? 100,
          status
        },
        include: ROLE_INCLUDE
      });
      return toAdminRoleState(created, DEFAULT_ASSISTANT_ROLE_KEY);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw this.conflictError(
          "admin_role_key_conflict",
          `Role key "${input.key}" already exists.`
        );
      }
      throw error;
    }
  }

  async update(
    userId: string,
    roleId: string,
    input: AdminRoleUpsertInput
  ): Promise<AdminRoleState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    for (let attempt = 1; attempt <= MAX_ROLE_ACTIVATION_ATTEMPTS; attempt += 1) {
      try {
        const updated = await this.prisma.$transaction(async (tx) => {
          const snapshot = await tx.assistantRole.findUnique({
            where: { id: roleId },
            include: { skillLinks: { select: { skillId: true }, orderBy: { skillId: "asc" } } }
          });
          if (snapshot === null) {
            throw new NotFoundException("Role not found.");
          }
          const snapshotNextStatus = input.status ?? snapshot.status;
          const advisoryActivating =
            snapshot.status !== "active" && snapshotNextStatus === "active";
          const snapshotSkillIds = snapshot.skillLinks.map((link) => link.skillId);
          if (advisoryActivating && snapshotSkillIds.length > 0) {
            await lockSkillRows(tx, snapshotSkillIds);
          }
          const lockedRoles = await lockAssistantRoleRows(tx, [roleId]);
          if (lockedRoles.length !== 1) {
            throw new NotFoundException("Role not found.");
          }
          const locked = await tx.assistantRole.findUnique({
            where: { id: roleId },
            include: { skillLinks: { select: { skillId: true }, orderBy: { skillId: "asc" } } }
          });
          if (locked === null) {
            throw new NotFoundException("Role not found.");
          }
          const nextStatus = input.status ?? locked.status;
          const activating = locked.status !== "active" && nextStatus === "active";
          const lockedSkillIds = locked.skillLinks.map((link) => link.skillId);
          if (
            activating &&
            (!advisoryActivating ||
              lockedSkillIds.length !== snapshotSkillIds.length ||
              lockedSkillIds.some(
                (skillId, index) =>
                  skillId !== snapshotSkillIds[index] || !snapshotSkillIds.includes(skillId)
              ))
          ) {
            throw new RoleActivationRetryError();
          }
          const isDefault =
            locked.id === DEFAULT_ASSISTANT_ROLE_ID || locked.key === DEFAULT_ASSISTANT_ROLE_KEY;
          if (isDefault && nextStatus !== "active") {
            throw this.conflictError(
              "admin_role_default_immutable",
              "Default Role status is immutable and must remain active."
            );
          }
          if (!isDefault && nextStatus !== "active" && locked.status === "active") {
            await this.assertRoleNotInUse(tx, locked.id);
          }
          if (activating) {
            await this.assertSkillsActive(tx, lockedSkillIds);
          }
          const assistantIds = await this.lockRoleAssistants(tx, locked.id);
          const row = await tx.assistantRole.update({
            where: { id: locked.id },
            data: {
              name: input.name as Prisma.InputJsonValue,
              description: input.description as Prisma.InputJsonValue,
              mission: input.mission as Prisma.InputJsonValue,
              category: input.category,
              iconEmoji: input.iconEmoji,
              color: input.color,
              displayOrder: input.displayOrder ?? locked.displayOrder,
              status: nextStatus
            },
            include: ROLE_INCLUDE
          });
          await this.markRoleAssistantsDirty(tx, locked.id, {
            clearChatSkillState: false,
            assistantIds
          });
          return row;
        });
        return toAdminRoleState(updated, DEFAULT_ASSISTANT_ROLE_KEY);
      } catch (error) {
        if (error instanceof RoleActivationRetryError && attempt < MAX_ROLE_ACTIVATION_ATTEMPTS) {
          continue;
        }
        if (error instanceof RoleActivationRetryError) {
          throw this.conflictError(
            "admin_role_activation_retry_exhausted",
            "Role activation could not acquire a stable Skill-link snapshot."
          );
        }
        throw error;
      }
    }
    throw this.conflictError(
      "admin_role_activation_retry_exhausted",
      "Role activation could not acquire a stable Skill-link snapshot."
    );
  }

  async archive(userId: string, roleId: string): Promise<void> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    await this.prisma.$transaction(async (tx) => {
      const lockedRoles = await lockAssistantRoleRows(tx, [roleId]);
      if (lockedRoles.length !== 1) {
        throw new NotFoundException("Role not found.");
      }
      const existing = await tx.assistantRole.findUnique({ where: { id: roleId } });
      if (existing === null) {
        throw new NotFoundException("Role not found.");
      }
      if (
        existing.id === DEFAULT_ASSISTANT_ROLE_ID ||
        existing.key === DEFAULT_ASSISTANT_ROLE_KEY
      ) {
        throw this.conflictError(
          "admin_role_default_immutable",
          "Default Role cannot be archived."
        );
      }
      await this.assertRoleNotInUse(tx, existing.id);
      if (existing.status === "archived") {
        return;
      }
      await tx.assistantRole.update({
        where: { id: existing.id },
        data: { status: "archived" }
      });
      await this.markRoleAssistantsDirty(tx, existing.id, { clearChatSkillState: false });
    });
  }

  async replaceSkills(
    userId: string,
    roleId: string,
    input: AdminRoleSkillsReplaceInput
  ): Promise<AdminRoleState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);

    for (let attempt = 1; attempt <= MAX_SKILL_REPLACE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const currentLinks = await tx.assistantRoleSkill.findMany({
            where: { roleId },
            select: { skillId: true },
            orderBy: { skillId: "asc" }
          });
          const currentSkillIds = currentLinks.map((link) => link.skillId);
          const requestedSkillIds = input.skillIds;
          const unionSkillIds = [...new Set([...currentSkillIds, ...requestedSkillIds])].sort();

          if (unionSkillIds.length > 0) {
            await lockSkillRows(tx, unionSkillIds);
          }

          const lockedRoles = await lockAssistantRoleRows(tx, [roleId]);
          if (lockedRoles.length !== 1) {
            throw new NotFoundException("Role not found.");
          }
          const role = await tx.assistantRole.findUnique({ where: { id: roleId } });
          if (role === null) {
            throw new NotFoundException("Role not found.");
          }
          const isDefault =
            role.id === DEFAULT_ASSISTANT_ROLE_ID || role.key === DEFAULT_ASSISTANT_ROLE_KEY;
          if (isDefault && requestedSkillIds.length > 0) {
            throw this.conflictError(
              "admin_role_default_immutable",
              "Default Role Skill set is immutable and must remain empty."
            );
          }

          const assistants = await tx.assistant.findMany({
            where: { roleId },
            select: { id: true },
            orderBy: { id: "asc" }
          });
          const assistantIds = assistants.map((assistant) => assistant.id);
          await lockAssistantRows(tx, assistantIds);
          await lockAssistantChatRows(tx, assistantIds);
          await lockRoleSkillRowsForRole(tx, roleId);

          const lockedCurrentLinks = await tx.assistantRoleSkill.findMany({
            where: { roleId },
            select: { skillId: true },
            orderBy: { skillId: "asc" }
          });
          const lockedCurrentSkillIds = lockedCurrentLinks.map((link) => link.skillId);
          const currentNotCovered = lockedCurrentSkillIds.some(
            (skillId) => !unionSkillIds.includes(skillId)
          );
          const snapshotDrift =
            lockedCurrentSkillIds.length !== currentSkillIds.length ||
            lockedCurrentSkillIds.some((skillId, index) => skillId !== currentSkillIds[index]);
          if (currentNotCovered || snapshotDrift) {
            throw new SkillReplaceRetryError();
          }

          if (isDefault && lockedCurrentSkillIds.length === 0) {
            const emptyDefault = await tx.assistantRole.findUnique({
              where: { id: roleId },
              include: ROLE_INCLUDE
            });
            if (emptyDefault === null) {
              throw new NotFoundException("Role not found.");
            }
            return toAdminRoleState(emptyDefault, DEFAULT_ASSISTANT_ROLE_KEY);
          }

          await this.assertSkillsActive(tx, requestedSkillIds);

          await tx.assistantRoleSkill.deleteMany({ where: { roleId } });
          if (requestedSkillIds.length > 0) {
            await tx.assistantRoleSkill.createMany({
              data: requestedSkillIds.map((skillId, index) => ({
                roleId,
                skillId,
                displayOrder: index
              }))
            });
          }

          await this.markRoleAssistantsDirty(tx, roleId, {
            clearChatSkillState: true,
            assistantIds
          });

          const updated = await tx.assistantRole.findUnique({
            where: { id: roleId },
            include: ROLE_INCLUDE
          });
          if (updated === null) {
            throw new NotFoundException("Role not found.");
          }
          return toAdminRoleState(updated, DEFAULT_ASSISTANT_ROLE_KEY);
        });
      } catch (error) {
        if (error instanceof SkillReplaceRetryError && attempt < MAX_SKILL_REPLACE_ATTEMPTS) {
          continue;
        }
        if (error instanceof SkillReplaceRetryError) {
          throw this.conflictError(
            "admin_role_skills_replace_retry_exhausted",
            "Role Skill replacement could not acquire a stable lock snapshot."
          );
        }
        throw error;
      }
    }

    throw this.conflictError(
      "admin_role_skills_replace_retry_exhausted",
      "Role Skill replacement could not acquire a stable lock snapshot."
    );
  }

  async preview(userId: string, input: AdminRolePreviewInput): Promise<AdminRolePreviewState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const missionText = localizeAssistantRoleText(input.mission, input.locale);
    const missionBlock = renderAssistantRoleMissionBlock(missionText);
    let effectiveSkills;
    try {
      effectiveSkills = await resolveAssistantRoleEffectiveSkillsPrompt({
        prisma: this.prisma,
        orderedSkillIds: input.skillIds,
        locale: input.locale
      });
    } catch (error) {
      throw this.validationError(
        "admin_role_skill_not_active",
        error instanceof Error ? error.message : "Role preview Skills must be active."
      );
    }

    return {
      locale: input.locale,
      missionBlock,
      enabledSkillsBlock: effectiveSkills.enabledSkillsBlock,
      skillIds: input.skillIds
    };
  }

  private async requireRoleState(roleId: string): Promise<AdminRoleState> {
    const role = await this.prisma.assistantRole.findFirst({
      where: { id: roleId },
      include: ROLE_INCLUDE
    });
    if (role === null) {
      throw new NotFoundException("Role not found.");
    }
    return toAdminRoleState(role, DEFAULT_ASSISTANT_ROLE_KEY);
  }

  private async assertRoleNotInUse(tx: Prisma.TransactionClient, roleId: string): Promise<void> {
    const assistants = await tx.assistant.findMany({
      where: { roleId },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const assistantIds = assistants.map((assistant) => assistant.id);
    await lockAssistantRows(tx, assistantIds);
    const stillLinked =
      assistantIds.length === 0
        ? []
        : await tx.assistant.findMany({
            where: { id: { in: assistantIds }, roleId },
            select: { id: true },
            orderBy: { id: "asc" }
          });
    if (stillLinked.length > 0) {
      throw this.conflictError(
        "admin_role_in_use",
        "Role cannot leave active status while any Assistant uses it."
      );
    }
  }

  private async lockRoleAssistants(
    tx: Prisma.TransactionClient,
    roleId: string
  ): Promise<string[]> {
    const assistants = await tx.assistant.findMany({
      where: { roleId },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const assistantIds = assistants.map((assistant) => assistant.id);
    await lockAssistantRows(tx, assistantIds);
    return assistantIds;
  }

  private async assertSkillsActive(
    client: Prisma.TransactionClient | WorkspaceManagementPrismaService,
    skillIds: string[]
  ): Promise<void> {
    if (skillIds.length === 0) {
      return;
    }
    const skills = await client.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true, status: true, archivedAt: true }
    });
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    for (const skillId of skillIds) {
      const skill = byId.get(skillId);
      if (skill === undefined) {
        throw this.validationError("admin_role_skill_not_found", `Skill ${skillId} was not found.`);
      }
      if (skill.status !== "active" || skill.archivedAt !== null) {
        throw this.validationError(
          "admin_role_skill_not_active",
          `Skill ${skillId} must be active to link to a Role.`
        );
      }
    }
  }

  private async markRoleAssistantsDirty(
    tx: Prisma.TransactionClient,
    roleId: string,
    options: { clearChatSkillState: boolean; assistantIds?: string[] }
  ): Promise<void> {
    const assistantIds =
      options.assistantIds ??
      (
        await tx.assistant.findMany({
          where: { roleId },
          select: { id: true },
          orderBy: { id: "asc" }
        })
      ).map((assistant) => assistant.id);
    if (assistantIds.length === 0) {
      return;
    }
    const clockRows = await tx.$queryRaw<Array<{ dirtyAt: Date }>>(Prisma.sql`
      SELECT clock_timestamp() AS "dirtyAt"
    `);
    const dirtyAt = clockRows[0]?.dirtyAt;
    if (dirtyAt === undefined) {
      throw new Error("Database clock did not return a Role invalidation timestamp.");
    }
    await tx.assistant.updateMany({
      where: { id: { in: assistantIds } },
      data: { configDirtyAt: dirtyAt }
    });
    if (options.clearChatSkillState) {
      await tx.assistantChat.updateMany({
        where: { assistantId: { in: assistantIds } },
        data: {
          skillDecisionState: Prisma.DbNull,
          skillRetrievalState: Prisma.DbNull
        }
      });
    }
  }

  private validationError(code: string, message: string): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
      code,
      category: "validation",
      message
    });
  }

  private conflictError(code: string, message: string): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.CONFLICT, {
      code,
      category: "conflict",
      message
    });
  }
}

class SkillReplaceRetryError extends Error {
  constructor() {
    super("Role Skill replacement snapshot drifted; retry required.");
    this.name = "SkillReplaceRetryError";
  }
}

class RoleActivationRetryError extends Error {
  constructor() {
    super("Role activation Skill-link snapshot drifted; retry required.");
    this.name = "RoleActivationRetryError";
  }
}
