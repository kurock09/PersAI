import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  AssistantRuntimeAdapterError,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";

@Injectable()
export class ApplyAssistantPublishedVersionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter
  ) {}

  async execute(
    userId: string,
    publishedVersion: AssistantPublishedVersion,
    reapply: boolean
  ): Promise<void> {
    const assistantInProgress = await this.assistantRepository.markApplyInProgress(
      userId,
      publishedVersion.id
    );
    if (assistantInProgress === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const materializedSpec =
      await this.assistantMaterializedSpecRepository.findByPublishedVersionId(publishedVersion.id);
    if (materializedSpec === null) {
      await this.assistantRepository.markApplyFailed(
        userId,
        publishedVersion.id,
        "invalid_response",
        "Materialized runtime spec is missing for published version."
      );
      return;
    }

    try {
      await this.assistantRuntimeAdapter.applyMaterializedSpec({
        assistantId: assistantInProgress.id,
        publishedVersionId: publishedVersion.id,
        contentHash: materializedSpec.contentHash,
        openclawBootstrap: materializedSpec.openclawBootstrap,
        openclawWorkspace: materializedSpec.openclawWorkspace,
        reapply
      });

      await this.assistantRepository.markApplySucceeded(userId, publishedVersion.id);
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) {
        if (error.code === "runtime_degraded") {
          await this.assistantRepository.markApplyDegraded(
            userId,
            publishedVersion.id,
            error.code,
            error.message
          );
          return;
        }

        await this.assistantRepository.markApplyFailed(
          userId,
          publishedVersion.id,
          error.code,
          error.message
        );
        return;
      }

      throw error;
    }
  }
}
