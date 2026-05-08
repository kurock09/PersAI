import { Controller, Logger, Post, Req, Res } from "@nestjs/common";
import { HandlePostmarkWebhookService } from "../../application/notifications/handle-postmark-webhook.service";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";

type WebhookResponse = {
  status(code: number): WebhookResponse;
  json(payload: unknown): void;
};

/**
 * Ingress point for Postmark bounce/complaint webhooks.
 * POST /api/v1/internal/notifications/postmark-webhook
 * HMAC-verified. Updates notification_channel_registry health.
 * ADR-088 §10.
 */
@Controller("api/v1/internal/notifications")
export class InternalNotificationsPostmarkWebhookController {
  private readonly logger = new Logger(InternalNotificationsPostmarkWebhookController.name);

  constructor(private readonly handlePostmarkWebhookService: HandlePostmarkWebhookService) {}

  @Post("postmark-webhook")
  async handle(
    @Req()
    req: RequestWithPlatformContext & {
      rawBody?: Buffer;
      headers: Record<string, string | undefined>;
    },
    @Res() res: WebhookResponse
  ): Promise<void> {
    const rawBody = req.rawBody != null ? req.rawBody.toString("utf-8") : "{}";

    const signature = req.headers["x-postmark-signature"] ?? null;

    // We require a workspace context via query or header.
    // For bounce webhooks, we broadcast to all workspaces' email channels.
    // In Slice 1 with a single workspace, we iterate all email channels.
    try {
      await this.handlePostmarkWebhookService.handleBroadcast({
        rawBody,
        signature
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "invalid_postmark_signature") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      this.logger.error({ event: "postmark_webhook.error", error: message });
      res.status(500).json({ error: "internal_error" });
    }
  }
}
