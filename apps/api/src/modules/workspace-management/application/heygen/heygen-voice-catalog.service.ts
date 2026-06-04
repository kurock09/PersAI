import { Injectable, Logger } from "@nestjs/common";
import type {
  RuntimeVideoVoiceCatalog,
  RuntimeVideoVoiceCatalogEntry,
  RuntimeVideoVoiceGender
} from "@persai/runtime-contract";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const HEYGEN_VOICES_URL = "https://api.heygen.com/v3/voices";
const HEYGEN_VOICE_CACHE_KEY = "heygen-voices";
const HEYGEN_VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    const cached = await this.readCacheRow();
    if (cached !== null && !this.isExpired(cached.fetchedAt)) {
      return {
        provider: "heygen",
        fetchedAt: cached.fetchedAt.toISOString(),
        shortlist: cached.voices
      };
    }
    return this.refreshVoiceCatalog();
  }

  private async refreshVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null> {
    const apiKey = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueById(TOOL_CREDENTIAL_IDS.tool_video_generate_heygen)
      .catch(() => null);
    if (apiKey === null || apiKey.trim().length === 0) {
      this.logger.warn(
        "[heygen-voice-catalog] HeyGen API key is not configured; voice catalog is empty."
      );
      return this.toCatalog(await this.readCacheRow());
    }

    try {
      const shortlist = await this.fetchVoiceCatalog(apiKey.trim());
      if (shortlist.length === 0) {
        this.logger.warn("[heygen-voice-catalog] refresh returned an empty shortlist.");
        return this.toCatalog(await this.readCacheRow());
      }
      const fetchedAt = new Date();
      await this.prisma.platformHeygenVoiceCatalogCache.upsert({
        where: { cacheKey: HEYGEN_VOICE_CACHE_KEY },
        create: {
          cacheKey: HEYGEN_VOICE_CACHE_KEY,
          voicesJson: shortlist as never,
          fetchedAt
        },
        update: {
          voicesJson: shortlist as never,
          fetchedAt
        }
      });
      this.logger.log(
        `[heygen-voice-catalog] refreshed shortlist count=${String(shortlist.length)} fetchedAt=${fetchedAt.toISOString()}`
      );
      return {
        provider: "heygen",
        fetchedAt: fetchedAt.toISOString(),
        shortlist
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[heygen-voice-catalog] refresh failed: ${message}`);
      return this.toCatalog(await this.readCacheRow());
    }
  }

  private async fetchVoiceCatalog(apiKey: string): Promise<RuntimeVideoVoiceCatalogEntry[]> {
    const response = await fetch(HEYGEN_VOICES_URL, {
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
    return this.parseVoiceCatalog(body);
  }

  private parseVoiceCatalog(value: unknown): RuntimeVideoVoiceCatalogEntry[] {
    const rows = this.extractVoiceRows(value);
    const parsed = rows
      .map((row) => this.parseVoiceRow(row))
      .filter((entry): entry is RuntimeVideoVoiceCatalogEntry => entry !== null);
    parsed.sort((left, right) => left.displayName.localeCompare(right.displayName));
    return parsed.slice(0, 24);
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
    const locale =
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
    return {
      voiceKey: this.buildVoiceKey(displayName, providerVoiceId),
      providerVoiceId,
      displayName,
      locale,
      gender: this.normalizeGender(row.gender ?? row.voice_gender ?? row.sex),
      description: this.buildDescription(locale, styleTags),
      styleTags,
      previewAudioUrl
    };
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
      entries.push({
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
            : null
      });
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
      shortlist: row.voices
    };
  }

  private isExpired(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > HEYGEN_VOICE_CACHE_TTL_MS;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
