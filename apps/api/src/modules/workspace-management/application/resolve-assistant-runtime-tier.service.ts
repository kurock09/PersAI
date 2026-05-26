import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { Assistant } from "../domain/assistant.entity";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  type RuntimeTier
} from "./runtime-assignment";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

@Injectable()
export class ResolveAssistantRuntimeTierService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async resolveByAssistantId(assistantId: string): Promise<RuntimeTier> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return this.resolveEffectiveTier(assistant);
  }

  async resolveByUserId(
    userId: string
  ): Promise<{ assistantId: string; runtimeTier: RuntimeTier }> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;
    return {
      assistantId: assistant.id,
      runtimeTier: await this.resolveEffectiveTier(assistant)
    };
  }

  private async resolveEffectiveTier(assistant: Assistant): Promise<RuntimeTier> {
    const materializedSpec =
      await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(
      materializedSpec?.layers ?? null
    );
    return runtimeAssignment?.effectiveTier ?? "free_shared_restricted";
  }
}
