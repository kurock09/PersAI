import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type UpdateAssistantDraftInput
} from "../domain/assistant.repository";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";

export interface UpdateAssistantDraftRequest {
  displayName?: string | null;
  instructions?: string | null;
}

function normalizeOptionalDraftField(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string, null, or omitted.`);
  }

  return value.trim();
}

@Injectable()
export class UpdateAssistantDraftService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  parseInput(payload: unknown): UpdateAssistantDraftRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Draft payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const displayName = normalizeOptionalDraftField(body.displayName, "displayName");
    const instructions = normalizeOptionalDraftField(body.instructions, "instructions");

    if (displayName === undefined && instructions === undefined) {
      throw new BadRequestException("At least one draft field must be provided.");
    }

    return {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(instructions !== undefined ? { instructions } : {})
    };
  }

  async execute(
    userId: string,
    request: UpdateAssistantDraftRequest
  ): Promise<AssistantLifecycleState> {
    const existingAssistant = await this.assistantRepository.findByUserId(userId);
    if (existingAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const nextDraft: UpdateAssistantDraftInput = {
      draftDisplayName:
        request.displayName === undefined
          ? existingAssistant.draftDisplayName
          : request.displayName,
      draftInstructions:
        request.instructions === undefined
          ? existingAssistant.draftInstructions
          : request.instructions
    };

    const updatedAssistant = await this.assistantRepository.updateDraft(userId, nextDraft);
    if (updatedAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(updatedAssistant.id);
    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      updatedAssistant.id
    );
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      updatedAssistant.id
    );

    return toAssistantLifecycleState(
      updatedAssistant,
      latestPublishedVersion,
      governance,
      materialization
    );
  }
}
