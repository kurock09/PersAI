import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  RuntimeVideoVoiceCatalog,
  RuntimeVideoVoiceCatalogEntry,
  RuntimeVideoVoiceGender
} from "@persai/runtime-contract";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const KLING_API_BASE_URL = "https://api-singapore.klingai.com";
const KLING_PRESETS_VOICES_PATH = "/v1/general/presets-voices";
const KLING_VOICE_CACHE_KEY = "kling-presets-voices";
const KLING_VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KLING_JWT_TTL_SECONDS = 1_800;
const KLING_JWT_NOT_BEFORE_SKEW_SECONDS = 5;

type KlingCredentials = {
  accessKey: string;
  secretKey: string;
};

type CachedVoiceCatalogRow = {
  voices: RuntimeVideoVoiceCatalogEntry[];
  fetchedAt: Date;
};

@Injectable()
export class KlingVoiceCatalogService {
  private readonly logger = new Logger(KlingVoiceCatalogService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async getMaterializedVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null> {
    const cached = await this.readCacheRow();
    if (cached !== null && !this.isExpired(cached.fetchedAt)) {
      return {
        provider: "kling",
        fetchedAt: cached.fetchedAt.toISOString(),
        shortlist: cached.voices
      };
    }
    return this.refreshVoiceCatalog();
  }

  private async refreshVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null> {
    const credentialValue = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueById(TOOL_CREDENTIAL_IDS.tool_video_generate_kling)
      .catch(() => null);
    if (credentialValue === null) {
      this.logger.warn(
        "[kling-voice-catalog] Kling credentials are not configured; voice catalog is empty."
      );
      return this.toCatalog(await this.readCacheRow());
    }

    try {
      const credentials = this.resolveCredentials(credentialValue);
      const shortlist = await this.fetchVoiceCatalog(credentials);
      if (shortlist.length === 0) {
        this.logger.warn("[kling-voice-catalog] refresh returned an empty shortlist.");
        return this.toCatalog(await this.readCacheRow());
      }
      const fetchedAt = new Date();
      await this.prisma.platformKlingVoiceCatalogCache.upsert({
        where: { cacheKey: KLING_VOICE_CACHE_KEY },
        create: {
          cacheKey: KLING_VOICE_CACHE_KEY,
          voicesJson: shortlist as never,
          fetchedAt
        },
        update: {
          voicesJson: shortlist as never,
          fetchedAt
        }
      });
      this.logger.log(
        `[kling-voice-catalog] refreshed shortlist count=${String(shortlist.length)} fetchedAt=${fetchedAt.toISOString()}`
      );
      return {
        provider: "kling",
        fetchedAt: fetchedAt.toISOString(),
        shortlist
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[kling-voice-catalog] refresh failed: ${message}`);
      return this.toCatalog(await this.readCacheRow());
    }
  }

  private async fetchVoiceCatalog(
    credentials: KlingCredentials
  ): Promise<RuntimeVideoVoiceCatalogEntry[]> {
    const authToken = this.createAuthToken(credentials);
    const url = new URL(KLING_PRESETS_VOICES_PATH, KLING_API_BASE_URL);
    url.searchParams.set("pageNum", "1");
    url.searchParams.set("pageSize", "100");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json"
      }
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(`Kling presets-voices HTTP ${String(response.status)}`);
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
    const candidates = [record.data, record.rows, record.list, record.voice_list, record.voices];
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
      this.asNonEmptyString(row.voice_name) ??
      this.asNonEmptyString(row.voiceName) ??
      this.asNonEmptyString(row.name) ??
      providerVoiceId;
    if (providerVoiceId === null || displayName === null) {
      return null;
    }
    const locale =
      this.asNonEmptyString(row.voice_language) ??
      this.asNonEmptyString(row.voiceLanguage) ??
      this.asNonEmptyString(row.language);
    const styleTags = this.readStyleTags(row);
    return {
      voiceKey: this.buildVoiceKey(displayName, providerVoiceId),
      providerVoiceId,
      displayName,
      locale,
      gender: this.normalizeGender(row.gender ?? row.voice_gender ?? row.sex),
      description: this.buildDescription(locale, styleTags),
      styleTags
    };
  }

  private readStyleTags(row: Record<string, unknown>): string[] {
    const raw = row.style_tags ?? row.tags ?? row.styles ?? row.style;
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
    const row = await this.prisma.platformKlingVoiceCatalogCache.findUnique({
      where: { cacheKey: KLING_VOICE_CACHE_KEY },
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
          : []
      });
    }
    return entries;
  }

  private toCatalog(row: CachedVoiceCatalogRow | null): RuntimeVideoVoiceCatalog | null {
    if (row === null || row.voices.length === 0) {
      return null;
    }
    return {
      provider: "kling",
      fetchedAt: row.fetchedAt.toISOString(),
      shortlist: row.voices
    };
  }

  private isExpired(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > KLING_VOICE_CACHE_TTL_MS;
  }

  private resolveCredentials(credentialValue: string): KlingCredentials {
    let parsed: unknown;
    try {
      parsed = JSON.parse(credentialValue);
    } catch {
      throw new Error(
        'Kling credentials must be valid JSON: {"accessKey":"...","secretKey":"..."}.'
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        'Kling credentials must be a JSON object with "accessKey" and "secretKey" string fields.'
      );
    }
    const accessKey =
      this.asNonEmptyString((parsed as Record<string, unknown>).accessKey) ??
      this.asNonEmptyString((parsed as Record<string, unknown>).access_key);
    const secretKey =
      this.asNonEmptyString((parsed as Record<string, unknown>).secretKey) ??
      this.asNonEmptyString((parsed as Record<string, unknown>).secret_key);
    if (accessKey === null || secretKey === null) {
      throw new Error(
        'Kling credentials JSON must include non-empty "accessKey" and "secretKey" string fields.'
      );
    }
    return {
      accessKey,
      secretKey
    };
  }

  private createAuthToken(credentials: KlingCredentials): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = {
      alg: "HS256",
      typ: "JWT"
    };
    const payload = {
      iss: credentials.accessKey,
      exp: nowSeconds + KLING_JWT_TTL_SECONDS,
      nbf: nowSeconds - KLING_JWT_NOT_BEFORE_SKEW_SECONDS
    };
    const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", credentials.secretKey)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
