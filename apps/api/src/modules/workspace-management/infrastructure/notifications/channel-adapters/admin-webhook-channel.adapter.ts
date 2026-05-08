import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";
import { assertPublicWebhookUrl } from "../../../application/admin-webhook-url-policy";

const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Delivers operational/administrative notifications to an admin-configured
 * HTTPS webhook endpoint with HMAC-SHA256 signing.
 * ADR-088 §Core principles #4 – dumb adapter.
 */
@Injectable()
export class AdminWebhookChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(AdminWebhookChannelAdapter.name);

  readonly channelType = NotificationChannelType.admin_webhook;

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    const config = channelConfig.config;
    const endpointUrl = typeof config["endpointUrl"] === "string" ? config["endpointUrl"] : null;
    const signingSecret =
      typeof config["signingSecret"] === "string" ? config["signingSecret"] : null;

    if (!endpointUrl) {
      return { status: "failed", error: { reason: "webhook_endpoint_not_configured" } };
    }

    try {
      assertPublicWebhookUrl(endpointUrl);
    } catch {
      return { status: "failed", error: { reason: "invalid_webhook_url" } };
    }

    const envelope = {
      schema: "persai.notification.v1",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      traceId: intent.traceId,
      body: renderedPayload.body,
      factPayload: intent.factPayload,
      sentAt: new Date().toISOString()
    };

    const bodyJson = JSON.stringify(envelope);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "PersAI-Notifications/1.0",
      "X-PersAI-Intent-Id": intent.id,
      "X-PersAI-Source": intent.source
    };

    if (signingSecret) {
      const signature = createHmac("sha256", signingSecret).update(bodyJson).digest("hex");
      headers["X-PersAI-Signature-256"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: bodyJson,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn({
          event: "admin_webhook_adapter.http_error",
          intentId: intent.id,
          endpointUrl,
          httpStatus: response.status
        });
        return {
          status: "failed",
          error: { reason: "webhook_http_error", httpStatus: response.status }
        };
      }

      this.logger.log({
        event: "admin_webhook_adapter.delivered",
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        source: intent.source,
        httpStatus: response.status
      });

      return { status: "delivered", providerRef: `webhook:${response.status}` };
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({
        event: "admin_webhook_adapter.error",
        intentId: intent.id,
        error: message
      });
      return { status: "failed", error: { reason: "webhook_send_error", message } };
    }
  }
}
