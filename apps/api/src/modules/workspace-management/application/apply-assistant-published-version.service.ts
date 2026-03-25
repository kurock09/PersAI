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
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";

@Injectable()
export class ApplyAssistantPublishedVersionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService
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
    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistantInProgress.workspaceId,
      assistantId: assistantInProgress.id,
      actorUserId: userId,
      eventCategory: "runtime_apply",
      eventCode: "assistant.runtime.apply_in_progress",
      summary: "Assistant runtime apply started.",
      details: {
        publishedVersionId: publishedVersion.id,
        reapply
      }
    });

    let materializedSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      publishedVersion.id
    );
    try {
      await this.materializeAssistantPublishedVersionService.execute(
        assistantInProgress,
        publishedVersion,
        materializedSpec?.sourceAction ?? "publish"
      );
      materializedSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
        publishedVersion.id
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Materialized runtime spec refresh failed.";
      await this.assistantRepository.markApplyFailed(
        userId,
        publishedVersion.id,
        "materialization_failed",
        errorMessage
      );
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistantInProgress.workspaceId,
        assistantId: assistantInProgress.id,
        actorUserId: userId,
        eventCategory: "runtime_apply",
        eventCode: "assistant.runtime.apply_failed",
        outcome: "failed",
        summary: "Assistant runtime apply failed during materialization refresh.",
        details: {
          publishedVersionId: publishedVersion.id,
          reapply,
          errorCode: "materialization_failed",
          errorMessage
        }
      });
      return;
    }
    if (materializedSpec === null) {
      await this.assistantRepository.markApplyFailed(
        userId,
        publishedVersion.id,
        "invalid_response",
        "Materialized runtime spec is missing for published version."
      );
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistantInProgress.workspaceId,
        assistantId: assistantInProgress.id,
        actorUserId: userId,
        eventCategory: "runtime_apply",
        eventCode: "assistant.runtime.apply_failed",
        outcome: "failed",
        summary: "Assistant runtime apply failed.",
        details: {
          publishedVersionId: publishedVersion.id,
          reapply,
          errorCode: "invalid_response",
          errorMessage: "Materialized runtime spec is missing for published version."
        }
      });
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
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistantInProgress.workspaceId,
        assistantId: assistantInProgress.id,
        actorUserId: userId,
        eventCategory: "runtime_apply",
        eventCode: "assistant.runtime.apply_succeeded",
        summary: "Assistant runtime apply succeeded.",
        details: {
          publishedVersionId: publishedVersion.id,
          reapply,
          contentHash: materializedSpec.contentHash
        }
      });
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) {
        if (error.code === "runtime_degraded") {
          await this.assistantRepository.markApplyDegraded(
            userId,
            publishedVersion.id,
            error.code,
            error.message
          );
          await this.appendAssistantAuditEventService.execute({
            workspaceId: assistantInProgress.workspaceId,
            assistantId: assistantInProgress.id,
            actorUserId: userId,
            eventCategory: "runtime_apply",
            eventCode: "assistant.runtime.apply_degraded",
            outcome: "degraded",
            summary: "Assistant runtime apply completed with degraded runtime state.",
            details: {
              publishedVersionId: publishedVersion.id,
              reapply,
              errorCode: error.code,
              errorMessage: error.message
            }
          });
          return;
        }

        await this.assistantRepository.markApplyFailed(
          userId,
          publishedVersion.id,
          error.code,
          error.message
        );
        await this.appendAssistantAuditEventService.execute({
          workspaceId: assistantInProgress.workspaceId,
          assistantId: assistantInProgress.id,
          actorUserId: userId,
          eventCategory: "runtime_apply",
          eventCode: "assistant.runtime.apply_failed",
          outcome: "failed",
          summary: "Assistant runtime apply failed.",
          details: {
            publishedVersionId: publishedVersion.id,
            reapply,
            errorCode: error.code,
            errorMessage: error.message
          }
        });
        return;
      }

      throw error;
    }
  }
}
