import { Injectable, Logger } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";
const POSTMARK_SEND_TIMEOUT_MS = 10_000;

/**
 * Delivers transactional notifications via Postmark email.
 * Sending domain is read from POSTMARK_SENDER_DOMAIN env var.
 * POSTMARK_SERVER_TOKEN is read from POSTMARK_SERVER_TOKEN env var
 * (populated from persai-api-secrets Kubernetes secret).
 * Both are optional in dev — adapter returns 'failed' when not configured.
 * ADR-088 §10.
 */
@Injectable()
export class EmailChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(EmailChannelAdapter.name);

  readonly channelType = NotificationChannelType.email;

  private get serverToken(): string | undefined {
    return process.env["POSTMARK_SERVER_TOKEN"];
  }

  private get senderDomain(): string {
    return process.env["POSTMARK_SENDER_DOMAIN"] ?? "notifications.persai.dev";
  }

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    const token = this.serverToken;
    if (!token) {
      this.logger.warn({
        event: "email_adapter.no_token",
        intentId: intent.id,
        workspaceId: intent.workspaceId
      });
      return { status: "failed", error: { reason: "postmark_token_not_configured" } };
    }

    const config = channelConfig.config;
    const toAddress = typeof config["toAddress"] === "string" ? config["toAddress"] : null;
    if (!toAddress) {
      return { status: "failed", error: { reason: "email_to_address_not_configured" } };
    }

    const fromAddress = `notifications@${this.senderDomain}`;
    const subject = renderedPayload.subject ?? `Notification from PersAI`;
    const htmlBody =
      renderedPayload.html ?? `<pre>${renderedPayload.plainText ?? renderedPayload.body}</pre>`;
    const textBody = renderedPayload.plainText ?? renderedPayload.body;

    try {
      const payload = {
        From: fromAddress,
        To: toAddress,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: "outbound",
        Headers: [
          { Name: "List-Unsubscribe", Value: `<mailto:unsubscribe@${this.senderDomain}>` },
          { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }
        ],
        Metadata: {
          intentId: intent.id,
          workspaceId: intent.workspaceId,
          source: intent.source,
          traceId: intent.traceId ?? ""
        }
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, POSTMARK_SEND_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(POSTMARK_SEND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Postmark-Server-Token": token
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const errorCode =
          typeof responseBody["ErrorCode"] === "number"
            ? responseBody["ErrorCode"]
            : response.status;
        this.logger.warn({
          event: "email_adapter.send_failed",
          intentId: intent.id,
          httpStatus: response.status,
          errorCode,
          message: responseBody["Message"]
        });
        return {
          status: "failed",
          error: {
            reason: "postmark_error",
            httpStatus: response.status,
            errorCode,
            message: responseBody["Message"]
          }
        };
      }

      const messageId =
        typeof responseBody["MessageID"] === "string" ? responseBody["MessageID"] : undefined;

      this.logger.log({
        event: "email_adapter.sent",
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        source: intent.source,
        to: toAddress,
        messageId
      });

      return {
        status: "delivered",
        ...(messageId !== undefined ? { providerRef: messageId } : {})
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({
        event: "email_adapter.error",
        intentId: intent.id,
        error: errorMsg
      });
      return { status: "failed", error: { reason: "email_send_error", message: errorMsg } };
    }
  }
}
