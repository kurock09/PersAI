import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { normalizeAssistantGender } from "./assistant-gender";

export interface AssistantSetupPreviewState {
  message: string;
  respondedAt: string;
}

@Injectable()
export class PreviewAssistantSetupService {
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
      snapshotAssistantGender: normalizeAssistantGender(assistant.draftAssistantGender),
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

    const result = await this.assistantRuntimeAdapter
      .previewSetupTurn({
        assistantId: assistant.id,
        userMessage: previewPrompt,
        openclawBootstrap: artifacts.openclawBootstrap,
        openclawWorkspace: artifacts.openclawWorkspace,
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
  }
}
