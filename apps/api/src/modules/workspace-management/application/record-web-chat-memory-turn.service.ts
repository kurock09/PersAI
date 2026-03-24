import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import {
  evaluateGlobalMemoryWritePolicy,
  type GlobalMemoryWriteAttemptContext
} from "../domain/memory-source-policy";
import { buildWebChatMemorySummary } from "./memory-summary.util";

@Injectable()
export class RecordWebChatMemoryTurnService {
  constructor(
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository
  ) {}

  async execute(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    userMessageId: string;
    assistantMessageId: string;
    userContent: string;
    assistantContent: string;
    memoryWriteContext: GlobalMemoryWriteAttemptContext;
  }): Promise<void> {
    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      params.assistantId
    );
    const envelope = resolveEffectiveMemoryControlFromGovernance(governance);
    const decision = evaluateGlobalMemoryWritePolicy(envelope, params.memoryWriteContext);
    if (!decision.allowed) {
      // Chat turn already succeeded; omit registry row when policy denies (no HTTP error to caller).
      return;
    }

    const summary = buildWebChatMemorySummary(params.userContent, params.assistantContent);
    await this.memoryRegistryRepository.create({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      relatedUserMessageId: params.userMessageId,
      relatedAssistantMessageId: params.assistantMessageId,
      summary,
      sourceType: "web_chat",
      sourceLabel: "Web chat"
    });
  }
}
