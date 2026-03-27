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
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

@Injectable()
export class PublishAssistantDraftService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const publishedVersion = await this.assistantPublishedVersionRepository.create({
      assistantId: assistant.id,
      publishedByUserId: userId,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "assistant_lifecycle",
      eventCode: "assistant.published",
      summary: "Assistant draft published.",
      details: {
        publishedVersionId: publishedVersion.id,
        publishedVersionNumber: publishedVersion.version
      }
    });

    const assistantWithPendingApply = await this.assistantRepository.markApplyPending(
      userId,
      publishedVersion.id
    );
    if (assistantWithPendingApply === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    await this.materializeAssistantPublishedVersionService.execute(
      assistantWithPendingApply,
      publishedVersion,
      "publish"
    );
    await this.applyAssistantPublishedVersionService.execute(userId, publishedVersion, false);

    await this.syncTelegramBindingMetadata(assistant.id, assistant.draftDisplayName, assistant.draftAvatarUrl);

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
      publishedVersion,
      governance,
      materialization
    );
  }

  private async syncTelegramBindingMetadata(
    assistantId: string,
    displayName: string | null,
    avatarUrl: string | null
  ): Promise<void> {
    try {
      const binding =
        await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
          assistantId,
          "telegram",
          "telegram_bot"
        );
      if (!binding || binding.bindingState !== "active") return;

      const patch: Record<string, unknown> = {};
      if (displayName !== null) patch.displayName = displayName;
      if (avatarUrl !== null) patch.avatarUrl = avatarUrl;
      if (Object.keys(patch).length === 0) return;

      await this.assistantChannelSurfaceBindingRepository.patchMetadata(
        assistantId,
        "telegram",
        "telegram_bot",
        patch
      );
    } catch (err) {
      console.warn("[publish] Non-fatal: failed to sync Telegram binding metadata:", err);
    }
  }
}
