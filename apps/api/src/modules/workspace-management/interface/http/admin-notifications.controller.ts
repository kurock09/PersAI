import { Body, Controller, Get, Patch, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminNotificationChannelsService } from "../../application/manage-admin-notification-channels.service";
import type { AdminNotificationChannelState } from "../../application/admin-system-notification.types";

@Controller("api/v1/admin/notifications")
export class AdminNotificationsController {
  constructor(
    private readonly manageAdminNotificationChannelsService: ManageAdminNotificationChannelsService
  ) {}

  @Get("channels")
  async listChannels(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    channels: AdminNotificationChannelState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const channels = await this.manageAdminNotificationChannelsService.listChannels(userId);
    return {
      requestId: req.requestId ?? null,
      channels
    };
  }

  @Patch("channels/webhook")
  async updateWebhookChannel(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    channel: AdminNotificationChannelState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminNotificationChannelsService.parseWebhookUpdateInput(body);
    const channel = await this.manageAdminNotificationChannelsService.updateWebhookChannel(userId, input);
    return {
      requestId: req.requestId ?? null,
      channel
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
