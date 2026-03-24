import { Body, Controller, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAdminAbuseControlsService
} from "../../application/manage-admin-abuse-controls.service";

@Controller("api/v1/admin/abuse-controls")
export class AdminAbuseControlsController {
  constructor(private readonly manageAdminAbuseControlsService: ManageAdminAbuseControlsService) {}

  @Post("unblock")
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
