import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminToolCredentialsService } from "../../application/manage-admin-tool-credentials.service";
import type { AdminToolCredentialsState } from "../../application/tool-credential-settings";

@Controller("api/v1/admin/runtime/tool-credentials")
export class AdminToolCredentialsController {
  constructor(
    private readonly manageAdminToolCredentialsService: ManageAdminToolCredentialsService
  ) {}

  @Get()
  async getCredentials(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    credentials: AdminToolCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const credentials = await this.manageAdminToolCredentialsService.getCredentials(userId);
    return {
      requestId: req.requestId ?? null,
      credentials
    };
  }

  @Put()
  async updateCredentials(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    credentials: AdminToolCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminToolCredentialsService.parseUpdateInput(body);
    const credentials = await this.manageAdminToolCredentialsService.updateCredentials(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      credentials
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
