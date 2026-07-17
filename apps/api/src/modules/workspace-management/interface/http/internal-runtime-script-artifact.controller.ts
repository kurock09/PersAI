import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { InternalRuntimeScriptArtifactService } from "../../application/internal-runtime-script-artifact.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-151 — read-only internal boundary for the runtime to fetch the exact
 * immutable `ScriptVersion` artifact by pinned id, with live
 * assistant/effective-Skill/scriptKey/contentHash authorization performed on
 * every call. There is no public or model-facing execute endpoint here; this
 * exists only for the runtime's own `script.execute` pre-execution gate.
 */
@Controller("api/v1/internal/runtime/scripts")
export class InternalRuntimeScriptArtifactController {
  constructor(
    private readonly internalRuntimeScriptArtifactService: InternalRuntimeScriptArtifactService
  ) {}

  @HttpCode(200)
  @Post("version")
  async fetchVersionArtifact(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.internalRuntimeScriptArtifactService.parseInput(body);
    const artifact = await this.internalRuntimeScriptArtifactService.fetchArtifact(input);
    return { ok: true as const, ...artifact };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime script endpoints.",
      "Internal runtime script authorization failed."
    );
  }
}
