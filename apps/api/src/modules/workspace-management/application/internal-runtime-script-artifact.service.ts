import { Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  createAssistantInboundConflict,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import type { ScriptLimits, ScriptManifest } from "./script-management.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCRIPT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const INPUT_KEYS = [
  "assistantId",
  "skillId",
  "scriptKey",
  "scriptVersionId",
  "contentHash"
] as const;

export type ScriptArtifactInput = {
  assistantId: string;
  skillId: string;
  scriptKey: string;
  scriptVersionId: string;
  contentHash: string;
};

export type ScriptArtifactResult = {
  scriptId: string;
  scriptKey: string;
  scriptVersionId: string;
  versionNumber: number;
  contentHash: string;
  runtime: string;
  entryCommand: string;
  manifest: ScriptManifest;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  limits: ScriptLimits;
};

/**
 * ADR-151 — the internal read boundary the runtime uses immediately before
 * `script.execute` to re-derive live authorization for an already-pinned
 * `scriptVersionId`. The pinned id/hash are immutable and never change once
 * published, so this call is not re-validating "what changed"; it is
 * re-validating "is this exact pin still a live capability of this
 * assistant right now" — the owning Skill may have been unlinked or the
 * Script archived since the bundle carrying this pin was materialized.
 *
 * Returns the code (never — apps/api's log line and this response both
 * exclude it) omitted; `entryCommand`/`runtime`/`manifest` ARE returned
 * because the sandbox reloads the version through its own direct Postgres
 * connection and never round-trips through the runtime process — this
 * response exists for the runtime's own dynamic tool-schema/output
 * validation and pre-execution authorization needs only. `code` itself is
 * never included in this response.
 */
@Injectable()
export class InternalRuntimeScriptArtifactService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseInput(body: unknown): ScriptArtifactInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw createAssistantInboundValidationError(
        "runtime_script_artifact_invalid_body",
        "Request body must be an object."
      );
    }
    const row = body as Record<string, unknown>;
    const unknown = Object.keys(row).filter(
      (key) => !(INPUT_KEYS as readonly string[]).includes(key)
    );
    const missing = INPUT_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(row, key));
    if (unknown.length > 0 || missing.length > 0) {
      throw createAssistantInboundValidationError(
        "runtime_script_artifact_invalid_body",
        "Request body must contain exactly assistantId, skillId, scriptKey, scriptVersionId, and contentHash."
      );
    }
    const scriptKey = this.requireBoundedPattern(
      row.scriptKey,
      "scriptKey",
      SCRIPT_KEY_PATTERN,
      64
    );
    const contentHash = this.requireBoundedPattern(
      row.contentHash,
      "contentHash",
      CONTENT_HASH_PATTERN,
      64
    );
    return {
      assistantId: this.requireUuid(row.assistantId, "assistantId"),
      skillId: this.requireUuid(row.skillId, "skillId"),
      scriptKey,
      scriptVersionId: this.requireUuid(row.scriptVersionId, "scriptVersionId"),
      contentHash
    };
  }

  async fetchArtifact(input: ScriptArtifactInput): Promise<ScriptArtifactResult> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: { roleId: true }
    });
    if (assistant === null) {
      throw new NotFoundException(`Assistant not found: ${input.assistantId}`);
    }

    const roleSkillLink = await this.prisma.assistantRoleSkill.findUnique({
      where: { roleId_skillId: { roleId: assistant.roleId, skillId: input.skillId } },
      select: { skill: { select: { status: true, archivedAt: true } } }
    });
    if (
      roleSkillLink === null ||
      roleSkillLink.skill.status !== "active" ||
      roleSkillLink.skill.archivedAt !== null
    ) {
      throw this.conflict(
        "runtime_script_skill_not_effective",
        "The referenced Skill is no longer an effective Skill for this assistant."
      );
    }

    const version = await this.prisma.scriptVersion.findUnique({
      where: { id: input.scriptVersionId },
      select: {
        id: true,
        version: true,
        status: true,
        contentHash: true,
        runtime: true,
        entryCommand: true,
        manifest: true,
        inputSchema: true,
        outputSchema: true,
        limits: true,
        script: { select: { id: true, key: true, status: true } }
      }
    });
    if (version === null) {
      throw this.conflict(
        "runtime_script_version_not_found",
        `Script version not found: ${input.scriptVersionId}`
      );
    }
    if (version.status !== "published") {
      throw this.conflict(
        "runtime_script_version_not_published",
        "The pinned Script version is not published."
      );
    }
    if (version.contentHash !== input.contentHash) {
      throw this.conflict(
        "runtime_script_content_hash_mismatch",
        "The pinned Script version content hash no longer matches."
      );
    }
    if (version.script.key !== input.scriptKey) {
      throw this.conflict(
        "runtime_script_key_mismatch",
        "The pinned Script version no longer belongs to the expected scriptKey."
      );
    }
    if (version.script.status === "archived") {
      throw this.conflict("runtime_script_archived", "The Script has been archived.");
    }
    if (version.script.status !== "published") {
      throw this.conflict("runtime_script_not_published", "The Script is not published.");
    }

    const link = await this.prisma.skillScript.findUnique({
      where: { skillId_scriptId: { skillId: input.skillId, scriptId: version.script.id } }
    });
    if (link === null) {
      throw this.conflict(
        "runtime_script_unlinked",
        "The Script is no longer linked to the referenced Skill."
      );
    }

    return {
      scriptId: version.script.id,
      scriptKey: version.script.key,
      scriptVersionId: version.id,
      versionNumber: version.version,
      contentHash: input.contentHash,
      runtime: version.runtime,
      entryCommand: version.entryCommand,
      manifest: version.manifest as ScriptManifest,
      inputSchema: version.inputSchema as Record<string, unknown>,
      outputSchema: version.outputSchema as Record<string, unknown>,
      limits: version.limits as ScriptLimits
    };
  }

  private conflict(code: string, message: string) {
    return createAssistantInboundConflict(code, message);
  }

  private requireUuid(value: unknown, field: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
      throw createAssistantInboundValidationError(
        `runtime_script_artifact_invalid_${field}`,
        `${field} must be a valid UUID.`
      );
    }
    return value.trim();
  }

  private requireBoundedPattern(
    value: unknown,
    field: string,
    pattern: RegExp,
    maxLength: number
  ): string {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.trim().length > maxLength ||
      !pattern.test(value.trim())
    ) {
      throw createAssistantInboundValidationError(
        `runtime_script_artifact_invalid_${field}`,
        `${field} has an invalid format.`
      );
    }
    return value.trim();
  }
}
