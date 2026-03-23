import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";

@Injectable()
export class ResetAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService
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

    await this.materializeAssistantPublishedVersionService.execute(
      assistantWithPendingApply,
      resetVersion,
      "reset"
    );

    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      assistantWithPendingApply.id
    );
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      assistantWithPendingApply.id
    );

    return toAssistantLifecycleState(
      assistantWithPendingApply,
      resetVersion,
      governance,
      materialization
    );
  }
}
