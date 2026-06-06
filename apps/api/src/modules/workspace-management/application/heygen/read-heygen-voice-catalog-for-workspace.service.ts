import { Injectable } from "@nestjs/common";
import type { RuntimeVideoVoiceCatalogEntry } from "@persai/runtime-contract";
import { HeyGenVoiceCatalogService } from "./heygen-voice-catalog.service";

export type WorkspaceVoiceCatalogEntry = {
  voiceId: string;
  name: string;
  language: string | null;
  gender: string;
  previewAudioUrl: string | null;
  languageBucket: "ru" | "en" | "other";
};

export type WorkspaceVoiceCatalogResult = {
  provider: "heygen";
  voices: WorkspaceVoiceCatalogEntry[];
} | null;

/**
 * ADR-109 Slice 9 — workspace-scoped voice catalog reader for the settings UI.
 *
 * Wraps the platform-wide HeyGen voice catalog cache (Slice 4) and
 * re-projects it into a UI-friendly shape. The workspace ID is accepted
 * at the controller layer for auth-scoping only; the underlying data is
 * platform-wide (no per-workspace filtering).
 *
 * Returns null when the catalog is unavailable (no HeyGen credential or
 * empty cache). The UI should render an honest "voice catalog unavailable"
 * message in that case.
 */
@Injectable()
export class ReadHeygenVoiceCatalogForWorkspaceService {
  constructor(private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService) {}

  async getVoiceCatalogForWorkspace(_workspaceId: string): Promise<WorkspaceVoiceCatalogResult> {
    const voices = await this.heyGenVoiceCatalogService.getFullVoiceCatalogEntries();
    if (voices.length === 0) {
      return null;
    }
    return {
      provider: "heygen",
      voices: voices.map((entry: RuntimeVideoVoiceCatalogEntry) => ({
        voiceId: entry.providerVoiceId,
        name: entry.displayName,
        language: entry.locale ?? null,
        gender: entry.gender,
        previewAudioUrl: entry.previewAudioUrl ?? null,
        languageBucket: this.toLanguageBucket(entry.locale)
      }))
    };
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
