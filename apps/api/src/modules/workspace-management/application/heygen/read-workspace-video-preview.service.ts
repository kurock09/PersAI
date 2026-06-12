import { Inject, Injectable } from "@nestjs/common";
import { HeyGenVoiceCatalogService } from "./heygen-voice-catalog.service";
import { ReadWorkspaceVideoPersonaService } from "./read-workspace-video-persona.service";
import {
  WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY,
  type WorkspaceVideoClonedVoiceRepository
} from "../../domain/workspace-video-cloned-voice.repository";

/**
 * Resolves the real HeyGen preview URL behind workspace-scoped persona / clone
 * / catalog selections. The controller layer can then proxy that media through
 * PersAI so browser playback does not depend on direct client access to
 * `resource2.heygen.ai`.
 */
@Injectable()
export class ReadWorkspaceVideoPreviewService {
  constructor(
    private readonly readWorkspaceVideoPersonaService: ReadWorkspaceVideoPersonaService,
    private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService,
    @Inject(WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY)
    private readonly clonedVoiceRepository: WorkspaceVideoClonedVoiceRepository
  ) {}

  async resolvePersonaPreviewUrl(input: {
    workspaceId: string;
    personaId: string;
  }): Promise<string | null> {
    const persona = await this.readWorkspaceVideoPersonaService.execute({
      workspaceId: input.workspaceId,
      personaId: input.personaId
    });
    if (persona === null) {
      return null;
    }
    if (persona.clonedVoiceId !== null) {
      const clonedPreview = await this.resolveClonedVoicePreviewUrl({
        workspaceId: input.workspaceId,
        clonedVoiceId: persona.clonedVoiceId
      });
      if (clonedPreview !== null) {
        return clonedPreview;
      }
    }
    return this.resolveCatalogVoicePreviewUrl({ voiceId: persona.heygenVoiceId });
  }

  async resolveClonedVoicePreviewUrl(input: {
    workspaceId: string;
    clonedVoiceId: string;
  }): Promise<string | null> {
    const row = await this.clonedVoiceRepository.findById(input.workspaceId, input.clonedVoiceId);
    if (row === null || row.archived || row.status !== "ready") {
      return null;
    }
    return this.normalizeUrl(row.previewAudioUrl);
  }

  async resolveCatalogVoicePreviewUrl(input: { voiceId: string }): Promise<string | null> {
    const voices = await this.heyGenVoiceCatalogService.getApprovedVoiceCatalogEntries();
    const voice = voices.find((entry) => entry.providerVoiceId === input.voiceId);
    return this.normalizeUrl(voice?.previewAudioUrl ?? null);
  }

  private normalizeUrl(value: string | null | undefined): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
