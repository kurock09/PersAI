import { All, Controller, Logger, Param, Req, Res } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { ResolveAssistantRuntimeTierService } from "../../application/resolve-assistant-runtime-tier.service";
import type { RuntimeTier } from "../../application/runtime-assignment";
import {
  normalizeRuntimeBaseUrl,
  resolveRuntimeBaseUrl
} from "../../application/runtime-endpoint-routing";

type ProxyRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type ProxyResponse = {
  status(code: number): ProxyResponse;
  setHeader(key: string, value: string): void;
  json(payload: unknown): void;
  send(body: string): void;
};

/**
 * Transparent reverse-proxy for Telegram webhook traffic.
 *
 * GKE Ingress sends `bot.persai.dev/telegram-webhook/:assistantId` here.
 * The controller resolves the assistant's runtime tier, picks the correct
 * OpenClaw pool URL, and forwards the raw request.  OpenClaw sees exactly
 * the same path / body / headers it would receive directly from Telegram.
 *
 * ADR-066 documents this decision.
 */
@Controller("telegram-webhook")
export class TelegramWebhookProxyController {
  private readonly logger = new Logger(TelegramWebhookProxyController.name);

  constructor(private readonly resolveRuntimeTier: ResolveAssistantRuntimeTierService) {}

  private classifyTransientProxyError(error: unknown): {
    status: number;
    code: "upstream_timeout" | "upstream_error";
  } {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: 504, code: "upstream_timeout" };
    }
    return { status: 502, code: "upstream_error" };
  }

  @All(":assistantId")
  async proxy(
    @Param("assistantId") assistantId: string,
    @Req() req: ProxyRequest,
    @Res() res: ProxyResponse
  ): Promise<void> {
    const config = loadApiConfig(process.env);

    const freeUrl = normalizeRuntimeBaseUrl(config.OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED);
    const paidUrl = normalizeRuntimeBaseUrl(config.OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED);
    const isoUrl = normalizeRuntimeBaseUrl(config.OPENCLAW_BASE_URL_PAID_ISOLATED);

    if (!freeUrl || !paidUrl || !isoUrl) {
      this.logger.error("OpenClaw tier base URLs are not configured.");
      res.status(200).json({ ok: false, error: "misconfigured" });
      return;
    }

    let tier: RuntimeTier;
    try {
      tier = await this.resolveRuntimeTier.resolveByAssistantId(assistantId);
    } catch (err) {
      this.logger.warn(`Tier resolution failed for ${assistantId}: ${err}`);
      res.status(200).json({ ok: false, error: "unknown_assistant" });
      return;
    }

    const { baseUrl } = resolveRuntimeBaseUrl({
      config: {
        tierBaseUrls: {
          free_shared_restricted: freeUrl,
          paid_shared_restricted: paidUrl,
          paid_isolated: isoUrl
        }
      },
      runtimeTier: tier
    });

    const targetUrl = `${baseUrl}/telegram-webhook/${assistantId}`;
    const token = config.OPENCLAW_GATEWAY_TOKEN ?? "";

    this.logger.log(`Proxying Telegram webhook → ${tier} (${baseUrl}) assistantId=${assistantId}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55_000);

    try {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const telegramSecret = req.headers["x-telegram-bot-api-secret-token"];
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          ...(token.length > 0 ? { Authorization: `Bearer ${token}` } : {}),
          ...(typeof telegramSecret === "string"
            ? { "x-telegram-bot-api-secret-token": telegramSecret }
            : {})
        },
        ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
        signal: controller.signal
      });

      const body = await upstreamRes.text();

      res.status(upstreamRes.status);
      for (const [key, value] of upstreamRes.headers.entries()) {
        if (key.toLowerCase() !== "transfer-encoding") {
          res.setHeader(key, value);
        }
      }
      res.send(body);
    } catch (err) {
      this.logger.error(`Upstream proxy error for ${assistantId}: ${err}`);
      const classified = this.classifyTransientProxyError(err);
      res.status(classified.status).json({ ok: false, error: classified.code });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
