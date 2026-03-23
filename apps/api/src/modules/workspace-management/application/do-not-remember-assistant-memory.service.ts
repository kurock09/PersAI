import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

@Injectable()
export class DoNotRememberAssistantMemoryService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRegistryRepository: AssistantMemoryRegistryRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository
  ) {}

  parseInput(payload: unknown): { assistantMessageId: string; userMessageId: string | null } {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Request body must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const assistantMessageId = body.assistantMessageId;
    const userMessageId = body.userMessageId;

    if (typeof assistantMessageId !== "string" || !isUuid(assistantMessageId)) {
      throw new BadRequestException("assistantMessageId must be a valid UUID.");
    }

    if (userMessageId === undefined || userMessageId === null) {
      return { assistantMessageId, userMessageId: null };
    }

    if (typeof userMessageId !== "string" || !isUuid(userMessageId)) {
      throw new BadRequestException("userMessageId must be a valid UUID when provided.");
    }

    return { assistantMessageId, userMessageId };
  }

  async execute(
    userId: string,
    input: { assistantMessageId: string; userMessageId: string | null }
  ): Promise<{ forgottenRegistryItems: number }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const assistantMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
      input.assistantMessageId,
      assistant.id
    );
    if (assistantMessage === null || assistantMessage.author !== "assistant") {
      throw new NotFoundException("Assistant message was not found for this assistant.");
    }

    const userMessageId = input.userMessageId;
    if (userMessageId !== null) {
      const userMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
        userMessageId,
        assistant.id
      );
      if (userMessage === null || userMessage.author !== "user") {
        throw new NotFoundException("User message was not found for this assistant.");
      }
      if (userMessage.chatId !== assistantMessage.chatId) {
        throw new BadRequestException("User and assistant messages must belong to the same chat.");
      }
    }

    const governanceRow = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveMemoryControlFromGovernance(governanceRow);
    if (!isGlobalMemoryReadAllowed(envelope)) {
      throw new ConflictException(
        "Global memory read is disabled by assistant policy. Do-not-remember is unavailable."
      );
    }

    const forgottenRegistryItems = await this.memoryRegistryRepository.markForgottenForMessages(
      assistant.id,
      {
        assistantMessageId: input.assistantMessageId,
        userMessageId
      }
    );

    await this.assistantGovernanceRepository.appendMemoryControlForgetMarker(assistant.id, {
      id: randomUUID(),
      scope: "assistant_turn",
      requestedAt: new Date().toISOString(),
      assistantMessageId: input.assistantMessageId,
      userMessageId,
      chatId: assistantMessage.chatId
    });

    return { forgottenRegistryItems };
  }
}
