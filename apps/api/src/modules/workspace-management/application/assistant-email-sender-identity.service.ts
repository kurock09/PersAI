import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailSenderIdentityStatus } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { NOTIFICATION_CREDENTIAL_IDS } from "./tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { PostmarkAccountSendersClientService } from "./postmark-account-senders.client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 120;
const DEFAULT_SENDER_SIGNATURE_NAME = "PersAI Assistant";
/** ADR-168 D2 — bounded demand-driven re-check, never a background poller. */
const MIN_RECHECK_INTERVAL_MS = 3_000;
const ACCOUNT_TOKEN_UNAVAILABLE_REASON = "postmark_account_token_unavailable";

export type WorkspaceEmailSenderIdentityStatusView = "pending" | "verified" | "failed";

export type WorkspaceEmailSenderIdentityView = {
  email: string;
  displayName: string | null;
  status: WorkspaceEmailSenderIdentityStatusView;
  verifiedAt: string | null;
  lastErrorReason: string | null;
};

export type RequestWorkspaceEmailSenderIdentityInput = {
  email: string;
  displayName: string | null;
};

function toStatusView(
  status: WorkspaceEmailSenderIdentityStatus
): WorkspaceEmailSenderIdentityStatusView {
  return status;
}

/**
 * ADR-168 S1 — workspace-scoped verified sender identity lifecycle:
 * request/replace, bounded re-check, resend confirmation, remove.
 *
 * Reads the Postmark Account API token exclusively via
 * `PlatformRuntimeProviderSecretStoreService.resolveSecretValueById` (never
 * `resolveSecretValueByProviderKey` — see the documented `EmailChannelAdapter`
 * bug this ADR must not repeat). No `process.env` fallback.
 */
@Injectable()
export class AssistantEmailSenderIdentityService {
  private readonly logger = new Logger(AssistantEmailSenderIdentityService.name);
  /** In-service only (no new table) — last remote re-check attempt per workspace. */
  private readonly lastRecheckAttemptAtByWorkspace = new Map<string, number>();

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly postmarkSendersClient: PostmarkAccountSendersClientService
  ) {}

  parseRequestInput(body: unknown): RequestWorkspaceEmailSenderIdentityInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "email_sender_invalid_body",
        category: "validation",
        message: "Request body must be an object."
      });
    }
    const record = body as Record<string, unknown>;
    const emailRaw = record["email"];
    if (typeof emailRaw !== "string" || emailRaw.trim().length === 0) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "email_sender_invalid_email",
        category: "validation",
        message: "email is required."
      });
    }
    const email = emailRaw.trim();
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "email_sender_invalid_email",
        category: "validation",
        message: "email must be a valid email address."
      });
    }

    const displayNameRaw = record["displayName"];
    let displayName: string | null = null;
    if (displayNameRaw !== undefined && displayNameRaw !== null) {
      if (typeof displayNameRaw !== "string") {
        throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
          code: "email_sender_invalid_display_name",
          category: "validation",
          message: "displayName must be a string."
        });
      }
      const trimmed = displayNameRaw.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
          throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
            code: "email_sender_invalid_display_name",
            category: "validation",
            message: `displayName must be at most ${String(MAX_DISPLAY_NAME_LENGTH)} characters.`
          });
        }
        displayName = trimmed;
      }
    }

    return { email, displayName };
  }

  async readIdentity(
    workspaceId: string,
    options: { recheck: boolean }
  ): Promise<WorkspaceEmailSenderIdentityView | null> {
    const row = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });
    if (row === null) {
      return null;
    }

    if (row.status !== WorkspaceEmailSenderIdentityStatus.pending || !options.recheck) {
      return this.toView(row);
    }
    if (row.postmarkSignatureId === null) {
      return this.toView(row);
    }
    if (!this.consumeRecheckBudget(workspaceId)) {
      return this.toView(row);
    }

    const token = await this.resolveAccountToken();
    if (token === null) {
      const updated = await this.prisma.workspaceEmailSenderIdentity.update({
        where: { workspaceId },
        data: { lastErrorReason: ACCOUNT_TOKEN_UNAVAILABLE_REASON }
      });
      this.logger.warn({
        event: "email_sender_identity.recheck_no_token",
        workspaceId
      });
      return this.toView(updated);
    }

    const result = await this.postmarkSendersClient.getSignature(token, row.postmarkSignatureId);
    if (!result.ok) {
      this.logger.warn({
        event: "email_sender_identity.recheck_failed",
        workspaceId,
        signatureId: row.postmarkSignatureId,
        reason: result.reason,
        httpStatus: result.httpStatus
      });
      // A definitive "signature no longer exists" rejection invalidates the
      // pending row; other (transient/network) failures keep it pending and
      // only surface the reason so the next re-check can still succeed.
      const signatureGone = result.reason === "postmark_error" && result.httpStatus === 404;
      const updated = await this.prisma.workspaceEmailSenderIdentity.update({
        where: { workspaceId },
        data: {
          lastErrorReason: result.message ?? result.reason,
          ...(signatureGone ? { status: WorkspaceEmailSenderIdentityStatus.failed } : {})
        }
      });
      return this.toView(updated);
    }

    if (!result.data.confirmed) {
      const updated =
        row.lastErrorReason === null
          ? row
          : await this.prisma.workspaceEmailSenderIdentity.update({
              where: { workspaceId },
              data: { lastErrorReason: null }
            });
      return this.toView(updated);
    }

    const updated = await this.prisma.workspaceEmailSenderIdentity.update({
      where: { workspaceId },
      data: {
        status: WorkspaceEmailSenderIdentityStatus.verified,
        verifiedAt: new Date(),
        lastErrorReason: null
      }
    });
    this.logger.log({
      event: "email_sender_identity.verified",
      workspaceId,
      signatureId: row.postmarkSignatureId
    });
    return this.toView(updated);
  }

  async requestIdentity(
    workspaceId: string,
    input: RequestWorkspaceEmailSenderIdentityInput
  ): Promise<WorkspaceEmailSenderIdentityView> {
    const token = await this.resolveAccountToken();
    if (token === null) {
      throw this.createAccountTokenUnavailableError();
    }

    const existing = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });

    if (existing !== null && existing.postmarkSignatureId !== null) {
      const deleteResult = await this.postmarkSendersClient.deleteSignature(
        token,
        existing.postmarkSignatureId
      );
      if (!deleteResult.ok) {
        // The previous signature may already be gone on Postmark's side (e.g.
        // manually revoked). Log and proceed with create — we must not block
        // an explicit replace on a stale signature we can no longer manage.
        this.logger.warn({
          event: "email_sender_identity.replace_delete_failed",
          workspaceId,
          previousSignatureId: existing.postmarkSignatureId,
          reason: deleteResult.reason,
          httpStatus: deleteResult.httpStatus
        });
      }
    }

    const createResult = await this.postmarkSendersClient.createSignature(token, {
      fromEmail: input.email,
      name: input.displayName ?? DEFAULT_SENDER_SIGNATURE_NAME
    });

    if (!createResult.ok) {
      this.logger.warn({
        event: "email_sender_identity.create_failed",
        workspaceId,
        email: input.email,
        reason: createResult.reason,
        httpStatus: createResult.httpStatus
      });
      const failed = await this.prisma.workspaceEmailSenderIdentity.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          email: input.email,
          displayName: input.displayName,
          status: WorkspaceEmailSenderIdentityStatus.failed,
          postmarkSignatureId: null,
          lastErrorReason: createResult.message ?? createResult.reason,
          requestedAt: new Date(),
          verifiedAt: null
        },
        update: {
          email: input.email,
          displayName: input.displayName,
          status: WorkspaceEmailSenderIdentityStatus.failed,
          postmarkSignatureId: null,
          lastErrorReason: createResult.message ?? createResult.reason,
          requestedAt: new Date(),
          verifiedAt: null
        }
      });
      return this.toView(failed);
    }

    const created = await this.prisma.workspaceEmailSenderIdentity.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        email: input.email,
        displayName: input.displayName,
        status: WorkspaceEmailSenderIdentityStatus.pending,
        postmarkSignatureId: String(createResult.data.id),
        lastErrorReason: null,
        requestedAt: new Date(),
        verifiedAt: null
      },
      update: {
        email: input.email,
        displayName: input.displayName,
        status: WorkspaceEmailSenderIdentityStatus.pending,
        postmarkSignatureId: String(createResult.data.id),
        lastErrorReason: null,
        requestedAt: new Date(),
        verifiedAt: null
      }
    });
    this.logger.log({
      event: "email_sender_identity.requested",
      workspaceId,
      signatureId: created.postmarkSignatureId
    });
    return this.toView(created);
  }

  async resendConfirmation(workspaceId: string): Promise<WorkspaceEmailSenderIdentityView> {
    const existing = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });
    if (existing === null || existing.postmarkSignatureId === null) {
      throw new ApiErrorHttpException(HttpStatus.NOT_FOUND, {
        code: "email_sender_not_found",
        category: "validation",
        message: "No sender identity is pending confirmation for this workspace."
      });
    }

    const token = await this.resolveAccountToken();
    if (token === null) {
      throw this.createAccountTokenUnavailableError();
    }

    const result = await this.postmarkSendersClient.resendConfirmation(
      token,
      existing.postmarkSignatureId
    );
    if (!result.ok) {
      const updated = await this.prisma.workspaceEmailSenderIdentity.update({
        where: { workspaceId },
        data: { lastErrorReason: result.message ?? result.reason }
      });
      this.logger.warn({
        event: "email_sender_identity.resend_failed",
        workspaceId,
        reason: result.reason,
        httpStatus: result.httpStatus
      });
      return this.toView(updated);
    }

    const updated = await this.prisma.workspaceEmailSenderIdentity.update({
      where: { workspaceId },
      data: { lastErrorReason: null }
    });
    return this.toView(updated);
  }

  async removeIdentity(workspaceId: string): Promise<void> {
    const existing = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });
    if (existing === null) {
      return;
    }

    if (existing.postmarkSignatureId !== null) {
      const token = await this.resolveAccountToken();
      if (token !== null) {
        const result = await this.postmarkSendersClient.deleteSignature(
          token,
          existing.postmarkSignatureId
        );
        if (!result.ok) {
          this.logger.warn({
            event: "email_sender_identity.remove_delete_failed",
            workspaceId,
            signatureId: existing.postmarkSignatureId,
            reason: result.reason,
            httpStatus: result.httpStatus
          });
        }
      } else {
        this.logger.warn({
          event: "email_sender_identity.remove_no_token",
          workspaceId,
          signatureId: existing.postmarkSignatureId
        });
      }
    }

    await this.prisma.workspaceEmailSenderIdentity.delete({ where: { workspaceId } });
  }

  private consumeRecheckBudget(workspaceId: string): boolean {
    const now = Date.now();
    const last = this.lastRecheckAttemptAtByWorkspace.get(workspaceId);
    if (last !== undefined && now - last < MIN_RECHECK_INTERVAL_MS) {
      return false;
    }
    this.lastRecheckAttemptAtByWorkspace.set(workspaceId, now);
    return true;
  }

  private async resolveAccountToken(): Promise<string | null> {
    // resolveSecretValueById(secretId) is the correct call here — it maps
    // secretId -> providerKey internally. Calling resolveSecretValueByProviderKey
    // with NOTIFICATION_CREDENTIAL_IDS.email_postmark_account (a secretId, not a
    // providerKey) is the documented past bug this must not repeat.
    return this.secretStore
      .resolveSecretValueById(NOTIFICATION_CREDENTIAL_IDS.email_postmark_account)
      .catch(() => null);
  }

  private createAccountTokenUnavailableError(): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: ACCOUNT_TOKEN_UNAVAILABLE_REASON,
      category: "infra",
      message:
        "Postmark Account API token is not configured. Configure it in Admin > Tools before verifying a sender address."
    });
  }

  private toView(row: {
    email: string;
    displayName: string | null;
    status: WorkspaceEmailSenderIdentityStatus;
    verifiedAt: Date | null;
    lastErrorReason: string | null;
  }): WorkspaceEmailSenderIdentityView {
    return {
      email: row.email,
      displayName: row.displayName,
      status: toStatusView(row.status),
      verifiedAt: row.verifiedAt !== null ? row.verifiedAt.toISOString() : null,
      lastErrorReason: row.lastErrorReason
    };
  }
}
