import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { MailboxTokenLifecycleService } from "./mailbox-token-lifecycle.service";
import { MailboxSmtpSendClientService } from "./mailbox-smtp-send.client";
import {
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProviderId
} from "./mailbox-oauth-provider-registry";

const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_LENGTH = 20_000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const REJECTED_BODY_KEYS = ["cc", "bcc", "attachments", "html", "htmlBody"];
/** RFC 3463/5321 codes providers commonly use for rate/quota policy rejections. */
const PROVIDER_QUOTA_SMTP_CODES = new Set([421, 450, 452, 454]);
const PROVIDER_QUOTA_KEYWORDS = ["quota", "too many", "rate limit", "throttl"];

export type InternalRuntimeEmailSendInput = {
  workspaceId: string;
  assistantId: string;
  chatId: string | null;
  requestId: string;
  to: string;
  subject: string;
  body: string;
};

export type InternalRuntimeEmailSendResult =
  | { status: "sent"; messageId: string }
  | {
      status: "skipped";
      reason: "mailbox_not_connected" | "mailbox_token_invalid" | "provider_daily_limit_reached";
      message?: string;
    }
  | { status: "failed"; reason: string; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function isProviderQuotaRejection(outcome: {
  responseCode: number | null;
  message: string;
}): boolean {
  if (outcome.responseCode !== null && PROVIDER_QUOTA_SMTP_CODES.has(outcome.responseCode)) {
    return true;
  }
  const lowered = outcome.message.toLowerCase();
  return PROVIDER_QUOTA_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

/**
 * ADR-169 D1/D8 — internal send used by the `email_send` native tool via
 * `PersaiInternalApiClientService`. The transport is now the customer's own
 * connected mailbox over SMTP XOAUTH2, resolved and refreshed by
 * `MailboxTokenLifecycleService`; there is no Postmark call and no
 * `AssistantEmailSenderIdentityService` involvement anywhere in this path.
 *
 * Fail-closed (D5): with no connected mailbox, or a mailbox whose token
 * refresh was rejected as revoked, this makes **no** SMTP call at all and
 * returns `skipped` with a reason naming the gap so the model can relay
 * guidance pointing at Settings → Интеграции → Email.
 *
 * Daily-limit accounting is intentionally NOT implemented here — the runtime
 * owns that through the existing shared `consumeToolDailyLimit` mechanism.
 * Provider-side daily limits are a separate, honest `skipped` outcome (D9).
 */
@Injectable()
export class InternalRuntimeEmailSendService {
  private readonly logger = new Logger(InternalRuntimeEmailSendService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly tokenLifecycle: MailboxTokenLifecycleService,
    private readonly smtpClient: MailboxSmtpSendClientService
  ) {}

  parseInput(body: unknown): InternalRuntimeEmailSendInput {
    if (!isRecord(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    for (const rejectedKey of REJECTED_BODY_KEYS) {
      if (body[rejectedKey] !== undefined) {
        throw new BadRequestException(
          `${rejectedKey} is not supported. Exactly one plain-text recipient is allowed.`
        );
      }
    }

    const workspaceId = requireNonEmptyString(body, "workspaceId");
    const assistantId = requireNonEmptyString(body, "assistantId");
    const requestId = requireNonEmptyString(body, "requestId");

    const toRaw = body["to"];
    if (Array.isArray(toRaw)) {
      throw new BadRequestException("to must be exactly one recipient, not an array.");
    }
    const to = requireNonEmptyString(body, "to");
    if (!EMAIL_REGEX.test(to)) {
      throw new BadRequestException("to must be a valid email address.");
    }

    const subject = requireNonEmptyString(body, "subject");
    if (subject.length > MAX_SUBJECT_LENGTH) {
      throw new BadRequestException(
        `subject must be at most ${String(MAX_SUBJECT_LENGTH)} characters.`
      );
    }

    const messageBody = requireNonEmptyString(body, "body");
    if (messageBody.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(`body must be at most ${String(MAX_BODY_LENGTH)} characters.`);
    }

    const chatIdRaw = body["chatId"];
    const chatId =
      typeof chatIdRaw === "string" && chatIdRaw.trim().length > 0 ? chatIdRaw.trim() : null;

    return { workspaceId, assistantId, chatId, requestId, to, subject, body: messageBody };
  }

  async execute(input: InternalRuntimeEmailSendInput): Promise<InternalRuntimeEmailSendResult> {
    const identity = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    if (
      identity === null ||
      identity.provider === null ||
      identity.mailboxStatus !== WorkspaceEmailMailboxStatus.connected
    ) {
      return this.skip(
        input,
        "mailbox_not_connected",
        "Assistant email send skipped: no connected mailbox."
      );
    }

    const provider = MAILBOX_OAUTH_PROVIDERS[identity.provider as MailboxOAuthProviderId];

    const tokenResult = await this.tokenLifecycle.resolveFreshAccessToken(
      input.workspaceId,
      provider.id,
      identity.tokenExpiresAt
    );

    if (tokenResult.kind === "not_connected") {
      return this.skip(
        input,
        "mailbox_not_connected",
        "Assistant email send skipped: no connected mailbox."
      );
    }
    if (tokenResult.kind === "token_invalid") {
      return this.skip(
        input,
        "mailbox_token_invalid",
        "Assistant email send skipped: mailbox token was revoked."
      );
    }
    if (tokenResult.kind === "refresh_unavailable") {
      this.logger.error({
        event: "internal_runtime_email_send.token_refresh_unavailable",
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        message: tokenResult.message
      });
      await this.writeAudit(input, {
        outcome: "failed",
        eventCode: "assistant.email.failed",
        summary: "Assistant email send failed: mailbox token refresh unavailable.",
        details: { reason: "mailbox_token_refresh_failed", message: tokenResult.message }
      });
      return {
        status: "failed",
        reason: "mailbox_token_refresh_failed",
        message: tokenResult.message
      };
    }

    const from =
      identity.displayName !== null
        ? `${identity.displayName} <${identity.email}>`
        : identity.email;

    const outcome = await this.smtpClient.send({
      host: provider.smtp.host,
      port: provider.smtp.port,
      user: identity.email,
      accessToken: tokenResult.accessToken,
      from,
      to: input.to,
      subject: input.subject,
      text: input.body
    });

    if (outcome.kind === "network_error") {
      this.logger.error({
        event: "internal_runtime_email_send.network_error",
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        error: outcome.message
      });
      await this.writeAudit(input, {
        outcome: "failed",
        eventCode: "assistant.email.failed",
        summary: "Assistant email send failed: network error.",
        details: { reason: "email_send_error", message: outcome.message }
      });
      return { status: "failed", reason: "email_send_error", message: outcome.message };
    }

    if (outcome.kind === "rejected") {
      if (isProviderQuotaRejection(outcome)) {
        this.logger.warn({
          event: "internal_runtime_email_send.provider_quota_rejected",
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          responseCode: outcome.responseCode,
          message: outcome.message
        });
        return this.skip(
          input,
          "provider_daily_limit_reached",
          "Assistant email send skipped: provider daily send limit reached.",
          outcome.message
        );
      }
      this.logger.warn({
        event: "internal_runtime_email_send.smtp_rejected",
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        responseCode: outcome.responseCode,
        message: outcome.message
      });
      await this.writeAudit(input, {
        outcome: "failed",
        eventCode: "assistant.email.failed",
        summary: "Assistant email send failed: mailbox provider rejected the message.",
        details: { reason: "smtp_rejected", message: outcome.message }
      });
      return { status: "failed", reason: "smtp_rejected", message: outcome.message };
    }

    this.logger.log({
      event: "internal_runtime_email_send.sent",
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      messageId: outcome.messageId
    });
    await this.writeAudit(input, {
      outcome: "succeeded",
      eventCode: "assistant.email.sent",
      summary: "Assistant email sent.",
      details: { messageId: outcome.messageId }
    });
    return { status: "sent", messageId: outcome.messageId };
  }

  private async skip(
    input: InternalRuntimeEmailSendInput,
    reason: "mailbox_not_connected" | "mailbox_token_invalid" | "provider_daily_limit_reached",
    summary: string,
    message?: string
  ): Promise<InternalRuntimeEmailSendResult> {
    await this.writeAudit(input, {
      outcome: "denied",
      eventCode: "assistant.email.skipped",
      summary,
      details: { reason, ...(message !== undefined ? { message } : {}) }
    });
    return { status: "skipped", reason, ...(message !== undefined ? { message } : {}) };
  }

  private async writeAudit(
    input: InternalRuntimeEmailSendInput,
    event: {
      outcome: "succeeded" | "failed" | "degraded" | "denied";
      eventCode: string;
      summary: string;
      details: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.appendAssistantAuditEventService.execute({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      actorUserId: null,
      eventCategory: "assistant_email",
      eventCode: event.eventCode,
      summary: event.summary,
      outcome: event.outcome,
      details: {
        recipient: input.to,
        subject: input.subject,
        chatId: input.chatId,
        requestId: input.requestId,
        ...event.details
      }
    });
  }
}
