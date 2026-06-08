import { Injectable, Logger } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_PROVIDER_KEY = "tool_tts_elevenlabs";
const ELEVENLABS_VOICE_CACHE_KEY = "elevenlabs-shared-voices-v2";
const ELEVENLABS_VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ELEVENLABS_VOICE_LOAD_TIMEOUT_MS = 10_000;
const ELEVENLABS_VOICE_BUCKET_LIMIT = 12;
const ELEVENLABS_VOICE_BUCKET_HALF_LIMIT = ELEVENLABS_VOICE_BUCKET_LIMIT / 2;
const ELEVENLABS_SHARED_VOICE_PAGE_SIZE = 100;

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

type SharedVoiceSearchBucket = "ru" | "en" | "other";

type SharedVoiceSearchGender = "female" | "male" | "neutral";

type ParsedSharedVoiceRow = ElevenLabsVoiceCatalogEntry & {
  featured: boolean;
  popularityScore: number;
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
    const buckets: SharedVoiceSearchBucket[] = ["ru", "en", "other"];
    const genders: SharedVoiceSearchGender[] = ["female", "male", "neutral"];
    const entries = await Promise.all(
      buckets.flatMap((bucket) =>
        genders.map((gender) => this.fetchCuratedSharedVoicesForBucket(apiKey, bucket, gender))
      )
    );

    return this.normalizeEntries(entries.flat());
  }

  private async fetchCuratedSharedVoicesForBucket(
    apiKey: string,
    bucket: SharedVoiceSearchBucket,
    gender: SharedVoiceSearchGender
  ): Promise<ElevenLabsVoiceCatalogEntry[]> {
    const [featuredRows, popularRows] = await Promise.all([
      this.fetchSharedVoiceRows(apiKey, { bucket, gender, featured: true }),
      this.fetchSharedVoiceRows(apiKey, { bucket, gender, featured: false })
    ]);
    const featured = featuredRows
      .filter((voice) => voice.featured)
      .slice(0, ELEVENLABS_VOICE_BUCKET_HALF_LIMIT);
    const popular = popularRows
      .filter((voice) => voice.popularityScore > 0)
      .sort((left, right) => right.popularityScore - left.popularityScore)
      .slice(0, ELEVENLABS_VOICE_BUCKET_HALF_LIMIT);

    const selected = this.dedupeSharedRows([...featured, ...popular]);
    if (selected.length < ELEVENLABS_VOICE_BUCKET_LIMIT) {
      selected.push(
        ...this.dedupeSharedRows([...featuredRows, ...popularRows]).filter(
          (candidate) => !selected.some((voice) => voice.voiceId === candidate.voiceId)
        )
      );
    }

    return selected.slice(0, ELEVENLABS_VOICE_BUCKET_LIMIT).map((voice) => ({
      voiceId: voice.voiceId,
      name: voice.name,
      gender: voice.gender,
      category: voice.category,
      language: voice.language,
      languageBucket: voice.languageBucket,
      previewUrl: voice.previewUrl
    }));
  }

  private async fetchSharedVoiceRows(
    apiKey: string,
    input: {
      bucket: SharedVoiceSearchBucket;
      gender: SharedVoiceSearchGender;
      featured: boolean;
    }
  ): Promise<ParsedSharedVoiceRow[]> {
    const { signal, dispose } = this.createTimedSignal(ELEVENLABS_VOICE_LOAD_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({
        page_size: String(ELEVENLABS_SHARED_VOICE_PAGE_SIZE)
      });
      if (input.featured) {
        params.set("featured", "true");
      }
      if (input.gender !== "neutral") {
        params.set("gender", input.gender);
      }
      if (input.bucket !== "other") {
        params.set("language", input.bucket);
      }
      const response = await fetch(
        `${ELEVENLABS_API_BASE_URL}/v1/shared-voices?${params.toString()}`,
        {
          headers: { "xi-api-key": apiKey, Accept: "application/json" },
          signal
        }
      );
      if (!response.ok) {
        throw new Error(
          `ElevenLabs shared voices request failed with status ${String(response.status)}.`
        );
      }
      const payload = (await response.json()) as unknown;
      const voices = this.asObject(payload)?.voices;
      if (!Array.isArray(voices)) {
        return [];
      }
      return voices
        .map((voice) => this.parseSharedVoiceRow(voice, input.gender))
        .filter((voice): voice is ParsedSharedVoiceRow => voice !== null)
        .filter((voice) => input.gender === "neutral" || voice.gender === input.gender)
        .filter((voice) => voice.languageBucket === input.bucket);
    } finally {
      dispose();
    }
  }

  private parseSharedVoiceRow(
    value: unknown,
    requestedGender: SharedVoiceSearchGender
  ): ParsedSharedVoiceRow | null {
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
    const language = this.resolveVoiceLanguage(row, labels);
    return {
      voiceId,
      name,
      gender: this.normalizeGender(labels?.gender, requestedGender),
      category: this.asNonEmptyString(row.category),
      language,
      languageBucket: this.toLanguageBucket(language),
      previewUrl: this.asNonEmptyString(row.preview_url),
      featured: row.featured === true,
      popularityScore: this.asNumber(row.cloned_by_count) + this.asNumber(row.liked_by_count)
    };
  }

  private dedupeSharedRows(entries: ParsedSharedVoiceRow[]): ParsedSharedVoiceRow[] {
    const deduped = new Map<string, ParsedSharedVoiceRow>();
    for (const entry of entries) {
      const key = entry.voiceId.trim().toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, entry);
      }
    }
    return [...deduped.values()];
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

  private resolveVoiceLanguage(
    row: Record<string, unknown>,
    labels: Record<string, unknown> | null
  ): string | null {
    const fineTuning = this.asObject(row.fine_tuning);
    const verifiedLanguages = Array.isArray(row.verified_languages) ? row.verified_languages : [];
    const firstVerifiedLanguage = this.asObject(verifiedLanguages[0]);
    return (
      this.asNonEmptyString(labels?.language) ??
      this.asNonEmptyString(firstVerifiedLanguage?.language) ??
      this.asNonEmptyString(firstVerifiedLanguage?.locale) ??
      this.asNonEmptyString(fineTuning?.language) ??
      this.asNonEmptyString(labels?.accent)
    );
  }

  private normalizeGender(
    value: unknown,
    fallback: ElevenLabsVoiceGenderTag = "unknown"
  ): ElevenLabsVoiceGenderTag {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "male" || normalized === "female" || normalized === "neutral") {
      return normalized;
    }
    return fallback;
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

  private asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
