import { Injectable, Logger } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_PROVIDER_KEY = "tool_tts_elevenlabs";
const ELEVENLABS_VOICE_CACHE_KEY = "elevenlabs-voices";
const ELEVENLABS_VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ELEVENLABS_VOICE_LOAD_TIMEOUT_MS = 10_000;

export type ElevenLabsVoiceGenderTag = "male" | "female" | "neutral" | "unknown";

export type ElevenLabsVoiceLanguageBucket = "ru" | "en" | "other";

export interface ElevenLabsVoiceCatalogEntry {
  voiceId: string;
  name: string;
  gender: ElevenLabsVoiceGenderTag;
  category: string | null;
  language: string | null;
  languageBucket: ElevenLabsVoiceLanguageBucket;
  previewUrl: string | null;
}

export interface ElevenLabsVoiceCatalogResult {
  configured: boolean;
  loadState: "ready" | "not_configured" | "unavailable";
  voices: ElevenLabsVoiceCatalogEntry[];
  warning: string | null;
}

type CachedVoiceCatalogRow = {
  voices: ElevenLabsVoiceCatalogEntry[];
  fetchedAt: Date;
};

/**
 * ADR-113 Slice 2 — platform-wide ElevenLabs voice catalog cache.
 *
 * Mirrors the HeyGen voice catalog cache pattern: a single platform-wide row
 * (`platform_elevenlabs_voice_catalog_cache`) holds the normalized voice list,
 * refreshed lazily on a 24h TTL. On upstream failure the service serves the
 * last known cache (stale) and surfaces a warning rather than going dark.
 *
 * Returns an honest load state:
 * - `not_configured` — no ElevenLabs API key stored.
 * - `unavailable`    — configured, but no cache and the live fetch failed.
 * - `ready`          — voices available (fresh or stale-with-warning).
 */
@Injectable()
export class ElevenLabsVoiceCatalogService {
  private readonly logger = new Logger(ElevenLabsVoiceCatalogService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async getCatalog(): Promise<ElevenLabsVoiceCatalogResult> {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      ELEVENLABS_PROVIDER_KEY
    ]);
    if (keyMetadata[ELEVENLABS_PROVIDER_KEY]?.configured !== true) {
      return this.emptyResult(false, "not_configured", null);
    }

    const apiKey = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueByProviderKey(ELEVENLABS_PROVIDER_KEY)
      .catch(() => null);
    if (apiKey === null || apiKey.trim().length === 0) {
      return this.emptyResult(false, "not_configured", null);
    }

    const cached = await this.readCacheRow();
    if (cached !== null && !this.isExpired(cached.fetchedAt)) {
      return this.toResult(cached, null);
    }

    const refreshed = await this.refreshVoiceCatalog(apiKey.trim());
    if (refreshed !== null) {
      return this.toResult(refreshed, null);
    }

    if (cached !== null) {
      return this.toResult(cached, "Showing the last known ElevenLabs voices; a refresh failed.");
    }

    return this.emptyResult(true, "unavailable", "Unable to load ElevenLabs voices right now.");
  }

  private async refreshVoiceCatalog(apiKey: string): Promise<CachedVoiceCatalogRow | null> {
    try {
      const voices = await this.fetchVoiceCatalog(apiKey);
      if (voices.length === 0) {
        this.logger.warn("[elevenlabs-voice-catalog] refresh returned an empty voice catalog.");
        return null;
      }
      const fetchedAt = new Date();
      await this.prisma.platformElevenlabsVoiceCatalogCache.upsert({
        where: { cacheKey: ELEVENLABS_VOICE_CACHE_KEY },
        create: {
          cacheKey: ELEVENLABS_VOICE_CACHE_KEY,
          voicesJson: voices as never,
          fetchedAt
        },
        update: {
          voicesJson: voices as never,
          fetchedAt
        }
      });
      this.logger.log(
        `[elevenlabs-voice-catalog] refreshed catalog count=${String(voices.length)} fetchedAt=${fetchedAt.toISOString()}`
      );
      return { voices, fetchedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[elevenlabs-voice-catalog] refresh failed: ${message}`);
      return null;
    }
  }

  private async fetchVoiceCatalog(apiKey: string): Promise<ElevenLabsVoiceCatalogEntry[]> {
    const { signal, dispose } = this.createTimedSignal(ELEVENLABS_VOICE_LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`${ELEVENLABS_API_BASE_URL}/v1/voices`, {
        headers: { "xi-api-key": apiKey },
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
      return this.normalizeEntries(
        voices
          .map((voice) => this.parseVoiceRow(voice))
          .filter((voice): voice is ElevenLabsVoiceCatalogEntry => voice !== null)
      );
    } finally {
      dispose();
    }
  }

  private parseVoiceRow(value: unknown): ElevenLabsVoiceCatalogEntry | null {
    const row = this.asObject(value);
    if (row === null) {
      return null;
    }
    const voiceId = this.asNonEmptyString(row.voice_id);
    const name = this.asNonEmptyString(row.name);
    if (voiceId === null || name === null) {
      return null;
    }
    const labels = this.asObject(row.labels);
    const fineTuning = this.asObject(row.fine_tuning);
    const language =
      this.asNonEmptyString(labels?.language) ??
      this.asNonEmptyString(fineTuning?.language) ??
      this.asNonEmptyString(labels?.accent);
    return {
      voiceId,
      name,
      gender: this.normalizeGender(labels?.gender),
      category: this.asNonEmptyString(row.category),
      language,
      languageBucket: this.toLanguageBucket(language),
      previewUrl: this.asNonEmptyString(row.preview_url)
    };
  }

  private normalizeEntries(entries: ElevenLabsVoiceCatalogEntry[]): ElevenLabsVoiceCatalogEntry[] {
    const deduped = new Map<string, ElevenLabsVoiceCatalogEntry>();
    for (const entry of entries) {
      const key = entry.voiceId.trim().toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, entry);
      }
    }
    return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private toResult(
    row: CachedVoiceCatalogRow,
    warning: string | null
  ): ElevenLabsVoiceCatalogResult {
    return {
      configured: true,
      loadState: "ready",
      voices: row.voices,
      warning
    };
  }

  private emptyResult(
    configured: boolean,
    loadState: "not_configured" | "unavailable",
    warning: string | null
  ): ElevenLabsVoiceCatalogResult {
    return {
      configured,
      loadState,
      voices: [],
      warning
    };
  }

  private async readCacheRow(): Promise<CachedVoiceCatalogRow | null> {
    const row = await this.prisma.platformElevenlabsVoiceCatalogCache.findUnique({
      where: { cacheKey: ELEVENLABS_VOICE_CACHE_KEY },
      select: { voicesJson: true, fetchedAt: true }
    });
    if (row === null) {
      return null;
    }
    return {
      voices: this.parseCachedVoices(row.voicesJson),
      fetchedAt: row.fetchedAt
    };
  }

  private parseCachedVoices(value: unknown): ElevenLabsVoiceCatalogEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const entries: ElevenLabsVoiceCatalogEntry[] = [];
    for (const candidate of value) {
      const row = this.asObject(candidate);
      if (row === null) {
        continue;
      }
      const voiceId = this.asNonEmptyString(row.voiceId);
      const name = this.asNonEmptyString(row.name);
      if (voiceId === null || name === null) {
        continue;
      }
      const language = this.asNonEmptyString(row.language);
      entries.push({
        voiceId,
        name,
        gender: this.normalizeGender(row.gender),
        category: this.asNonEmptyString(row.category),
        language,
        languageBucket: this.toLanguageBucket(language),
        previewUrl: this.asNonEmptyString(row.previewUrl)
      });
    }
    return this.normalizeEntries(entries);
  }

  private toLanguageBucket(language: string | null): ElevenLabsVoiceLanguageBucket {
    const normalized = language?.trim().toLowerCase() ?? "";
    if (
      normalized === "ru" ||
      normalized.startsWith("ru-") ||
      normalized === "russian" ||
      normalized.startsWith("russian")
    ) {
      return "ru";
    }
    if (
      normalized === "en" ||
      normalized.startsWith("en-") ||
      normalized === "english" ||
      normalized.startsWith("english")
    ) {
      return "en";
    }
    return "other";
  }

  private normalizeGender(value: unknown): ElevenLabsVoiceGenderTag {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "male" || normalized === "female" || normalized === "neutral") {
      return normalized;
    }
    return "unknown";
  }

  private isExpired(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > ELEVENLABS_VOICE_CACHE_TTL_MS;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
