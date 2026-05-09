import { Injectable, Logger } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import { PlatformRuntimeProviderSecretStoreService } from "../../../application/platform-runtime-provider-secret-store.service";
import { NOTIFICATION_CREDENTIAL_IDS } from "../../../application/tool-credential-settings";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";
const POSTMARK_SEND_TIMEOUT_MS = 10_000;
const DEFAULT_SENDER_DOMAIN = "notifications.persai.dev";

/**
 * Delivers transactional notifications via Postmark email.
 * Postmark Server Token is resolved exclusively from the Admin > Tools
 * credential store (NOTIFICATION_CREDENTIAL_IDS.email_postmark). Returns
 * 'failed' with reason 'postmark_token_unavailable' when not configured.
 * Sending domain comes from the global notification_channel_registry email
 * row config.sendingDomain, falling back to DEFAULT_SENDER_DOMAIN.
 * ADR-088 §10 + multi-user correction (T4).
 */
@Injectable()
export class EmailChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(EmailChannelAdapter.name);

  readonly channelType = NotificationChannelType.email;

  constructor(private readonly secretStore: PlatformRuntimeProviderSecretStoreService) {}

  private async resolveServerToken(): Promise<string | undefined> {
    // resolveSecretValueById(secretId) maps secretId -> providerKey internally
    // (PROVIDER_KEY_BY_SECRET_ID). Calling resolveSecretValueByProviderKey
    // here is wrong because NOTIFICATION_CREDENTIAL_IDS.email_postmark is the
    // secretId ("notification/email/postmark/api-key"), not the providerKey
    // ("notification_email_postmark") under which the row is stored.
    const fromStore = await this.secretStore
      .resolveSecretValueById(NOTIFICATION_CREDENTIAL_IDS.email_postmark)
      .catch(() => null);
    return fromStore ?? undefined;
  }

  private resolveSenderDomain(channelConfig: ChannelRegistryRow): string {
    const configDomain = channelConfig.config["sendingDomain"];
    if (typeof configDomain === "string" && configDomain.length > 0) return configDomain;
    return DEFAULT_SENDER_DOMAIN;
  }

  /**
   * Resolve the From address. When the operator has stored a full
   * `fromAddress` (e.g. a verified Postmark Sender Signature like
   * `support@persai.com`), use it verbatim — Postmark rejects any From that
   * is not a verified Sender Signature or an address inside a verified
   * domain. Otherwise fall back to `notifications@<sendingDomain>`.
   */
  private resolveFromAddress(channelConfig: ChannelRegistryRow, senderDomain: string): string {
    const explicit = channelConfig.config["fromAddress"];
    if (typeof explicit === "string" && explicit.includes("@")) {
      return explicit;
    }
    return `notifications@${senderDomain}`;
  }

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    const token = await this.resolveServerToken();
    if (!token) {
      this.logger.warn({
        event: "email_adapter.no_token",
        intentId: intent.id,
        workspaceId: intent.workspaceId
      });
      return { status: "failed", error: { reason: "postmark_token_unavailable" } };
    }

    // Recipient: from factPayload.recipientEmail (billing producer sets this)
    // or from channelConfig.config.toAddress (legacy operator-configured address).
    const toAddress =
      (typeof intent.factPayload["recipientEmail"] === "string"
        ? intent.factPayload["recipientEmail"]
        : null) ??
      (typeof channelConfig.config["toAddress"] === "string"
        ? channelConfig.config["toAddress"]
        : null);
    if (!toAddress) {
      return { status: "failed", error: { reason: "email_to_address_not_configured" } };
    }

    const senderDomain = this.resolveSenderDomain(channelConfig);
    const fromAddress = this.resolveFromAddress(channelConfig, senderDomain);
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
          { Name: "List-Unsubscribe", Value: `<mailto:unsubscribe@${senderDomain}>` },
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
