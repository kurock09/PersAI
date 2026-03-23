import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import { isGlobalMemoryReadAllowed } from "../domain/memory-source-policy";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";

@Injectable()
export class ForgetAssistantMemoryItemService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  async execute(userId: string, itemId: string): Promise<{ forgotten: true }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveMemoryControlFromGovernance(governance);
    if (!isGlobalMemoryReadAllowed(envelope)) {
      throw new ConflictException(
        "Global memory read is disabled by assistant policy. Memory Center actions are unavailable."
      );
    }

    const ok = await this.memoryRegistryRepository.markForgottenById(itemId, assistant.id);
    if (!ok) {
      throw new NotFoundException("Memory item was not found or already removed from your list.");
    }

    return { forgotten: true };
  }
}
