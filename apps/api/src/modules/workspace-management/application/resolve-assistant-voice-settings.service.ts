import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PersaiRuntimeTtsProviderId } from "@persai/runtime-contract";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import {
  DEFAULT_TTS_PRIMARY_PROVIDER,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY
} from "./tool-credential-settings";
import {
  ElevenLabsVoiceCatalogService,
  type ElevenLabsAdminVoiceCatalogEntry,
  type ElevenLabsVoiceCurationPatch,
  type ElevenLabsVoiceGenderTag,
  type ElevenLabsVoiceLanguageBucket
} from "./elevenlabs/elevenlabs-voice-catalog.service";
import { AdminAuthorizationService } from "./admin-authorization.service";

export type AssistantVoiceGenderTag = ElevenLabsVoiceGenderTag;

export type AssistantVoiceLanguageBucket = ElevenLabsVoiceLanguageBucket;

export interface AssistantVoiceCatalogEntry {
  voiceId: string;
  name: string;
  gender: AssistantVoiceGenderTag;
  category: string | null;
  language: string | null;
  languageBucket: AssistantVoiceLanguageBucket;
  previewUrl: string | null;
}

export interface AssistantVoiceSettingsState {
  schema: "persai.assistantVoiceSettings.v1";
  primaryProviderId: PersaiRuntimeTtsProviderId;
  elevenlabs: {
    configured: boolean;
    loadState: "ready" | "not_configured" | "unavailable";
    voices: AssistantVoiceCatalogEntry[];
    warning: string | null;
    admin: {
      voices: ElevenLabsAdminVoiceCatalogEntry[];
      publicVoices: AssistantVoiceCatalogEntry[];
    } | null;
  } | null;
}

@Injectable()
export class ResolveAssistantVoiceSettingsService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly elevenLabsVoiceCatalogService: ElevenLabsVoiceCatalogService,
    private readonly adminAuthorizationService: AdminAuthorizationService
  ) {}

  async execute(userId: string): Promise<AssistantVoiceSettingsState> {
    const assistant = await this.resolveActiveAssistantService.executeOptional({ userId });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }

    const primaryProviderId = await this.loadTtsPrimaryProviderId();
    if (primaryProviderId !== "elevenlabs") {
      return {
        schema: "persai.assistantVoiceSettings.v1",
        primaryProviderId,
        elevenlabs: null
      };
    }

    const includeAdmin = await this.canReadAdminSurface(userId);
    const catalog = await this.elevenLabsVoiceCatalogService.getCatalog({ includeAdmin });
    return this.toState(primaryProviderId, catalog);
  }

  async updateElevenLabsCuration(params: {
    userId: string;
    patches: ElevenLabsVoiceCurationPatch[];
  }): Promise<AssistantVoiceSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(params.userId);
    await this.elevenLabsVoiceCatalogService.updateCuration(params.patches);
    return this.execute(params.userId);
  }

  async refreshElevenLabsCatalog(userId: string): Promise<AssistantVoiceSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const primaryProviderId = await this.loadTtsPrimaryProviderId();
    if (primaryProviderId !== "elevenlabs") {
      return {
        schema: "persai.assistantVoiceSettings.v1",
        primaryProviderId,
        elevenlabs: null
      };
    }
    const catalog = await this.elevenLabsVoiceCatalogService.getCatalog({
      includeAdmin: true,
      forceRefresh: true
    });
    return this.toState(primaryProviderId, catalog);
  }

  private toState(
    primaryProviderId: PersaiRuntimeTtsProviderId,
    catalog: Awaited<ReturnType<ElevenLabsVoiceCatalogService["getCatalog"]>>
  ): AssistantVoiceSettingsState {
    return {
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId,
      elevenlabs: {
        configured: catalog.configured,
        loadState: catalog.loadState,
        voices: catalog.voices,
        warning: catalog.warning,
        admin: catalog.admin
      }
    };
  }

  private async canReadAdminSurface(userId: string): Promise<boolean> {
    try {
      await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return false;
      }
      throw error;
    }
  }

  private async loadTtsPrimaryProviderId(): Promise<PersaiRuntimeTtsProviderId> {
    const stored =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        TTS_PRIMARY_PROVIDER_STORAGE_KEY
      );
    if (stored === "elevenlabs" || stored === "yandex" || stored === "openai") {
      return stored;
    }
    return DEFAULT_TTS_PRIMARY_PROVIDER;
  }
}
