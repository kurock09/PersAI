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

export interface RollbackAssistantRequest {
  targetVersion: number;
}

@Injectable()
export class RollbackAssistantService {
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

  parseInput(payload: unknown): RollbackAssistantRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Rollback payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    if (
      typeof body.targetVersion !== "number" ||
      !Number.isInteger(body.targetVersion) ||
      body.targetVersion < 1
    ) {
      throw new BadRequestException("targetVersion must be an integer greater than 0.");
    }

    return {
      targetVersion: body.targetVersion
    };
  }

  async execute(
    userId: string,
    request: RollbackAssistantRequest
  ): Promise<AssistantLifecycleState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    if (latestPublishedVersion === null) {
      throw new ConflictException("Cannot rollback without published versions.");
    }

    if (request.targetVersion === latestPublishedVersion.version) {
      throw new ConflictException("targetVersion is already the latest published version.");
    }

    const targetVersion =
      await this.assistantPublishedVersionRepository.findByAssistantIdAndVersion(
        assistant.id,
        request.targetVersion
      );
    if (targetVersion === null) {
      throw new NotFoundException("Requested published version does not exist.");
    }

    const rolledBackVersion = await this.assistantPublishedVersionRepository.create({
      assistantId: assistant.id,
      publishedByUserId: userId,
      snapshotDisplayName: targetVersion.snapshotDisplayName,
      snapshotInstructions: targetVersion.snapshotInstructions
    });

    const updatedAssistant = await this.assistantRepository.updateDraft(userId, {
      draftDisplayName: targetVersion.snapshotDisplayName,
      draftInstructions: targetVersion.snapshotInstructions
    });
    if (updatedAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const assistantWithPendingApply = await this.assistantRepository.markApplyPending(
      userId,
      rolledBackVersion.id
    );
    if (assistantWithPendingApply === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    await this.materializeAssistantPublishedVersionService.execute(
      assistantWithPendingApply,
      rolledBackVersion,
      "rollback"
    );

    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      assistantWithPendingApply.id
    );
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      assistantWithPendingApply.id
    );

    return toAssistantLifecycleState(
      assistantWithPendingApply,
      rolledBackVersion,
      governance,
      materialization
    );
  }
}
