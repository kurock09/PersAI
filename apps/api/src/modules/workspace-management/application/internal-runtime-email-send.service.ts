import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailSenderIdentityStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { NOTIFICATION_CREDENTIAL_IDS } from "./tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { PostmarkEmailSendClientService } from "./postmark-email-send.client";

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";
const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_LENGTH = 20_000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const REJECTED_BODY_KEYS = ["cc", "bcc", "attachments", "html", "htmlBody"];

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
  | { status: "skipped"; reason: "sender_email_not_verified" }
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

/**
 * ADR-168 D3 — internal send used by the `email_send` native tool via
 * `PersaiInternalApiClientService`.
 *
 * Fail-closed (D4): with no verified sender identity this makes **no**
 * Postmark call at all. Sending itself keeps using the existing Server Token
 * credential (`NOTIFICATION_CREDENTIAL_IDS.email_postmark`) — ADR-088's
 * `EmailChannelAdapter` and its sender identity are untouched; this is a
 * separate, synchronous send path with its own sender identity.
 *
 * Daily-limit accounting is intentionally NOT implemented here — the runtime
 * owns that through the existing shared `consumeToolDailyLimit` mechanism.
 */
@Injectable()
export class InternalRuntimeEmailSendService {
  private readonly logger = new Logger(InternalRuntimeEmailSendService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly postmarkEmailSendClient: PostmarkEmailSendClientService
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

    if (identity === null || identity.status !== WorkspaceEmailSenderIdentityStatus.verified) {
      await this.writeAudit(input, {
        outcome: "denied",
        eventCode: "assistant.email.skipped",
        summary: "Assistant email send skipped: no verified sender identity.",
        details: { reason: "sender_email_not_verified" }
      });
      return { status: "skipped", reason: "sender_email_not_verified" };
    }

    const token = await this.secretStore
      .resolveSecretValueById(NOTIFICATION_CREDENTIAL_IDS.email_postmark)
      .catch(() => null);
    if (token === null) {
      await this.writeAudit(input, {
        outcome: "failed",
        eventCode: "assistant.email.failed",
        summary: "Assistant email send failed: Postmark server token unavailable.",
        details: { reason: "postmark_token_unavailable" }
      });
      return { status: "failed", reason: "postmark_token_unavailable" };
    }

    const from =
      identity.displayName !== null
        ? `${identity.displayName} <${identity.email}>`
        : identity.email;

    const outcome = await this.postmarkEmailSendClient.send({
      url: POSTMARK_SEND_URL,
      serverToken: token,
      payload: {
        From: from,
        To: input.to,
        Subject: input.subject,
        TextBody: input.body,
        MessageStream: "outbound",
        Metadata: {
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          requestId: input.requestId,
          source: "assistant_email_send"
        }
      }
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

    const responseBody = outcome.body;

    if (outcome.kind === "http_error") {
      const errorMessage =
        typeof responseBody["Message"] === "string" ? responseBody["Message"] : undefined;
      this.logger.warn({
        event: "internal_runtime_email_send.postmark_rejected",
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        httpStatus: outcome.httpStatus,
        message: errorMessage
      });
      await this.writeAudit(input, {
        outcome: "failed",
        eventCode: "assistant.email.failed",
        summary: "Assistant email send failed: Postmark rejected the message.",
        details: {
          reason: "postmark_rejected",
          httpStatus: outcome.httpStatus,
          message: errorMessage
        }
      });
      return {
        status: "failed",
        reason: "postmark_rejected",
        ...(errorMessage !== undefined ? { message: errorMessage } : {})
      };
    }

    const messageId =
      typeof responseBody["MessageID"] === "string" ? responseBody["MessageID"] : undefined;
    this.logger.log({
      event: "internal_runtime_email_send.sent",
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      messageId
    });
    await this.writeAudit(input, {
      outcome: "succeeded",
      eventCode: "assistant.email.sent",
      summary: "Assistant email sent.",
      details: { messageId: messageId ?? null }
    });
    return { status: "sent", messageId: messageId ?? "" };
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
