import { Injectable, NotFoundException } from "@nestjs/common";
import type { PersaiRuntimeTtsProviderId } from "@persai/runtime-contract";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import {
  DEFAULT_TTS_PRIMARY_PROVIDER,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY
} from "./tool-credential-settings";

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_PROVIDER_KEY = "tool_tts_elevenlabs";
const ELEVENLABS_VOICE_LOAD_TIMEOUT_MS = 10_000;

export type AssistantVoiceGenderTag = "male" | "female" | "neutral" | "unknown";

export interface AssistantVoiceCatalogEntry {
  voiceId: string;
  name: string;
  gender: AssistantVoiceGenderTag;
  category: string | null;
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
  } | null;
}

@Injectable()
export class ResolveAssistantVoiceSettingsService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
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

    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      ELEVENLABS_PROVIDER_KEY
    ]);
    if (keyMetadata[ELEVENLABS_PROVIDER_KEY]?.configured !== true) {
      return {
        schema: "persai.assistantVoiceSettings.v1",
        primaryProviderId,
        elevenlabs: {
          configured: false,
          loadState: "not_configured",
          voices: [],
          warning: null
        }
      };
    }

    try {
      const apiKey =
        await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
          ELEVENLABS_PROVIDER_KEY
        );
      if (apiKey === null || apiKey.trim().length === 0) {
        return {
          schema: "persai.assistantVoiceSettings.v1",
          primaryProviderId,
          elevenlabs: {
            configured: false,
            loadState: "not_configured",
            voices: [],
            warning: null
          }
        };
      }

      return {
        schema: "persai.assistantVoiceSettings.v1",
        primaryProviderId,
        elevenlabs: {
          configured: true,
          loadState: "ready",
          voices: await this.loadElevenLabsVoices(apiKey.trim()),
          warning: null
        }
      };
    } catch {
      return {
        schema: "persai.assistantVoiceSettings.v1",
        primaryProviderId,
        elevenlabs: {
          configured: true,
          loadState: "unavailable",
          voices: [],
          warning: "Unable to load ElevenLabs voices right now."
        }
      };
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

  private async loadElevenLabsVoices(apiKey: string): Promise<AssistantVoiceCatalogEntry[]> {
    const { signal, dispose } = this.createTimedSignal(ELEVENLABS_VOICE_LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`${ELEVENLABS_API_BASE_URL}/v1/voices`, {
        headers: {
          "xi-api-key": apiKey
        },
        signal
      });
      if (!response.ok) {
        throw new Error(`ElevenLabs voices request failed with status ${String(response.status)}.`);
      }

      const payload = (await response.json()) as unknown;
      const voices = this.asObject(payload)?.voices;
      if (!Array.isArray(voices)) {
        return [];
      }

      return voices
        .map((voice) => this.parseElevenLabsVoice(voice))
        .filter((voice): voice is AssistantVoiceCatalogEntry => voice !== null)
        .sort((left, right) => left.name.localeCompare(right.name));
    } finally {
      dispose();
    }
  }

  private parseElevenLabsVoice(value: unknown): AssistantVoiceCatalogEntry | null {
    const row = this.asObject(value);
    if (row === null) {
      return null;
    }
    const voiceId = typeof row.voice_id === "string" ? row.voice_id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (voiceId.length === 0 || name.length === 0) {
      return null;
    }
    const labels = this.asObject(row.labels);

    return {
      voiceId,
      name,
      gender: this.normalizeVoiceGender(labels?.gender),
      category:
        typeof row.category === "string" && row.category.trim().length > 0 ? row.category : null,
      previewUrl:
        typeof row.preview_url === "string" && row.preview_url.trim().length > 0
          ? row.preview_url
          : null
    };
  }

  private normalizeVoiceGender(value: unknown): AssistantVoiceGenderTag {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "male" || normalized === "female" || normalized === "neutral") {
      return normalized;
    }
    return "unknown";
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private createTimedSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timeoutId)
    };
  }
}
