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
const POSTMARK_TEMPLATE_URL = "https://api.postmarkapp.com/email/withTemplate";
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
    // or from channelConfig.config.toAddress (resolver-injected owner email).
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

    // Postmark Template ID from merged policy config (billing_lifecycle stores it there).
    //
    // Primary PROD path (no Template ID): PersAI renders the full email
    // (subject, HTML, plainText) via TemplateRendererService and sends the
    // pre-rendered content through Postmark's standard POST /email API.
    // No Postmark-side template is required or expected.
    //
    // Optional override (Template ID set): skip the pre-rendered content and
    // send only the raw factPayload to Postmark's POST /email/withTemplate.
    // The Postmark template is responsible for all formatting; PersAI rendering
    // is not used in this path.
    const postmarkTemplateId = channelConfig.config["postmarkTemplateId"];
    const resolvedTemplateId =
      typeof postmarkTemplateId === "number" && postmarkTemplateId > 0
        ? postmarkTemplateId
        : typeof postmarkTemplateId === "string" && postmarkTemplateId.trim().length > 0
          ? Number(postmarkTemplateId.trim())
          : null;
    // Treat NaN (e.g. non-numeric string) as "not set"
    const hasTemplate = resolvedTemplateId !== null && !isNaN(resolvedTemplateId);

    if (hasTemplate) {
      return this.deliverWithTemplate(intent, resolvedTemplateId!, channelConfig, token, toAddress);
    }
    return this.deliverRaw(intent, renderedPayload, channelConfig, token, toAddress);
  }

  /**
   * Postmark /email/withTemplate — optional operator override.
   *
   * Sends raw factPayload as TemplateModel variables so the Postmark-hosted
   * template is solely responsible for rendering. PersAI's pre-rendered
   * content is NOT used here — the Postmark template receives the original
   * billing event data (rule, planDisplayName, periodEndsAt, amount, etc.)
   * and renders them with its own markup.
   *
   * This path is only reached when the operator has explicitly configured a
   * Postmark Template ID on the billing_lifecycle policy. The primary PROD
   * path (no Template ID) is deliverRaw.
   */
  private async deliverWithTemplate(
    intent: NotificationIntentRecord,
    templateId: number,
    channelConfig: ChannelRegistryRow,
    token: string,
    toAddress: string
  ): Promise<DeliveryResult> {
    const senderDomain = this.resolveSenderDomain(channelConfig);
    const fromAddress = this.resolveFromAddress(channelConfig, senderDomain);

    const payload = {
      TemplateId: templateId,
      From: fromAddress,
      To: toAddress,
      // Raw factPayload only — no PersAI-rendered content passed here.
      // The Postmark template uses its own markup with the data variables.
      TemplateModel: { ...intent.factPayload },
      MessageStream: "outbound",
      Metadata: {
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        source: intent.source,
        traceId: intent.traceId ?? ""
      }
    };

    return this.postmarkPost(POSTMARK_TEMPLATE_URL, payload, token, intent, "templated");
  }

  /**
   * Postmark /email — raw send with pre-rendered subject/body/html.
   * Used when no Postmark Template ID is configured on the policy.
   */
  private async deliverRaw(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow,
    token: string,
    toAddress: string
  ): Promise<DeliveryResult> {
    const senderDomain = this.resolveSenderDomain(channelConfig);
    const fromAddress = this.resolveFromAddress(channelConfig, senderDomain);
    const subject = renderedPayload.subject ?? `Notification from PersAI`;
    const htmlBody =
      renderedPayload.html ?? `<pre>${renderedPayload.plainText ?? renderedPayload.body}</pre>`;
    const textBody = renderedPayload.plainText ?? renderedPayload.body;

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

    return this.postmarkPost(POSTMARK_SEND_URL, payload, token, intent, "raw");
  }

  private async postmarkPost(
    url: string,
    payload: Record<string, unknown>,
    token: string,
    intent: NotificationIntentRecord,
    mode: "raw" | "templated"
  ): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, POSTMARK_SEND_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": token
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({
        event: "email_adapter.error",
        intentId: intent.id,
        mode,
        error: errorMsg
      });
      return { status: "failed", error: { reason: "email_send_error", message: errorMsg } };
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const errorCode =
        typeof responseBody["ErrorCode"] === "number" ? responseBody["ErrorCode"] : response.status;
      this.logger.warn({
        event: "email_adapter.send_failed",
        intentId: intent.id,
        mode,
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
      mode,
      messageId
    });

    return {
      status: "delivered",
      ...(messageId !== undefined ? { providerRef: messageId } : {})
    };
  }
}
