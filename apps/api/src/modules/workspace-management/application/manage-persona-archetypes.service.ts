import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PERSONA_ARCHETYPE_DEFAULTS } from "../../../../prisma/persona-archetype-data";
import {
  PERSONA_ARCHETYPE_REPOSITORY,
  type PersonaArchetypeRepository
} from "../domain/persona-archetype.repository";
import type {
  PersonaArchetype,
  PersonaArchetypePatchInput
} from "../domain/persona-archetype.entity";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";

/**
 * ADR-074 V1 — admin/runtime gateway for `persona_archetypes`.
 *
 * - `ensureDefaults` lazy-seeds missing rows (mirrors the prompt_template
 *   pattern — fresh prod databases pick up archetypes on first read instead
 *   of relying on `prisma db seed` ever running in production).
 * - `listForRuntime` is the public-read entrypoint used by the assistant
 *   wizard / settings page; it never asserts admin scope.
 * - `listForAdmin`, `patch`, `resetToDefault` are admin-scoped editors that
 *   bump the global config generation so every assistant rematerializes on
 *   the next reapply (same propagation mechanic as prompt_template edits).
 */
@Injectable()
export class ManagePersonaArchetypesService {
  private readonly logger = new Logger(ManagePersonaArchetypesService.name);
  private defaultsEnsured = false;

  constructor(
    @Inject(PERSONA_ARCHETYPE_REPOSITORY)
    private readonly personaArchetypeRepository: PersonaArchetypeRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly materializationRolloutService: MaterializationRolloutService
  ) {}

  async ensureDefaults(): Promise<void> {
    if (this.defaultsEnsured) return;
    const existing = await this.personaArchetypeRepository.findAll();
    const existingKeys = new Set(existing.map((archetype) => archetype.key));
    const missing = PERSONA_ARCHETYPE_DEFAULTS.filter(
      (archetype) => !existingKeys.has(archetype.key)
    );

    if (missing.length === 0) {
      this.defaultsEnsured = true;
      return;
    }

    this.logger.log(
      `Persona archetypes missing defaults (${missing
        .map((archetype) => archetype.key)
        .join(", ")}). Seeding missing rows.`
    );
    for (const archetype of missing) {
      await this.personaArchetypeRepository.upsertIfMissing(archetype);
    }
    this.defaultsEnsured = true;
  }

  async listForRuntime(): Promise<PersonaArchetype[]> {
    await this.ensureDefaults();
    return this.personaArchetypeRepository.findAll();
  }

  async findByKey(key: string): Promise<PersonaArchetype | null> {
    await this.ensureDefaults();
    return this.personaArchetypeRepository.findByKey(key);
  }

  async listForAdmin(userId: string): Promise<PersonaArchetype[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.listForRuntime();
  }

  async patch(
    userId: string,
    key: string,
    input: PersonaArchetypePatchInput
  ): Promise<PersonaArchetype> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    await this.ensureDefaults();
    const result = await this.personaArchetypeRepository.patch(key, input);
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "system_prompt_change",
      triggerSource: "prompt_settings",
      scopeType: "affected_policy",
      criticality: "soft",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.persona_archetype.patch",
        archetypeKey: key
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a persona archetype materialization rollout."
    });
    return result;
  }

  async resetToDefault(userId: string, key: string): Promise<PersonaArchetype> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const compiledDefault = PERSONA_ARCHETYPE_DEFAULTS.find((archetype) => archetype.key === key);
    if (!compiledDefault) {
      throw new NotFoundException(
        `Persona archetype "${key}" has no compiled default to reset to.`
      );
    }
    const result = await this.personaArchetypeRepository.upsertOverwrite(compiledDefault);
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "system_prompt_change",
      triggerSource: "prompt_settings",
      scopeType: "affected_policy",
      criticality: "soft",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.persona_archetype.reset",
        archetypeKey: key
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a persona archetype materialization rollout."
    });
    return result;
  }
}
