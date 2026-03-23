import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { buildWebChatMemorySummary } from "./memory-summary.util";

@Injectable()
export class RecordWebChatMemoryTurnService {
  constructor(
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository
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
  }): Promise<void> {
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
