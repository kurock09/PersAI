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
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";

@Injectable()
export class ReapplyAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    if (latestPublishedVersion === null) {
      throw new NotFoundException("Assistant does not have a published version to reapply.");
    }

    await this.assistantRepository.markApplyPending(userId, latestPublishedVersion.id);
    await this.applyAssistantPublishedVersionService.execute(userId, latestPublishedVersion, true);

    const refreshedAssistant = await this.assistantRepository.findByUserId(userId);
    if (refreshedAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      refreshedAssistant.id
    );
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      refreshedAssistant.id
    );

    return toAssistantLifecycleState(
      refreshedAssistant,
      latestPublishedVersion,
      governance,
      materialization
    );
  }
}
