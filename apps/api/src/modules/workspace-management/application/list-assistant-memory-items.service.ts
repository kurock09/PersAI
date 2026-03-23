import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantMemoryRegistryItemState } from "./assistant-memory.types";

const LIST_LIMIT = 80;

@Injectable()
export class ListAssistantMemoryItemsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  async execute(userId: string): Promise<AssistantMemoryRegistryItemState[]> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const items = await this.memoryRegistryRepository.listActiveByAssistantId(assistant.id, LIST_LIMIT);

    return items.map((item) => ({
      id: item.id,
      summary: item.summary,
      sourceType: item.sourceType,
      sourceLabel: item.sourceLabel,
      createdAt: item.createdAt.toISOString(),
      chatId: item.chatId
    }));
  }
}
