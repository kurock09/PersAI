import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Req
} from "@nestjs/common";
import { ReadWorkspaceVideoPersonaService } from "../../application/heygen/read-workspace-video-persona.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-109 Slice 7 — internal runtime endpoint to read a workspace video persona
 * by id. Auth: Bearer `PERSAI_INTERNAL_API_TOKEN` (fail-closed internal auth,
 * mirroring all other `internal-runtime-*` controllers).
 *
 * Route: `GET api/v1/internal/runtime/workspaces/:workspaceId/video-personas/:personaId`
 *
 * Returns 404 if the persona is not found, belongs to a different workspace,
 * or is archived. The runtime MUST NOT write to `workspace_video_personas`
 * (cross-slice invariant #14); this endpoint is strictly read-only.
 */
@Controller("api/v1/internal/runtime/workspaces/:workspaceId/video-personas")
export class InternalRuntimeWorkspaceVideoPersonasController {
  constructor(private readonly readService: ReadWorkspaceVideoPersonaService) {}

  @Get(":personaId")
  @HttpCode(HttpStatus.OK)
  async getPersona(
    @Req() request: InternalRequestLike,
    @Param("workspaceId") workspaceId: string,
    @Param("personaId") personaId: string
  ): Promise<{
    schema: "persai.internalRuntimeWorkspaceVideoPersonaResponse.v1";
    persona: {
      id: string;
      displayName: string;
      heygenAvatarId: string;
      heygenVoiceId: string;
      heygenVoiceLabel: string;
      clonedVoiceId: string | null;
      linkedClonedVoiceDisplayName: string | null;
      linkedClonedVoiceProviderId: string | null;
      portraitImageStorageKey: string;
    };
  }> {
    assertPersaiInternalApiAuthorized(
      request,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime workspace video persona endpoints.",
      "Internal runtime workspace video persona authorization failed."
    );

    const persona = await this.readService.execute({ workspaceId, personaId });
    if (persona === null) {
      throw new NotFoundException({
        message: `Persona "${personaId}" not found in workspace "${workspaceId}".`,
        code: "persona_not_found"
      });
    }

    return {
      schema: "persai.internalRuntimeWorkspaceVideoPersonaResponse.v1",
      persona
    };
  }
}
