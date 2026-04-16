import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ASSISTANT_RUNTIME_FACADE, type AssistantRuntimeFacade } from "./assistant-runtime.facade";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { toAssistantInboundHttpException } from "./assistant-inbound-error";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile
} from "./assistant-voice-profile";
import { normalizeAssistantGender } from "./assistant-gender";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";

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
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
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
    const assistantGender = normalizeAssistantGender(assistant.draftAssistantGender);
    const draftVoiceProfile = applyAssistantGenderVoiceDefaults({
      assistantGender,
      voiceProfile: normalizeAssistantVoiceProfile(assistant.draftVoiceProfile)
    });
    const previewVersion: AssistantPublishedVersion = {
      id: randomUUID(),
      assistantId: assistant.id,
      version: (latestVersion?.version ?? 0) + 1,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistantGender,
      snapshotVoiceProfile: draftVoiceProfile,
      publishedByUserId: userId,
      createdAt: new Date()
    };
    const artifacts = await this.materializeAssistantPublishedVersionService.buildRuntimeArtifacts(
      assistant,
      previewVersion
    );

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: assistant.workspaceId },
      select: { timezone: true }
    });

    const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(artifacts.layers);
    const result = await this.assistantRuntime
      .previewSetupTurn({
        assistantId: assistant.id,
        ...(runtimeAssignment?.effectiveTier
          ? { runtimeTier: runtimeAssignment.effectiveTier }
          : {}),
        userMessage: artifacts.runtimeBundle.promptConstructor.onboarding.firstTurnPrompt,
        runtimeBundle: artifacts.runtimeBundle,
        adapterPayload: {
          assistantConfig: artifacts.openclawBootstrap,
          assistantWorkspace: artifacts.openclawWorkspace
        },
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
