import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { DocumentWorkspaceVersionRegistrationService } from "../../application/document-workspace-version-registration.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime")
export class InternalRuntimeDocumentRegisterVersionController {
  constructor(
    private readonly documentWorkspaceVersionRegistrationService: DocumentWorkspaceVersionRegistrationService
  ) {}

  @HttpCode(200)
  @Post("document-register-version")
  async registerVersion(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.documentWorkspaceVersionRegistrationService.parseInput(body);
    const outcome = await this.documentWorkspaceVersionRegistrationService.execute(input);
    return {
      ok: true,
      ...outcome
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the runtime document register-version endpoint.",
      "Internal runtime document register-version authorization failed."
    );
  }
}
