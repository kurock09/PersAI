import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  type RuntimeTier
} from "./runtime-assignment";

@Injectable()
export class ResolveAssistantRuntimeTierService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  async resolveByAssistantId(assistantId: string): Promise<RuntimeTier> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return this.resolveEffectiveTier(assistant.id);
  }

  async resolveByUserId(
    userId: string
  ): Promise<{ assistantId: string; runtimeTier: RuntimeTier }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    return {
      assistantId: assistant.id,
      runtimeTier: await this.resolveEffectiveTier(assistant.id)
    };
  }

  private async resolveEffectiveTier(assistantId: string): Promise<RuntimeTier> {
    const materializedSpec =
      await this.assistantMaterializedSpecRepository.findLatestByAssistantId(assistantId);
    const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(
      materializedSpec?.layers ?? null
    );
    return runtimeAssignment?.effectiveTier ?? "free_shared_restricted";
  }
}
