import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { Assistant } from "../domain/assistant.entity";
import { createAssistantInboundConflict } from "./assistant-inbound-error";

export interface ResolvedAssistantInboundRuntimeContext {
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  userId: string;
  workspaceId: string;
}

@Injectable()
export class ResolveAssistantInboundRuntimeContextService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository
  ) {}

  async resolveByUserId(userId: string): Promise<ResolvedAssistantInboundRuntimeContext> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    return this.resolveFromAssistant(assistant);
  }

  async resolveByAssistantId(assistantId: string): Promise<ResolvedAssistantInboundRuntimeContext> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return this.resolveFromAssistant(assistant);
  }

  private async resolveFromAssistant(
    assistant: Assistant
  ): Promise<ResolvedAssistantInboundRuntimeContext> {
    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    if (latestPublishedVersion === null) {
      throw createAssistantInboundConflict(
        "assistant_not_live",
        "Assistant transport is unavailable until at least one version is published."
      );
    }

    if (
      assistant.applyStatus !== "succeeded" ||
      assistant.applyAppliedVersionId !== latestPublishedVersion.id
    ) {
      throw createAssistantInboundConflict(
        "assistant_not_live",
        "Assistant transport requires the latest published version to be successfully applied."
      );
    }

    return {
      assistant,
      assistantId: assistant.id,
      publishedVersionId: latestPublishedVersion.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId
    };
  }
}
