import { ConflictException, Inject, Injectable } from "@nestjs/common";
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
import type { AssistantMemoryRegistryItemState } from "./assistant-memory.types";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const LIST_LIMIT = 80;

@Injectable()
export class ListAssistantMemoryItemsService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  async execute(userId: string): Promise<AssistantMemoryRegistryItemState[]> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;

    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveMemoryControlFromGovernance(governance);
    if (!isGlobalMemoryReadAllowed(envelope)) {
      throw new ConflictException(
        "Global memory read is disabled by assistant policy. Memory Center list is unavailable."
      );
    }

    const items = await this.memoryRegistryRepository.listActiveByAssistantId(
      assistant.id,
      LIST_LIMIT
    );

    return items.map((item) => ({
      id: item.id,
      summary: item.summary,
      sourceType: item.sourceType,
      sourceLabel: item.sourceLabel,
      memoryClass: item.memoryClass,
      kind: item.kind,
      createdAt: item.createdAt.toISOString(),
      chatId: item.chatId,
      resolvedAt: item.resolvedAt === null ? null : item.resolvedAt.toISOString()
    }));
  }
}
