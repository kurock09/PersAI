import { Injectable, Logger } from "@nestjs/common";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import type { GammaThemeCatalogEntry } from "./gamma-theme.types";

const GAMMA_PUBLIC_API_BASE_URL = "https://public-api.gamma.app";
const GAMMA_THEME_CACHE_KEY = "gamma-standard-themes";
const GAMMA_THEME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GAMMA_THEME_PAGE_LIMIT = 50;

type GammaThemesPage = {
  data?: unknown;
  hasMore?: boolean;
  nextCursor?: string | null;
};

@Injectable()
export class GammaThemeCatalogService {
  private readonly logger = new Logger(GammaThemeCatalogService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async listStandardThemes(): Promise<GammaThemeCatalogEntry[]> {
    const cached = await this.readCacheRow();
    if (cached !== null && !this.isExpired(cached.fetchedAt)) {
      return cached.themes.filter((entry) => entry.type === "standard");
    }
    return this.refreshStandardThemes();
  }

  private async refreshStandardThemes(): Promise<GammaThemeCatalogEntry[]> {
    const apiKey = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueById(TOOL_CREDENTIAL_IDS.tool_document_gamma)
      .catch(() => null);
    if (apiKey === null) {
      this.logger.warn(
        "[gamma-theme-catalog] Gamma API key is not configured; theme catalog is empty."
      );
      return cachedThemesFromRow(await this.readCacheRow());
    }

    try {
      const themes = await this.fetchAllStandardThemes(apiKey);
      const fetchedAt = new Date();
      await this.prisma.platformGammaThemeCatalogCache.upsert({
        where: { cacheKey: GAMMA_THEME_CACHE_KEY },
        create: {
          cacheKey: GAMMA_THEME_CACHE_KEY,
          themesJson: themes as never,
          fetchedAt
        },
        update: {
          themesJson: themes as never,
          fetchedAt
        }
      });
      this.logger.log(
        `[gamma-theme-catalog] refreshed standard themes count=${String(themes.length)} fetchedAt=${fetchedAt.toISOString()}`
      );
      return themes;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[gamma-theme-catalog] refresh failed: ${message}`);
      return cachedThemesFromRow(await this.readCacheRow());
    }
  }

  private async fetchAllStandardThemes(apiKey: string): Promise<GammaThemeCatalogEntry[]> {
    const collected: GammaThemeCatalogEntry[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const url = new URL("/v1.0/themes", GAMMA_PUBLIC_API_BASE_URL);
      url.searchParams.set("limit", String(GAMMA_THEME_PAGE_LIMIT));
      if (after !== undefined) {
        url.searchParams.set("after", after);
      }
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-KEY": apiKey,
          Accept: "application/json"
        }
      });
      const body = (await response.json().catch(() => null)) as GammaThemesPage | null;
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body !== null
            ? `Gamma themes HTTP ${String(response.status)}`
            : `Gamma themes HTTP ${String(response.status)}`
        );
      }
      const pageThemes = this.parseThemesPage(body);
      collected.push(...pageThemes);
      const hasMore = body?.hasMore === true;
      const nextCursor =
        typeof body?.nextCursor === "string" && body.nextCursor.trim().length > 0
          ? body.nextCursor.trim()
          : null;
      if (!hasMore || nextCursor === null) {
        break;
      }
      after = nextCursor;
    }
    return collected.filter((entry) => entry.type === "standard");
  }

  private parseThemesPage(body: GammaThemesPage | null): GammaThemeCatalogEntry[] {
    if (body === null || !Array.isArray(body.data)) {
      return [];
    }
    const themes: GammaThemeCatalogEntry[] = [];
    for (const entry of body.data) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (id.length === 0 || name.length === 0) {
        continue;
      }
      const type = row.type === "custom" ? "custom" : "standard";
      themes.push({
        id,
        name,
        type,
        colorKeywords: this.readKeywordArray(row.colorKeywords),
        toneKeywords: this.readKeywordArray(row.toneKeywords)
      });
    }
    return themes;
  }

  private readKeywordArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }

  private async readCacheRow(): Promise<{
    themes: GammaThemeCatalogEntry[];
    fetchedAt: Date;
  } | null> {
    const row = await this.prisma.platformGammaThemeCatalogCache.findUnique({
      where: { cacheKey: GAMMA_THEME_CACHE_KEY },
      select: { themesJson: true, fetchedAt: true }
    });
    if (row === null) {
      return null;
    }
    return {
      themes: this.parseCachedThemes(row.themesJson),
      fetchedAt: row.fetchedAt
    };
  }

  private parseCachedThemes(value: unknown): GammaThemeCatalogEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const themes: GammaThemeCatalogEntry[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (id.length === 0 || name.length === 0) {
        continue;
      }
      themes.push({
        id,
        name,
        type: row.type === "custom" ? "custom" : "standard",
        colorKeywords: this.readKeywordArray(row.colorKeywords),
        toneKeywords: this.readKeywordArray(row.toneKeywords)
      });
    }
    return themes;
  }

  private isExpired(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > GAMMA_THEME_CACHE_TTL_MS;
  }
}

function cachedThemesFromRow(
  row: { themes: GammaThemeCatalogEntry[]; fetchedAt: Date } | null
): GammaThemeCatalogEntry[] {
  return (row?.themes ?? []).filter((entry) => entry.type === "standard");
}
