import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";

@Injectable()
export class ForgetAssistantMemoryItemService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  async execute(userId: string, itemId: string): Promise<{ forgotten: true }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const ok = await this.memoryRegistryRepository.markForgottenById(itemId, assistant.id);
    if (!ok) {
      throw new NotFoundException("Memory item was not found or already removed from your list.");
    }

    return { forgotten: true };
  }
}
