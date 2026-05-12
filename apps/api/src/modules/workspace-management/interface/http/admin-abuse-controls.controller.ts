import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminAbuseControlsService } from "../../application/manage-admin-abuse-controls.service";

@Controller("api/v1/admin/abuse-controls")
export class AdminAbuseControlsController {
  constructor(private readonly manageAdminAbuseControlsService: ManageAdminAbuseControlsService) {}

  @Get("assistants")
  async lookupAssistants(
    @Req() req: RequestWithPlatformContext,
    @Query("email") email?: string
  ): Promise<{
    requestId: string | null;
    assistants: Array<{
      assistantId: string;
      assistantDisplayName: string | null;
      userId: string;
      userEmail: string;
      userDisplayName: string | null;
      workspaceId: string;
    }>;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistants = await this.manageAdminAbuseControlsService.lookupAssistantsByEmail(
      userId,
      email ?? ""
    );
    return {
      requestId: req.requestId ?? null,
      assistants
    };
  }

  @Get("active-overrides")
  async listActiveOverrides(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    overrides: Array<{
      assistantId: string;
      assistantDisplayName: string | null;
      userId: string;
      userEmail: string;
      userDisplayName: string | null;
      workspaceId: string;
      surface: "web_chat" | "telegram" | "whatsapp" | "max";
      adminOverrideUntil: string;
      lastSeenAt: string;
    }>;
  }> {
    const userId = this.resolveRequestUserId(req);
    const overrides = await this.manageAdminAbuseControlsService.listActiveOverrides(userId);
    return {
      requestId: req.requestId ?? null,
      overrides
    };
  }

  @Post("unblock")
  @HttpCode(HttpStatus.OK)
  async unblock(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    unblock: {
      assistantId: string;
      userId: string | null;
      surface: "web_chat" | "telegram" | "whatsapp" | "max";
      adminOverrideUntil: string;
      affectedUserRows: number;
      affectedAssistantRows: number;
    };
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminAbuseControlsService.parseUnblockInput(body);
    const unblock = await this.manageAdminAbuseControlsService.unblock(userId, input);
    return {
      requestId: req.requestId ?? null,
      unblock
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
