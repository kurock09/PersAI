import { Injectable, Logger } from "@nestjs/common";
import type {
  RuntimeVideoVoiceCatalog,
  RuntimeVideoVoiceCatalogEntry,
  RuntimeVideoVoiceGender,
  RuntimeVideoVoiceQualityTag,
  RuntimeVideoVoiceSource
} from "@persai/runtime-contract";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const HEYGEN_VOICES_URL = "https://api.heygen.com/v3/voices";
export const HEYGEN_VOICE_CACHE_KEY = "heygen-voices-avatar-v";
const HEYGEN_VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HEYGEN_VOICE_SHORTLIST_LIMIT = 24;
const PREFERRED_VOICE_LANGUAGES = ["ru", "en"] as const;
const HEYGEN_VOICE_PAGE_LIMIT = 100;
const HEYGEN_VOICE_MAX_PAGES = 100;
const HEYGEN_VOICE_ENGINE = "avatar_v";
const HEYGEN_VOICE_TYPES = ["public", "private"] as const;
const GOOD_QUALITY_TAGS: RuntimeVideoVoiceQualityTag[] = ["professional", "natural", "lifelike"];

type CachedVoiceCatalogRow = {
  voices: RuntimeVideoVoiceCatalogEntry[];
  fetchedAt: Date;
};

@Injectable()
export class HeyGenVoiceCatalogService {
  private readonly logger = new Logger(HeyGenVoiceCatalogService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async getMaterializedVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null> {
    return this.toCatalog(await this.ensureFreshCacheRow());
  }

  async getFullVoiceCatalogEntries(): Promise<RuntimeVideoVoiceCatalogEntry[]> {
    const row = await this.ensureFreshCacheRow();
    return row?.voices ?? [];
  }

  async forceRefreshVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null> {
    return this.toCatalog(await this.refreshVoiceCatalog());
  }

  private async ensureFreshCacheRow(): Promise<CachedVoiceCatalogRow | null> {
    const cached = await this.readCacheRow();
    if (cached !== null && !this.isExpired(cached.fetchedAt)) {
      return cached;
    }
    return this.refreshVoiceCatalog();
  }

  private async refreshVoiceCatalog(): Promise<CachedVoiceCatalogRow | null> {
    const apiKey = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueById(TOOL_CREDENTIAL_IDS.tool_video_generate_heygen)
      .catch(() => null);
    if (apiKey === null || apiKey.trim().length === 0) {
      this.logger.warn(
        "[heygen-voice-catalog] HeyGen API key is not configured; voice catalog is empty."
      );
      return this.readCacheRow();
    }

    try {
      const voices = await this.fetchVoiceCatalog(apiKey.trim());
      if (voices.length === 0) {
        this.logger.warn("[heygen-voice-catalog] refresh returned an empty voice catalog.");
        return this.readCacheRow();
      }
      const fetchedAt = new Date();
      await this.prisma.platformHeygenVoiceCatalogCache.upsert({
        where: { cacheKey: HEYGEN_VOICE_CACHE_KEY },
        create: {
          cacheKey: HEYGEN_VOICE_CACHE_KEY,
          voicesJson: voices as never,
          fetchedAt
        },
        update: {
          voicesJson: voices as never,
          fetchedAt
        }
      });
      const shortlist = this.buildShortlist(voices);
      this.logger.log(
        `[heygen-voice-catalog] refreshed catalog count=${String(voices.length)} shortlist=${String(shortlist.length)} fetchedAt=${fetchedAt.toISOString()}`
      );
      return {
        voices,
        fetchedAt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[heygen-voice-catalog] refresh failed: ${message}`);
      return this.readCacheRow();
    }
  }

  private async fetchVoiceCatalog(apiKey: string): Promise<RuntimeVideoVoiceCatalogEntry[]> {
    const pages = (
      await Promise.all(
        HEYGEN_VOICE_TYPES.map((voiceType) => this.fetchVoiceCatalogPages(apiKey, voiceType))
      )
    ).flat();
    return this.parseVoiceCatalogPages(pages);
  }

  private async fetchVoiceCatalogPages(
    apiKey: string,
    voiceType: (typeof HEYGEN_VOICE_TYPES)[number]
  ): Promise<unknown[]> {
    const pages: unknown[] = [];
    let nextToken: string | null = null;
    const seenTokens = new Set<string>();
    for (let page = 0; page < HEYGEN_VOICE_MAX_PAGES; page += 1) {
      const url = new URL(HEYGEN_VOICES_URL);
      url.searchParams.set("limit", String(HEYGEN_VOICE_PAGE_LIMIT));
      url.searchParams.set("type", voiceType);
      if (nextToken !== null) {
        url.searchParams.set("token", nextToken);
      }
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json"
        }
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(`HeyGen voices HTTP ${String(response.status)}`);
      }
      pages.push(body);
      nextToken = this.extractNextToken(body);
      if (nextToken !== null) {
        if (seenTokens.has(nextToken)) {
          this.logger.warn(
            `[heygen-voice-catalog] repeated pagination token detected after ${String(page + 1)} page(s); stopping early.`
          );
          break;
        }
        seenTokens.add(nextToken);
      }
      if (nextToken === null) {
        break;
      }
    }
    return pages;
  }

  private parseVoiceCatalogPages(values: unknown[]): RuntimeVideoVoiceCatalogEntry[] {
    const rows = values.flatMap((value) => this.extractVoiceRows(value));
    const parsed = rows
      .map((row) => this.parseVoiceRow(row))
      .filter((entry): entry is RuntimeVideoVoiceCatalogEntry => entry !== null);
    return this.expandMultiLanguageEntries(this.normalizeEntries(parsed));
  }

  private buildShortlist(
    entries: RuntimeVideoVoiceCatalogEntry[]
  ): RuntimeVideoVoiceCatalogEntry[] {
    const normalized = this.sortForQuality(this.normalizeEntries(entries));
    const byLanguage = new Map<string, RuntimeVideoVoiceCatalogEntry[]>();
    for (const entry of normalized) {
      const language = this.normalizeLanguageBucket(entry.locale);
      const bucket = byLanguage.get(language) ?? [];
      bucket.push(entry);
      byLanguage.set(language, bucket);
    }

    const shortlist: RuntimeVideoVoiceCatalogEntry[] = [];
    const seenProviderIds = new Set<string>();
    const take = (entry: RuntimeVideoVoiceCatalogEntry) => {
      const key = entry.providerVoiceId.trim().toLowerCase();
      if (seenProviderIds.has(key) || shortlist.length >= HEYGEN_VOICE_SHORTLIST_LIMIT) {
        return;
      }
      seenProviderIds.add(key);
      shortlist.push(entry);
    };

    for (const language of PREFERRED_VOICE_LANGUAGES) {
      const bucket = byLanguage.get(language) ?? [];
      for (const entry of this.balanceGender(this.sortForQuality(bucket)).slice(0, 12)) {
        take(entry);
      }
    }

    for (const entry of this.sortForQuality(normalized)) {
      take(entry);
    }

    return shortlist;
  }

  private normalizeEntries(
    entries: RuntimeVideoVoiceCatalogEntry[]
  ): RuntimeVideoVoiceCatalogEntry[] {
    const deduped = new Map<string, RuntimeVideoVoiceCatalogEntry>();
    for (const entry of entries) {
      const key = entry.providerVoiceId.trim().toLowerCase();
      const variantKey = `${key}:${entry.voiceKey.trim().toLowerCase()}:${entry.locale ?? ""}`;
      if (!deduped.has(variantKey)) {
        deduped.set(variantKey, entry);
      }
    }
    return [...deduped.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
  }

  private sortForQuality(
    entries: RuntimeVideoVoiceCatalogEntry[]
  ): RuntimeVideoVoiceCatalogEntry[] {
    return [...entries].sort((left, right) => {
      const rankDelta = this.resolveQualityRank(right) - this.resolveQualityRank(left);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      const sourceDelta = this.sourceRank(right.source) - this.sourceRank(left.source);
      if (sourceDelta !== 0) {
        return sourceDelta;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }

  private resolveQualityRank(entry: RuntimeVideoVoiceCatalogEntry): number {
    return typeof entry.qualityRank === "number" ? entry.qualityRank : 0;
  }

  private sourceRank(source: RuntimeVideoVoiceSource | undefined): number {
    if (source === "elevenlabs") return 3;
    if (source === "heygen") return 2;
    if (source === "gemini") return 1;
    return 0;
  }

  private balanceGender(entries: RuntimeVideoVoiceCatalogEntry[]): RuntimeVideoVoiceCatalogEntry[] {
    const preferredOrder: RuntimeVideoVoiceGender[] = ["female", "male", "neutral", "unknown"];
    const grouped = new Map<RuntimeVideoVoiceGender, RuntimeVideoVoiceCatalogEntry[]>();
    for (const gender of preferredOrder) {
      grouped.set(gender, []);
    }
    for (const entry of entries) {
      grouped.get(entry.gender)?.push(entry);
    }
    const result: RuntimeVideoVoiceCatalogEntry[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const gender of preferredOrder) {
        const next = grouped.get(gender)?.shift() ?? null;
        if (next !== null) {
          result.push(next);
          progressed = true;
        }
      }
    }
    return result;
  }

  private normalizeLanguageBucket(locale: string | null): string {
    const normalized = locale?.trim().toLowerCase() ?? "";
    if (this.isMultiLanguageLocale(normalized)) {
      return "multi";
    }
    if (
      normalized === "ru" ||
      normalized.startsWith("ru-") ||
      normalized === "russian" ||
      normalized.startsWith("russian ")
    ) {
      return "ru";
    }
    if (
      normalized === "en" ||
      normalized.startsWith("en-") ||
      normalized === "english" ||
      normalized.startsWith("english ")
    ) {
      return "en";
    }
    return "other";
  }

  private expandMultiLanguageEntries(
    entries: RuntimeVideoVoiceCatalogEntry[]
  ): RuntimeVideoVoiceCatalogEntry[] {
    const expanded: RuntimeVideoVoiceCatalogEntry[] = [];
    for (const entry of entries) {
      if (!this.isMultiLanguageLocale(entry.locale)) {
        expanded.push(entry);
        continue;
      }
      expanded.push(
        this.withLocaleVariant(entry, "ru", "ru"),
        this.withLocaleVariant(entry, "en", "en")
      );
    }
    return expanded;
  }

  private withLocaleVariant(
    entry: RuntimeVideoVoiceCatalogEntry,
    locale: "ru" | "en",
    suffix: string
  ): RuntimeVideoVoiceCatalogEntry {
    return {
      ...entry,
      voiceKey: `${entry.voiceKey}-${suffix}`,
      locale,
      description: this.buildDescription(locale, entry.styleTags)
    };
  }

  private isMultiLanguageLocale(locale: string | null): boolean {
    const normalized = locale?.trim().toLowerCase() ?? "";
    return (
      normalized === "multi" ||
      normalized === "multilingual" ||
      normalized === "multi-language" ||
      normalized === "multi language" ||
      normalized === "multilanguage" ||
      normalized.includes("multilingual") ||
      normalized.includes("multi-language") ||
      normalized.includes("multi language")
    );
  }

  private extractNextToken(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    return this.asNonEmptyString(record.next_token) ?? this.asNonEmptyString(record.nextToken);
  }

  private extractVoiceRows(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return this.extractVoiceRowsFromArray(value);
    }
    if (value === null || typeof value !== "object") {
      return [];
    }
    const record = value as Record<string, unknown>;
    const candidates = [record.data, record.rows, record.list, record.voices, record.voice_list];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return this.extractVoiceRowsFromArray(candidate);
      }
      if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
        const nested = candidate as Record<string, unknown>;
        for (const nestedCandidate of [
          nested.list,
          nested.rows,
          nested.voice_list,
          nested.voices,
          nested.items
        ]) {
          if (Array.isArray(nestedCandidate)) {
            return nestedCandidate;
          }
        }
      }
    }
    return [];
  }

  private extractVoiceRowsFromArray(rows: unknown[]): unknown[] {
    const directVoices = rows.filter((row) => this.parseVoiceRow(row) !== null);
    if (directVoices.length > 0) {
      return directVoices;
    }
    return rows.flatMap((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        return [];
      }
      const record = row as Record<string, unknown>;
      const taskResult = record.task_result;
      if (taskResult !== null && typeof taskResult === "object" && !Array.isArray(taskResult)) {
        const voices = (taskResult as Record<string, unknown>).voices;
        return Array.isArray(voices) ? voices : [];
      }
      return [];
    });
  }

  private parseVoiceRow(value: unknown): RuntimeVideoVoiceCatalogEntry | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const providerVoiceId =
      this.asNonEmptyString(row.voice_id) ??
      this.asNonEmptyString(row.voiceId) ??
      this.asNonEmptyString(row.id);
    const displayName =
      this.asNonEmptyString(row.name) ??
      this.asNonEmptyString(row.voice_name) ??
      this.asNonEmptyString(row.voiceName) ??
      providerVoiceId;
    if (providerVoiceId === null || displayName === null) {
      return null;
    }
    if (!this.isUsableVideoVoiceRow(row)) {
      return null;
    }
    const rawLocale =
      this.asNonEmptyString(row.language) ??
      this.asNonEmptyString(row.voice_language) ??
      this.asNonEmptyString(row.voiceLanguage) ??
      this.asNonEmptyString(row.locale);
    const styleTags = this.readStyleTags(row);
    const previewAudioUrl =
      this.asNonEmptyString(row.preview_audio) ??
      this.asNonEmptyString(row.previewAudio) ??
      this.asNonEmptyString(row.preview_audio_url) ??
      this.asNonEmptyString(row.previewAudioUrl) ??
      null;
    const source = this.detectVoiceSource(row, displayName, previewAudioUrl);
    const locale =
      source === "elevenlabs" && this.isUnknownLocale(rawLocale) ? "Multilingual" : rawLocale;
    const qualityTags = this.detectQualityTags(displayName, row, source);
    const previewAvailable = this.isPreviewLikelyAvailable(previewAudioUrl);
    const localeControl = this.asBoolean(row.support_locale ?? row.supportLocale) ?? false;
    const pauseSupport = this.asBoolean(row.support_pause ?? row.supportPause) ?? false;
    return {
      voiceKey: this.buildVoiceKey(displayName, providerVoiceId),
      providerVoiceId,
      displayName,
      locale,
      gender: this.normalizeGender(row.gender ?? row.voice_gender ?? row.sex),
      description: this.buildDescription(locale, styleTags),
      styleTags,
      previewAudioUrl,
      source,
      qualityTags,
      qualityRank: this.buildQualityRank({
        source,
        qualityTags,
        previewAvailable,
        localeControl,
        pauseSupport
      }),
      previewAvailable,
      localeControl,
      pauseSupport
    };
  }

  private isUsableVideoVoiceRow(row: Record<string, unknown>): boolean {
    const type = this.asNonEmptyString(row.type)?.toLowerCase() ?? null;
    if (type !== null && type !== "public" && type !== "private") {
      return false;
    }

    const status =
      this.asNonEmptyString(row.status) ??
      this.asNonEmptyString(row.state) ??
      this.asNonEmptyString(row.voice_status) ??
      this.asNonEmptyString(row.voiceStatus);
    if (
      status !== null &&
      !["ready", "active", "available", "completed"].includes(status.toLowerCase())
    ) {
      return false;
    }

    for (const field of [
      "available",
      "is_available",
      "isAvailable",
      "enabled",
      "disabled",
      "archived"
    ]) {
      if (field in row && typeof row[field] === "boolean") {
        const value = row[field];
        if ((field === "disabled" || field === "archived") && value === true) {
          return false;
        }
        if (
          (field === "available" ||
            field === "is_available" ||
            field === "isAvailable" ||
            field === "enabled") &&
          value === false
        ) {
          return false;
        }
      }
    }

    const engines = this.readEngineList(row);
    return engines.length === 0 || engines.includes(HEYGEN_VOICE_ENGINE);
  }

  private readEngineList(row: Record<string, unknown>): string[] {
    const raw =
      row.engine ??
      row.engines ??
      row.supported_engines ??
      row.supportedEngines ??
      row.supported_api_engines ??
      row.supportedApiEngines;
    const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s/]+/) : [];
    return values
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => value.length > 0);
  }

  private readStyleTags(row: Record<string, unknown>): string[] {
    const raw = row.tags ?? row.style_tags ?? row.styles ?? row.style;
    if (Array.isArray(raw)) {
      return raw
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().toLowerCase())
        .slice(0, 4);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw
        .split(/[,\s/]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
        .slice(0, 4);
    }
    return [];
  }

  private isUnknownLocale(value: string | null): boolean {
    if (value === null) {
      return true;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 || normalized === "unknown";
  }

  private detectVoiceSource(
    row: Record<string, unknown>,
    displayName: string,
    previewAudioUrl: string | null
  ): RuntimeVideoVoiceSource {
    const joined = [
      displayName,
      previewAudioUrl ?? "",
      this.asNonEmptyString(row.provider),
      this.asNonEmptyString(row.source),
      this.asNonEmptyString(row.vendor),
      this.asNonEmptyString(row.provider_name),
      this.asNonEmptyString(row.providerName)
    ]
      .filter((value): value is string => value !== null)
      .join(" ")
      .toLowerCase();
    if (this.asNonEmptyString(row.type)?.toLowerCase() === "private") {
      return "elevenlabs";
    }
    if (joined.includes("eleven")) {
      return "elevenlabs";
    }
    if (joined.includes("gemini")) {
      return "gemini";
    }
    if (joined.includes("heygen")) {
      return "heygen";
    }
    return "heygen";
  }

  private detectQualityTags(
    displayName: string,
    row: Record<string, unknown>,
    source: RuntimeVideoVoiceSource
  ): RuntimeVideoVoiceQualityTag[] {
    const rawTags = this.readStyleTags(row);
    const haystack = [displayName, ...rawTags].join(" ").toLowerCase();
    const tags = GOOD_QUALITY_TAGS.filter((tag) => haystack.includes(tag));
    if (source === "elevenlabs" && tags.length === 0) {
      return ["professional"];
    }
    return tags;
  }

  private isPreviewLikelyAvailable(previewAudioUrl: string | null): boolean {
    if (previewAudioUrl === null) {
      return false;
    }
    const normalized = previewAudioUrl.trim().toLowerCase();
    if (normalized.length === 0) {
      return false;
    }
    return !normalized.includes("static.heygen.ai/voice_preview/gemini/");
  }

  private buildQualityRank(input: {
    source: RuntimeVideoVoiceSource;
    qualityTags: RuntimeVideoVoiceQualityTag[];
    previewAvailable: boolean;
    localeControl: boolean;
    pauseSupport: boolean;
  }): number {
    let rank = 0;
    if (input.previewAvailable) rank += 20;
    if (input.source === "elevenlabs") rank += 100;
    if (input.qualityTags.length > 0) rank += 60;
    if (input.pauseSupport) rank += 8;
    if (input.localeControl) rank += 4;
    if (input.source === "gemini" && !input.previewAvailable) rank -= 80;
    return rank;
  }

  private buildDescription(locale: string | null, styleTags: string[]): string | null {
    const parts: string[] = [];
    if (locale !== null) {
      parts.push(locale);
    }
    if (styleTags.length > 0) {
      parts.push(styleTags.join(", "));
    }
    return parts.length > 0 ? parts.join(" | ") : null;
  }

  private buildVoiceKey(displayName: string, providerVoiceId: string): string {
    const normalized = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized.length > 0 ? normalized : providerVoiceId.toLowerCase();
  }

  private normalizeGender(value: unknown): RuntimeVideoVoiceGender {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "male" || normalized === "female" || normalized === "neutral") {
      return normalized;
    }
    return "unknown";
  }

  private async readCacheRow(): Promise<CachedVoiceCatalogRow | null> {
    const row = await this.prisma.platformHeygenVoiceCatalogCache.findUnique({
      where: { cacheKey: HEYGEN_VOICE_CACHE_KEY },
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

  private parseCachedVoices(value: unknown): RuntimeVideoVoiceCatalogEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const entries: RuntimeVideoVoiceCatalogEntry[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const voiceKey = this.asNonEmptyString(row.voiceKey);
      const providerVoiceId = this.asNonEmptyString(row.providerVoiceId);
      const displayName = this.asNonEmptyString(row.displayName);
      if (voiceKey === null || providerVoiceId === null || displayName === null) {
        continue;
      }
      const source = this.normalizeSource(row.source);
      const qualityTags = this.normalizeQualityTags(row.qualityTags);
      const parsed: RuntimeVideoVoiceCatalogEntry = {
        voiceKey,
        providerVoiceId,
        displayName,
        locale: this.asNonEmptyString(row.locale),
        gender: this.normalizeGender(row.gender),
        description: this.asNonEmptyString(row.description),
        styleTags: Array.isArray(row.styleTags)
          ? row.styleTags.filter(
              (tag): tag is string => typeof tag === "string" && tag.trim().length > 0
            )
          : [],
        previewAudioUrl:
          typeof row.previewAudioUrl === "string" && row.previewAudioUrl.trim().length > 0
            ? row.previewAudioUrl.trim()
            : null,
        ...(source === undefined ? {} : { source }),
        ...(qualityTags === undefined ? {} : { qualityTags }),
        ...(typeof row.qualityRank === "number" ? { qualityRank: row.qualityRank } : {}),
        ...(typeof row.previewAvailable === "boolean"
          ? { previewAvailable: row.previewAvailable }
          : {}),
        ...(typeof row.localeControl === "boolean" ? { localeControl: row.localeControl } : {}),
        ...(typeof row.pauseSupport === "boolean" ? { pauseSupport: row.pauseSupport } : {})
      };
      entries.push(parsed);
    }
    return entries;
  }

  private toCatalog(row: CachedVoiceCatalogRow | null): RuntimeVideoVoiceCatalog | null {
    if (row === null || row.voices.length === 0) {
      return null;
    }
    return {
      provider: "heygen",
      fetchedAt: row.fetchedAt.toISOString(),
      shortlist: this.buildShortlist(row.voices)
    };
  }

  private isExpired(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > HEYGEN_VOICE_CACHE_TTL_MS;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
  }

  private normalizeSource(value: unknown): RuntimeVideoVoiceSource | undefined {
    if (value === "heygen" || value === "elevenlabs" || value === "gemini" || value === "unknown") {
      return value;
    }
    return undefined;
  }

  private normalizeQualityTags(value: unknown): RuntimeVideoVoiceQualityTag[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value.filter((tag): tag is RuntimeVideoVoiceQualityTag =>
      GOOD_QUALITY_TAGS.includes(tag as RuntimeVideoVoiceQualityTag)
    );
  }
}
