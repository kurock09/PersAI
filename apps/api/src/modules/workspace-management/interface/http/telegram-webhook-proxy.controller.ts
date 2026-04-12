import { Controller, Logger, Param, Post, Req, Res } from "@nestjs/common";
import { TelegramChannelAdapterService } from "../../application/telegram-channel-adapter.service";

type TelegramWebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type TelegramWebhookResponse = {
  status(code: number): TelegramWebhookResponse;
  json(payload: unknown): void;
};

@Controller("telegram-webhook")
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly telegramChannelAdapterService: TelegramChannelAdapterService) {}

  @Post(":assistantId")
  async handle(
    @Param("assistantId") assistantId: string,
    @Req() req: TelegramWebhookRequest,
    @Res() res: TelegramWebhookResponse
  ): Promise<void> {
    const rawSecret = req.headers["x-telegram-bot-api-secret-token"];
    const secretToken = Array.isArray(rawSecret) ? (rawSecret[0] ?? null) : (rawSecret ?? null);
    try {
      const result = await this.telegramChannelAdapterService.handleWebhook({
        assistantId,
        secretToken,
        payload: req.body
      });
      res.status(result.statusCode).json(result.body);
    } catch (err) {
      this.logger.error(`Telegram webhook handling failed for ${assistantId}: ${String(err)}`);
      res.status(500).json({ ok: false, error: "webhook_failed" });
    }
  }
}
