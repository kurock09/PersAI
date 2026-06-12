import { Injectable } from "@nestjs/common";
import type { RuntimeVideoVoiceCatalogEntry } from "@persai/runtime-contract";
import { HeyGenVoiceCatalogService } from "./heygen-voice-catalog.service";

export type WorkspaceVoiceCatalogEntry = {
  catalogId: string;
  voiceId: string;
  name: string;
  language: string | null;
  gender: string;
  previewAudioUrl: string | null;
  languageBucket: "ru" | "en" | "other";
  source: "heygen" | "elevenlabs" | "gemini" | "unknown";
  qualityTags: string[];
  qualityRank: number;
  previewAvailable: boolean;
  localeControl: boolean;
  pauseSupport: boolean;
};

export type WorkspaceVoiceCatalogResult = {
  provider: "heygen";
  voices: WorkspaceVoiceCatalogEntry[];
} | null;

/**
 * ADR-109 Slice 9 — workspace-scoped voice catalog reader for the settings UI.
 *
 * Wraps the platform-wide HeyGen voice catalog cache plus admin curation and
 * re-projects only approved/enabled voices into a UI-friendly shape. The
 * workspace ID is accepted at the controller layer for auth-scoping only; the
 * underlying data is platform-wide (no per-workspace filtering).
 *
 * Returns null when the catalog is unavailable (no HeyGen credential or
 * empty cache). The UI should render an honest "voice catalog unavailable"
 * message in that case.
 */
@Injectable()
export class ReadHeygenVoiceCatalogForWorkspaceService {
  constructor(private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService) {}

  async getVoiceCatalogForWorkspace(_workspaceId: string): Promise<WorkspaceVoiceCatalogResult> {
    const voices = await this.heyGenVoiceCatalogService.getApprovedVoiceCatalogEntries();
    if (voices.length === 0) {
      return null;
    }
    return {
      provider: "heygen",
      voices: voices.map((entry: RuntimeVideoVoiceCatalogEntry) => ({
        catalogId: this.buildCatalogId(entry),
        voiceId: entry.providerVoiceId,
        name: entry.displayName,
        language: entry.locale ?? null,
        gender: entry.gender,
        previewAudioUrl: entry.previewAudioUrl ?? null,
        languageBucket: this.toLanguageBucket(entry.locale),
        source: entry.source ?? "unknown",
        qualityTags: entry.qualityTags ?? [],
        qualityRank: entry.qualityRank ?? 0,
        previewAvailable: entry.previewAvailable ?? false,
        localeControl: entry.localeControl ?? false,
        pauseSupport: entry.pauseSupport ?? false
      }))
    };
  }

  private buildCatalogId(entry: RuntimeVideoVoiceCatalogEntry): string {
    return `${entry.providerVoiceId}:${entry.voiceKey}:${entry.locale ?? "unknown"}`;
  }

  private toLanguageBucket(locale: string | null): "ru" | "en" | "other" {
    const normalized = locale?.trim().toLowerCase() ?? "";
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
}
