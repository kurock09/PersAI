import { Controller, HttpException, Logger, Param, Post, Req, Res } from "@nestjs/common";
import {
  HandleCloudpaymentsWebhookService,
  type CloudpaymentsNotificationType
} from "../../application/handle-cloudpayments-webhook.service";

type CloudpaymentsWebhookRequest = {
  body: unknown;
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
};

type CloudpaymentsWebhookResponse = {
  status(code: number): CloudpaymentsWebhookResponse;
  json(payload: unknown): void;
};

function isNotificationType(value: string): value is CloudpaymentsNotificationType {
  return (
    value === "check" ||
    value === "pay" ||
    value === "fail" ||
    value === "confirm" ||
    value === "refund" ||
    value === "cancel" ||
    value === "recurrent"
  );
}

@Controller("api/v1/public/billing/cloudpayments/webhooks")
export class CloudpaymentsWebhookController {
  private readonly logger = new Logger(CloudpaymentsWebhookController.name);

  constructor(
    private readonly handleCloudpaymentsWebhookService: HandleCloudpaymentsWebhookService
  ) {}

  @Post(":notificationType")
  async handle(
    @Param("notificationType") notificationType: string,
    @Req() req: CloudpaymentsWebhookRequest,
    @Res() res: CloudpaymentsWebhookResponse
  ): Promise<void> {
    if (!isNotificationType(notificationType)) {
      res.status(404).json({ code: 13, message: "unsupported_notification_type" });
      return;
    }

    try {
      await this.handleCloudpaymentsWebhookService.handle({
        notificationType,
        body: req.body,
        rawBody: req.rawBody ?? null,
        headers: req.headers
      });
      res.status(200).json({ code: 0 });
    } catch (error) {
      this.logger.error(
        `CloudPayments webhook handling failed for ${notificationType}: ${String(error)}`
      );
      const status = error instanceof HttpException ? error.getStatus() : 500;
      res.status(status).json({ code: 13, message: "webhook_failed" });
    }
  }
}
