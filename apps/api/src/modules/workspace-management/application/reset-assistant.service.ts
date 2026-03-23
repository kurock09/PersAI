import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";

@Injectable()
export class ResetAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const resetVersion = await this.assistantPublishedVersionRepository.create({
      assistantId: assistant.id,
      publishedByUserId: userId,
      snapshotDisplayName: null,
      snapshotInstructions: null
    });

    const updatedAssistant = await this.assistantRepository.updateDraft(userId, {
      draftDisplayName: null,
      draftInstructions: null
    });
    if (updatedAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const assistantWithPendingApply = await this.assistantRepository.markApplyPending(
      userId,
      resetVersion.id
    );
    if (assistantWithPendingApply === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return toAssistantLifecycleState(assistantWithPendingApply, resetVersion);
  }
}
