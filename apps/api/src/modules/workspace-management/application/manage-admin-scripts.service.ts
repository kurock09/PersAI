import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  lockAssistantChatRows,
  lockAssistantRoleRows,
  lockAssistantRows,
  lockSkillRows
} from "./assistant-skill-mutation-locks";
import {
  computeScriptContentHash,
  parseExpectedRevision,
  parseOrderedScriptIds,
  parseScriptCreateInput,
  parseScriptUpdateInput,
  parseScriptVersionCreateInput,
  parseScriptVersionUpdateInput,
  toScriptState,
  toScriptVersionState,
  toSkillScriptLinkState,
  validateExecutableContract,
  type ScriptCoreInput,
  type ScriptCreateInput,
  type ScriptState,
  type ScriptVersionState,
  type ScriptVersionUpdateInput,
  type ScriptVersionWriteInput,
  type SkillScriptLinkState
} from "./script-management.types";

@Injectable()
export class ManageAdminScriptsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseCreateInput(body: unknown): ScriptCreateInput {
    return this.parse(() => parseScriptCreateInput(body), "admin_script_invalid_body");
  }
  parseUpdateInput(body: unknown): ScriptCoreInput {
    return this.parse(() => parseScriptUpdateInput(body), "admin_script_invalid_body");
  }
  parseVersionCreateInput(body: unknown): ScriptVersionWriteInput {
    return this.parse(
      () => parseScriptVersionCreateInput(body),
      "admin_script_version_invalid_body"
    );
  }
  parseVersionUpdateInput(body: unknown): ScriptVersionUpdateInput {
    return this.parse(
      () => parseScriptVersionUpdateInput(body),
      "admin_script_version_invalid_body"
    );
  }
  parsePublishInput(body: unknown): number {
    return this.parse(() => parseExpectedRevision(body), "admin_script_version_invalid_body");
  }
  parseScriptsReplaceInput(body: unknown): string[] {
    return this.parse(() => parseOrderedScriptIds(body), "admin_skill_scripts_invalid_body");
  }

  async list(userId: string): Promise<ScriptState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.script.findMany({
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map(toScriptState);
  }

  async get(userId: string, scriptId: string): Promise<ScriptState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return toScriptState(await this.requireScript(scriptId));
  }

  async listSkillScripts(userId: string, skillId: string): Promise<SkillScriptLinkState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      select: { id: true }
    });
    if (skill === null) throw new NotFoundException("Skill not found.");
    const links = await this.prisma.skillScript.findMany({
      where: { skillId },
      include: { script: true },
      orderBy: [{ displayOrder: "asc" }, { scriptId: "asc" }]
    });
    return links.map(toSkillScriptLinkState);
  }

  async create(userId: string, input: ScriptCreateInput): Promise<ScriptState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    try {
      return toScriptState(
        await this.prisma.script.create({
          data: {
            key: input.key,
            name: input.name,
            description: input.description,
            category: input.category,
            icon: input.icon,
            color: input.color,
            displayOrder: input.displayOrder,
            createdByUserId: userId,
            updatedByUserId: userId
          }
        })
      );
    } catch (error) {
      if (this.isUnique(error)) {
        throw this.conflict(
          "admin_script_key_conflict",
          `Script key "${input.key}" already exists.`
        );
      }
      throw error;
    }
  }

  async update(userId: string, scriptId: string, input: ScriptCoreInput): Promise<ScriptState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    return toScriptState(
      await this.prisma.$transaction(async (tx) => {
        await this.lockScripts(tx, [scriptId]);
        const existing = await tx.script.findUnique({ where: { id: scriptId } });
        if (existing === null) throw new NotFoundException("Script not found.");
        if (existing.status === "archived") {
          throw this.conflict(
            "admin_script_archived",
            "Archived Script metadata cannot be updated."
          );
        }
        return tx.script.update({
          where: { id: scriptId },
          data: {
            ...input,
            name: input.name,
            description: input.description,
            updatedByUserId: userId
          }
        });
      })
    );
  }

  async archive(userId: string, scriptId: string): Promise<ScriptState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    return toScriptState(
      await this.prisma.$transaction(async (tx) => {
        const skillIds = await this.findLiveLinkedSkillIds(tx, scriptId);
        await lockSkillRows(tx, skillIds);
        await this.lockScripts(tx, [scriptId]);
        const script = await tx.script.findUnique({ where: { id: scriptId } });
        if (script === null) throw new NotFoundException("Script not found.");
        const liveLinks = await this.findLiveLinkedSkillIds(tx, scriptId);
        if (liveLinks.length > 0 || (await this.hasLiveScenarioReference(tx, script.key))) {
          throw this.conflict(
            "admin_script_in_use",
            "Script cannot be archived while a live Skill or Scenario references it."
          );
        }
        if (script.status === "archived") return script;
        return tx.script.update({
          where: { id: scriptId },
          data: { status: "archived", updatedByUserId: userId }
        });
      })
    );
  }

  async listVersions(userId: string, scriptId: string): Promise<ScriptVersionState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    await this.requireScript(scriptId);
    const rows = await this.prisma.scriptVersion.findMany({
      where: { scriptId },
      orderBy: [{ version: "desc" }]
    });
    return rows.map(toScriptVersionState);
  }

  async createVersion(
    userId: string,
    scriptId: string,
    input: ScriptVersionWriteInput
  ): Promise<ScriptVersionState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    validateExecutableContract(input);
    try {
      return toScriptVersionState(
        await this.prisma.$transaction(async (tx) => {
          await this.lockScripts(tx, [scriptId]);
          const script = await tx.script.findUnique({ where: { id: scriptId } });
          if (script === null) throw new NotFoundException("Script not found.");
          if (script.status === "archived") {
            throw this.conflict("admin_script_archived", "Archived Script cannot receive a draft.");
          }
          const latest = await tx.scriptVersion.findFirst({
            where: { scriptId },
            orderBy: { version: "desc" },
            select: { version: true }
          });
          return tx.scriptVersion.create({
            data: {
              scriptId,
              version: (latest?.version ?? 0) + 1,
              ...this.versionData(input),
              createdByUserId: userId
            }
          });
        })
      );
    } catch (error) {
      if (this.isUnique(error)) {
        throw this.conflict(
          "admin_script_draft_exists",
          "Script already has a draft version; update or publish it first."
        );
      }
      throw error;
    }
  }

  async updateVersion(
    userId: string,
    scriptId: string,
    versionId: string,
    input: ScriptVersionUpdateInput
  ): Promise<ScriptVersionState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    validateExecutableContract(input);
    return toScriptVersionState(
      await this.prisma.$transaction(async (tx) => {
        await this.lockScripts(tx, [scriptId]);
        await this.lockVersion(tx, versionId);
        const version = await tx.scriptVersion.findFirst({ where: { id: versionId, scriptId } });
        if (version === null) throw new NotFoundException("Script version not found.");
        if (version.status !== "draft") {
          throw this.conflict(
            "admin_script_version_immutable",
            "Published Script versions are immutable."
          );
        }
        const updated = await tx.scriptVersion.updateMany({
          where: { id: versionId, scriptId, status: "draft", revision: input.expectedRevision },
          data: { ...this.versionData(input), revision: { increment: 1 } }
        });
        if (updated.count !== 1) {
          throw this.conflict(
            "admin_script_version_revision_conflict",
            "Script version revision no longer matches."
          );
        }
        const row = await tx.scriptVersion.findUnique({ where: { id: versionId } });
        if (row === null) throw new NotFoundException("Script version not found.");
        return row;
      })
    );
  }

  async validateVersion(
    userId: string,
    scriptId: string,
    versionId: string
  ): Promise<ScriptVersionState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const row = await this.prisma.scriptVersion.findFirst({ where: { id: versionId, scriptId } });
    if (row === null) throw new NotFoundException("Script version not found.");
    validateExecutableContract(this.versionInput(row));
    return toScriptVersionState(row);
  }

  async publishVersion(
    userId: string,
    scriptId: string,
    versionId: string,
    expectedRevision: number
  ): Promise<{ script: ScriptState; version: ScriptVersionState }> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    return this.prisma.$transaction(async (tx) => {
      const candidateSkillIds = await this.findLiveLinkedSkillIds(tx, scriptId);
      await lockSkillRows(tx, candidateSkillIds);
      await this.lockScripts(tx, [scriptId]);
      await this.lockVersion(tx, versionId);
      const script = await tx.script.findUnique({ where: { id: scriptId } });
      const version = await tx.scriptVersion.findFirst({ where: { id: versionId, scriptId } });
      if (script === null) throw new NotFoundException("Script not found.");
      if (version === null) throw new NotFoundException("Script version not found.");
      if (script.status === "archived") {
        throw this.conflict("admin_script_archived", "Archived Script cannot be published.");
      }
      if (version.status !== "draft") {
        throw this.conflict(
          "admin_script_version_immutable",
          "Script version is already published."
        );
      }
      if (version.revision !== expectedRevision) {
        throw this.conflict(
          "admin_script_version_revision_conflict",
          "Script version revision no longer matches."
        );
      }
      const executable = this.versionInput(version);
      validateExecutableContract(executable);
      const hash = computeScriptContentHash(executable);
      const clock = await this.databaseClock(tx);
      const published = await tx.scriptVersion.update({
        where: { id: versionId },
        data: {
          status: "published",
          contentHash: hash,
          publishedByUserId: userId,
          publishedAt: clock,
          revision: { increment: 1 }
        }
      });
      const updatedScript = await tx.script.update({
        where: { id: scriptId },
        data: {
          status: "published",
          currentPublishedVersionId: versionId,
          updatedByUserId: userId
        }
      });
      await this.invalidateLinkedAssistants(tx, scriptId, candidateSkillIds, clock);
      return { script: toScriptState(updatedScript), version: toScriptVersionState(published) };
    });
  }

  async replaceSkillScripts(
    userId: string,
    skillId: string,
    scriptIds: string[]
  ): Promise<SkillScriptLinkState[]> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    return this.prisma.$transaction(async (tx) => {
      await lockSkillRows(tx, [skillId]);
      const skill = await tx.skill.findUnique({ where: { id: skillId } });
      if (skill === null) throw new NotFoundException("Skill not found.");
      const current = await tx.skillScript.findMany({
        where: { skillId },
        select: { scriptId: true, script: { select: { key: true } } }
      });
      await this.lockScripts(tx, [...scriptIds, ...current.map((row) => row.scriptId)]);
      const requested = new Set(scriptIds);
      const removedScriptKeys = current
        .filter((row) => !requested.has(row.scriptId))
        .map((row) => row.script.key);
      if (
        skill.status !== "archived" &&
        skill.archivedAt === null &&
        removedScriptKeys.length > 0 &&
        (await this.hasLiveScenarioReferenceForSkill(tx, skillId, removedScriptKeys))
      ) {
        throw this.conflict(
          "admin_skill_script_scenario_reference",
          "Script links cannot be removed while a non-archived Scenario of this Skill references them."
        );
      }
      const scripts = await tx.script.findMany({
        where: { id: { in: scriptIds } },
        select: { id: true, status: true, currentPublishedVersionId: true }
      });
      const byId = new Map(scripts.map((script) => [script.id, script]));
      for (const scriptId of scriptIds) {
        const script = byId.get(scriptId);
        if (script === undefined) {
          throw this.validation(
            "admin_skill_script_not_found",
            `Script ${scriptId} was not found.`
          );
        }
        if (script.status !== "published" || script.currentPublishedVersionId === null) {
          throw this.validation(
            "admin_skill_script_not_published",
            `Script ${scriptId} must be current-published and non-archived.`
          );
        }
      }
      const assistantIds = await this.lockAssistantsForSkill(tx, skillId);
      await tx.$queryRaw(Prisma.sql`
        SELECT "skill_id", "script_id" FROM "skill_scripts"
        WHERE "skill_id" = ${skillId}::uuid ORDER BY "script_id" FOR UPDATE
      `);
      await tx.skillScript.deleteMany({ where: { skillId } });
      if (scriptIds.length > 0) {
        await tx.skillScript.createMany({
          data: scriptIds.map((scriptId, displayOrder) => ({ skillId, scriptId, displayOrder }))
        });
      }
      await this.invalidateAssistants(tx, assistantIds, await this.databaseClock(tx));
      const links = await tx.skillScript.findMany({
        where: { skillId },
        include: { script: true },
        orderBy: [{ displayOrder: "asc" }, { scriptId: "asc" }]
      });
      return links.map(toSkillScriptLinkState);
    });
  }

  private async requireScript(scriptId: string) {
    const row = await this.prisma.script.findUnique({ where: { id: scriptId } });
    if (row === null) throw new NotFoundException("Script not found.");
    return row;
  }

  private versionData(input: ScriptVersionWriteInput): {
    code: string;
    manifest: Prisma.InputJsonValue;
    inputSchema: Prisma.InputJsonValue;
    outputSchema: Prisma.InputJsonValue;
    runtime: string;
    entryCommand: string;
    limits: Prisma.InputJsonValue;
  } {
    return {
      code: input.code,
      manifest: input.manifest as unknown as Prisma.InputJsonValue,
      inputSchema: input.inputSchema as Prisma.InputJsonValue,
      outputSchema: input.outputSchema as Prisma.InputJsonValue,
      runtime: input.runtime,
      entryCommand: input.entryCommand,
      limits: input.limits as Prisma.InputJsonValue
    };
  }

  private versionInput(row: {
    code: string;
    manifest: unknown;
    inputSchema: unknown;
    outputSchema: unknown;
    runtime: string;
    entryCommand: string;
    limits: unknown;
  }): ScriptVersionWriteInput {
    return {
      code: row.code,
      manifest: row.manifest as ScriptVersionWriteInput["manifest"],
      inputSchema: row.inputSchema as Record<string, unknown>,
      outputSchema: row.outputSchema as Record<string, unknown>,
      runtime: row.runtime,
      entryCommand: row.entryCommand,
      limits: row.limits as ScriptVersionWriteInput["limits"]
    };
  }

  private async lockScripts(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    const sorted = [...new Set(ids)].sort();
    if (sorted.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "scripts"
      WHERE "id" IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id" FOR UPDATE
    `);
  }

  private async lockVersion(tx: Prisma.TransactionClient, versionId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "script_versions" WHERE "id" = ${versionId}::uuid FOR UPDATE
    `);
  }

  private async findLiveLinkedSkillIds(
    tx: Prisma.TransactionClient,
    scriptId: string
  ): Promise<string[]> {
    const links = await tx.skillScript.findMany({
      where: { scriptId, skill: { status: { not: "archived" }, archivedAt: null } },
      select: { skillId: true },
      orderBy: { skillId: "asc" }
    });
    return links.map((link) => link.skillId);
  }

  private async hasLiveScenarioReference(
    tx: Prisma.TransactionClient,
    scriptKey: string
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "skill_scenarios" scenario
        JOIN "skills" skill ON skill."id" = scenario."skill_id"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(scenario."steps") = 'array' THEN scenario."steps"
            ELSE '[]'::jsonb
          END
        ) AS step(value)
        WHERE scenario."status" <> 'archived'
          AND skill."status" <> 'archived'
          AND skill."archived_at" IS NULL
          AND step.value -> 'scriptRef' ->> 'scriptKey' = ${scriptKey}
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  private async hasLiveScenarioReferenceForSkill(
    tx: Prisma.TransactionClient,
    skillId: string,
    scriptKeys: string[]
  ): Promise<boolean> {
    if (scriptKeys.length === 0) return false;
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "skill_scenarios" scenario
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(scenario."steps") = 'array' THEN scenario."steps"
            ELSE '[]'::jsonb
          END
        ) AS step(value)
        WHERE scenario."skill_id" = ${skillId}::uuid
          AND scenario."status" <> 'archived'
          AND step.value -> 'scriptRef' ->> 'scriptKey' IN (
            ${Prisma.join(scriptKeys.map((key) => Prisma.sql`${key}`))}
          )
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  private async invalidateLinkedAssistants(
    tx: Prisma.TransactionClient,
    scriptId: string,
    candidateSkillIds: string[],
    clock: Date
  ): Promise<void> {
    const liveSkillIds = await this.findLiveLinkedSkillIds(tx, scriptId);
    if (
      liveSkillIds.length !== candidateSkillIds.length ||
      liveSkillIds.some((id, index) => id !== candidateSkillIds[index])
    ) {
      throw this.conflict(
        "admin_script_publish_link_conflict",
        "Script Skill links changed during publication."
      );
    }
    const assistantIds = await this.lockAssistantsForSkills(tx, liveSkillIds);
    await this.invalidateAssistants(tx, assistantIds, clock);
  }

  private async lockAssistantsForSkill(
    tx: Prisma.TransactionClient,
    skillId: string
  ): Promise<string[]> {
    return this.lockAssistantsForSkills(tx, [skillId]);
  }

  private async lockAssistantsForSkills(
    tx: Prisma.TransactionClient,
    skillIds: string[]
  ): Promise<string[]> {
    if (skillIds.length === 0) return [];
    const roles = await tx.assistantRole.findMany({
      where: { status: "active", skillLinks: { some: { skillId: { in: skillIds } } } },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const roleIds = roles.map((role) => role.id);
    await lockAssistantRoleRows(tx, roleIds);
    const assistants = await tx.assistant.findMany({
      where: { roleId: { in: roleIds } },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const assistantIds = assistants.map((assistant) => assistant.id);
    await lockAssistantRows(tx, assistantIds);
    await lockAssistantChatRows(tx, assistantIds);
    return assistantIds;
  }

  private async invalidateAssistants(
    tx: Prisma.TransactionClient,
    assistantIds: string[],
    clock: Date
  ): Promise<void> {
    if (assistantIds.length === 0) return;
    await tx.assistant.updateMany({
      where: { id: { in: assistantIds } },
      data: { configDirtyAt: clock }
    });
  }

  private async databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
      SELECT clock_timestamp() AS "now"
    `);
    if (rows[0]?.now === undefined) throw new Error("Database clock did not return a timestamp.");
    return rows[0].now;
  }

  private parse<T>(fn: () => T, code: string): T {
    try {
      return fn();
    } catch (error) {
      throw this.validation(code, error instanceof Error ? error.message : "Invalid request.");
    }
  }

  private validation(code: string, message: string): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
      code,
      category: "validation",
      message
    });
  }

  private conflict(code: string, message: string): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.CONFLICT, {
      code,
      category: "conflict",
      message
    });
  }

  private isUnique(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
