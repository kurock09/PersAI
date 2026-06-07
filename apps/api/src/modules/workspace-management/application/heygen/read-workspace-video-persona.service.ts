import { Inject, Injectable } from "@nestjs/common";
import {
  WORKSPACE_VIDEO_PERSONA_REPOSITORY,
  type WorkspaceVideoPersonaRepository
} from "../../domain/workspace-video-persona.repository";

/**
 * ADR-109 Slice 7 — strictly read-only persona lookup for the internal runtime
 * endpoint. The runtime MUST NOT write to `workspace_video_personas` (cross-slice
 * invariant #14). This service enforces workspace scope and archived state checks
 * defensively so the caller receives null rather than a wrong-workspace persona.
 */
@Injectable()
export class ReadWorkspaceVideoPersonaService {
  constructor(
    @Inject(WORKSPACE_VIDEO_PERSONA_REPOSITORY)
    private readonly personaRepository: WorkspaceVideoPersonaRepository
  ) {}

  async execute(input: { workspaceId: string; personaId: string }): Promise<{
    id: string;
    displayName: string;
    heygenAvatarId: string;
    heygenVoiceId: string;
    heygenVoiceLabel: string;
    clonedVoiceId: string | null;
    linkedClonedVoiceDisplayName: string | null;
    linkedClonedVoiceProviderId: string | null;
    portraitImageStorageKey: string;
  } | null> {
    const row = await this.personaRepository.findById(input.workspaceId, input.personaId);
    if (row === null || row.archived) {
      return null;
    }
    return {
      id: row.id,
      displayName: row.displayName,
      heygenAvatarId: row.heygenAvatarId,
      heygenVoiceId: row.heygenVoiceId,
      heygenVoiceLabel: row.heygenVoiceLabel,
      clonedVoiceId: row.clonedVoiceId,
      linkedClonedVoiceDisplayName: row.linkedClonedVoiceDisplayName,
      linkedClonedVoiceProviderId:
        row.linkedClonedVoiceArchived === false && row.linkedClonedVoiceStatus === "ready"
          ? row.linkedClonedVoiceProviderId
          : null,
      portraitImageStorageKey: row.portraitImageStorageKey
    };
  }
}
