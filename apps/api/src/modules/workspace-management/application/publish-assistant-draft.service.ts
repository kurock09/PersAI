import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_ARCHETYPE_KEY } from "../../../../prisma/persona-archetype-data";
import { ManagePersonaArchetypesService } from "./manage-persona-archetypes.service";
import type { AssistantPublishedVersionSnapshotVoiceDna } from "../domain/assistant-published-version.entity";
import type { PersonaArchetype } from "../domain/persona-archetype.entity";
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
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { TelegramBotClientService } from "./telegram-bot.client.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile
} from "./assistant-voice-profile";
import { normalizeAssistantGender } from "./assistant-gender";

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
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly telegramBotClientService: TelegramBotClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly managePersonaArchetypesService: ManagePersonaArchetypesService
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const assistantGender = normalizeAssistantGender(assistant.draftAssistantGender);
    const draftVoiceProfile = applyAssistantGenderVoiceDefaults({
      assistantGender,
      voiceProfile: normalizeAssistantVoiceProfile(assistant.draftVoiceProfile)
    });

    const archetypeKey = assistant.draftArchetypeKey ?? DEFAULT_ARCHETYPE_KEY;
    const liveArchetype = await this.managePersonaArchetypesService.findByKey(archetypeKey);
    const snapshotVoiceDna = liveArchetype ? this.toSnapshotVoiceDna(liveArchetype) : null;

    const publishedVersion = await this.assistantPublishedVersionRepository.create({
      assistantId: assistant.id,
      publishedByUserId: userId,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistantGender,
      snapshotVoiceProfile: draftVoiceProfile,
      snapshotArchetypeKey: liveArchetype ? archetypeKey : null,
      snapshotVoiceDna
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

    await this.syncTelegramBotProfile(
      assistant.id,
      assistant.draftDisplayName,
      assistant.draftAvatarUrl
    );

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

  private async syncTelegramBotProfile(
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

      const runtimeConfig =
        await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(assistantId);
      if (runtimeConfig === null) {
        return;
      }

      if (displayName !== null && displayName.trim().length > 0) {
        await this.telegramBotClientService.setBotProfileName(runtimeConfig.botToken, displayName);
      }

      if (avatarUrl !== null) {
        const avatar = await this.resolveTelegramProfilePhoto(assistantId, avatarUrl);
        if (avatar !== null) {
          await this.telegramBotClientService.setBotProfilePhoto({
            botToken: runtimeConfig.botToken,
            buffer: avatar.buffer,
            filename: avatar.filename
          });
        }
      }
    } catch (err) {
      console.warn("[publish] Non-fatal: failed to sync Telegram binding metadata:", err);
    }
  }

  private async resolveTelegramProfilePhoto(
    assistantId: string,
    avatarUrl: string
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    if (avatarUrl.startsWith("/avatar-presets/")) {
      return this.loadPresetAvatar(avatarUrl);
    }

    const avatar = await this.mediaObjectStorage.downloadObject(
      `${this.mediaObjectStorage.buildAssistantPrefix(assistantId)}avatar/current`
    );
    if (avatar === null) {
      return null;
    }

    return {
      buffer: avatar.buffer,
      filename: this.resolveTelegramAvatarFilename(avatar.contentType)
    };
  }

  private async loadPresetAvatar(
    avatarUrl: string
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    const relativePresetPath = avatarUrl.replace(/^\/+/, "");
    const candidatePaths = [
      resolve(process.cwd(), "..", "web", "public", relativePresetPath),
      resolve(process.cwd(), "apps", "web", "public", relativePresetPath)
    ];

    for (const candidatePath of candidatePaths) {
      try {
        const buffer = await readFile(candidatePath);
        return {
          buffer,
          filename: `assistant-avatar${extname(basename(candidatePath)).toLowerCase() || ".png"}`
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private toSnapshotVoiceDna(
    archetype: PersonaArchetype
  ): AssistantPublishedVersionSnapshotVoiceDna {
    return {
      key: archetype.key,
      displayOrder: archetype.displayOrder,
      label: archetype.label,
      description: archetype.description,
      voice: archetype.voice,
      openingsAllowed: archetype.openingsAllowed,
      openingsForbidden: archetype.openingsForbidden,
      behaviors: archetype.behaviors,
      silenceRule: archetype.silenceRule,
      examples: archetype.examples,
      defaultTraits: archetype.defaultTraits
    };
  }

  private resolveTelegramAvatarFilename(contentType: string): string {
    const normalized = contentType.trim().toLowerCase();
    if (normalized === "image/png") {
      return "assistant-avatar.png";
    }
    if (normalized === "image/webp") {
      return "assistant-avatar.webp";
    }
    if (normalized === "image/gif") {
      return "assistant-avatar.gif";
    }
    return "assistant-avatar.jpg";
  }
}
