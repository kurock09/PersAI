import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import {
  WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT,
  evaluateGlobalMemoryWritePolicy,
  isGlobalMemoryReadAllowed
} from "../domain/memory-source-policy";
import type {
  AssistantMemoryRegistryClassState,
  AssistantMemoryRegistryKindState
} from "./assistant-memory.types";

const WORKSPACE_MEMORY_LIST_LIMIT = 100;
const WORKSPACE_MEMORY_SEARCH_LIMIT = 50;
const WORKSPACE_MEMORY_SOURCE_LABEL = "Workspace memory";

export type WorkspaceMemoryItemState = {
  id: string;
  content: string;
  createdAt: string | null;
  source: string;
  memoryClass: AssistantMemoryRegistryClassState;
  kind: AssistantMemoryRegistryKindState | null;
  resolvedAt: string | null;
};

@Injectable()
export class ManageAssistantWorkspaceMemoryService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  async list(userId: string): Promise<WorkspaceMemoryItemState[]> {
    const assistant = await this.resolveAssistant(userId);
    await this.assertReadAllowed(assistant.id);
    const items = await this.assistantMemoryRegistryRepository.listActiveByAssistantId(
      assistant.id,
      WORKSPACE_MEMORY_LIST_LIMIT,
      { sourceType: "memory_write" }
    );
    return items.map((item) => this.toWorkspaceMemoryItem(item));
  }

  async search(userId: string, rawQuery: string): Promise<WorkspaceMemoryItemState[]> {
    const assistant = await this.resolveAssistant(userId);
    await this.assertReadAllowed(assistant.id);
    const query = this.normalizeContent(rawQuery, "q");
    const items = await this.assistantMemoryRegistryRepository.searchActiveByAssistantId(
      assistant.id,
      query,
      WORKSPACE_MEMORY_SEARCH_LIMIT,
      { sourceType: "memory_write" }
    );
    return items.map((item) => this.toWorkspaceMemoryItem(item));
  }

  async add(userId: string, rawContent: string): Promise<WorkspaceMemoryItemState> {
    const assistant = await this.resolveAssistant(userId);
    await this.assertWriteAllowed(assistant.id);
    const content = this.normalizeContent(rawContent, "content");
    const created = await this.assistantMemoryRegistryRepository.create({
      assistantId: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      chatId: null,
      relatedUserMessageId: null,
      relatedAssistantMessageId: null,
      summary: content,
      sourceType: "memory_write",
      sourceLabel: WORKSPACE_MEMORY_SOURCE_LABEL,
      memoryClass: "core",
      kind: "fact"
    });
    return this.toWorkspaceMemoryItem(created);
  }

  async edit(userId: string, itemId: string, rawContent: string): Promise<void> {
    const assistant = await this.resolveAssistant(userId);
    await this.assertWriteAllowed(assistant.id);
    const content = this.normalizeContent(rawContent, "content");
    const existing = await this.assistantMemoryRegistryRepository.findActiveByIdAndAssistantId(
      itemId,
      assistant.id
    );
    if (existing === null || existing.sourceType !== "memory_write") {
      throw new NotFoundException("Workspace memory item not found.");
    }
    await this.assistantMemoryRegistryRepository.updateSummaryById(itemId, assistant.id, content);
  }

  async forget(userId: string, itemId: string): Promise<void> {
    const assistant = await this.resolveAssistant(userId);
    await this.assertReadAllowed(assistant.id);
    const existing = await this.assistantMemoryRegistryRepository.findActiveByIdAndAssistantId(
      itemId,
      assistant.id
    );
    if (existing === null || existing.sourceType !== "memory_write") {
      throw new NotFoundException("Workspace memory item not found.");
    }
    await this.assistantMemoryRegistryRepository.markForgottenById(itemId, assistant.id);
  }

  private async resolveAssistant(
    userId: string
  ): Promise<NonNullable<Awaited<ReturnType<AssistantRepository["findByUserId"]>>>> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return assistant;
  }

  private async assertReadAllowed(assistantId: string): Promise<void> {
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistantId);
    const effectiveMemoryControl = resolveEffectiveMemoryControlFromGovernance(governance);
    if (!isGlobalMemoryReadAllowed(effectiveMemoryControl)) {
      throw new ConflictException("Workspace memory reads are disabled by the current policy.");
    }
  }

  private async assertWriteAllowed(assistantId: string): Promise<void> {
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistantId);
    const effectiveMemoryControl = resolveEffectiveMemoryControlFromGovernance(governance);
    const decision = evaluateGlobalMemoryWritePolicy(
      effectiveMemoryControl,
      WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
    );
    if (!decision.allowed) {
      throw new ConflictException(decision.message);
    }
  }

  private normalizeContent(value: string, fieldName: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length === 0 || normalized.length > 500) {
      throw new BadRequestException(`${fieldName} must be between 1 and 500 characters.`);
    }
    return normalized;
  }

  private toWorkspaceMemoryItem(item: {
    id: string;
    summary: string;
    createdAt: Date;
    sourceType: string;
    sourceLabel: string | null;
    memoryClass: AssistantMemoryRegistryClassState;
    kind: AssistantMemoryRegistryKindState | null;
    resolvedAt: Date | null;
  }): WorkspaceMemoryItemState {
    return {
      id: item.id,
      content: item.summary,
      createdAt: item.createdAt.toISOString(),
      source: item.sourceLabel ?? item.sourceType,
      memoryClass: item.memoryClass,
      kind: item.kind,
      resolvedAt: item.resolvedAt === null ? null : item.resolvedAt.toISOString()
    };
  }
}
