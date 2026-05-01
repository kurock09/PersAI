import { Body, Controller, Get, Post, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminDocumentProcessingSettingsService } from "../../application/manage-admin-document-processing-settings.service";
import type {
  AdminDocumentProcessingSettingsState,
  DocumentProcessingTestConnectionState
} from "../../application/document-processing-settings";

@Controller("api/v1/admin/tools/document-processing")
export class AdminDocumentProcessingSettingsController {
  constructor(
    private readonly manageAdminDocumentProcessingSettingsService: ManageAdminDocumentProcessingSettingsService
  ) {}

  @Get()
  async getSettings(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: AdminDocumentProcessingSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminDocumentProcessingSettingsService.getSettings(userId);
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Put()
  async updateSettings(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    settings: AdminDocumentProcessingSettingsState;
    configGeneration: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminDocumentProcessingSettingsService.parseUpdateInput(body);
    const result = await this.manageAdminDocumentProcessingSettingsService.updateSettings(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      settings: result.settings,
      configGeneration: result.configGeneration
    };
  }

  @Post("test-connection")
  async testConnection(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    result: DocumentProcessingTestConnectionState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminDocumentProcessingSettingsService.parseTestConnectionInput(body);
    const result = await this.manageAdminDocumentProcessingSettingsService.testConnection(
      userId,
      input.providerKey
    );
    return {
      requestId: req.requestId ?? null,
      result
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
