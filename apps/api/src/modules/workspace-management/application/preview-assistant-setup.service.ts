import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { toAssistantInboundHttpException } from "./assistant-inbound-error";

export interface AssistantSetupPreviewState {
  message: string;
  respondedAt: string;
}

@Injectable()
export class PreviewAssistantSetupService {
  private readonly logger = new Logger(PreviewAssistantSetupService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<AssistantSetupPreviewState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestVersion = await this.assistantPublishedVersionRepository.findLatestByAssistantId(
      assistant.id
    );
    const previewVersion: AssistantPublishedVersion = {
      id: randomUUID(),
      assistantId: assistant.id,
      version: (latestVersion?.version ?? 0) + 1,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistant.draftAssistantGender,
      publishedByUserId: userId,
      createdAt: new Date()
    };
    const artifacts = await this.materializeAssistantPublishedVersionService.buildRuntimeArtifacts(
      assistant,
      previewVersion
    );

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true }
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: assistant.workspaceId },
      select: { timezone: true }
    });
    const userDisplayName = user?.displayName?.trim() || "your human";
    const previewPrompt =
      `Introduce yourself to ${userDisplayName} in 2-4 natural sentences as if this were your first conversation. ` +
      "Sound like your configured persona. Do not mention previews, setup, drafts, or internal configuration.";

    await this.cleanupPreviewWorkspace(assistant.id);
    try {
      await this.assistantRuntimeAdapter.applyMaterializedSpec({
        assistantId: assistant.id,
        publishedVersionId: previewVersion.id,
        contentHash: artifacts.contentHash,
        openclawBootstrap: artifacts.openclawBootstrap,
        openclawWorkspace: artifacts.openclawWorkspace,
        reapply: false
      });

      const result = await this.assistantRuntimeAdapter
        .sendWebChatTurn({
          assistantId: assistant.id,
          publishedVersionId: previewVersion.id,
          chatId: randomUUID(),
          surfaceThreadKey: `setup-preview-${randomUUID()}`,
          userMessageId: randomUUID(),
          userMessage: previewPrompt,
          userTimezone: workspace?.timezone ?? "UTC",
          currentTimeIso: new Date().toISOString()
        })
        .catch((error: unknown) => {
          throw toAssistantInboundHttpException(error);
        });

      return {
        message: result.assistantMessage,
        respondedAt: result.respondedAt
      };
    } finally {
      await this.cleanupPreviewWorkspace(assistant.id);
    }
  }

  private async cleanupPreviewWorkspace(assistantId: string): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.cleanupWorkspace(assistantId);
    } catch (error) {
      this.logger.warn("Non-fatal setup preview workspace cleanup failure.", error);
    }
  }
}
