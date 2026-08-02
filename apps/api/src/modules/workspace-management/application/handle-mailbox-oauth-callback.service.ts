import { createHash } from "node:crypto";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { MailboxOAuthTokenExchangeClientService } from "./mailbox-oauth-token-exchange.client";
import {
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProviderId
} from "./mailbox-oauth-provider-registry";
import {
  buildMailboxConnectAppRedirectUrl,
  resolveMailboxOAuthCallbackRedirectUri
} from "./mailbox-oauth-redirect";
import { mailboxOAuthSecretProviderKey } from "./mailbox-oauth-secret-key";
import { MailboxSmtpSendClientService } from "./mailbox-smtp-send.client";

export type MailboxOAuthCallbackInput = { code: string; state: string };
export type MailboxOAuthCallbackOutcome = { redirectUrl: string };

/**
 * ADR-169 D11 — the provider redirect target has no Clerk session; the
 * single-use, expiring `state` bound to the workspace is its only guard.
 * State validation failures throw (the OpenAPI contract returns 400 JSON for
 * an invalid/expired/replayed link); everything past that point degrades to
 * a redirect with an opaque failure marker, never a rendered provider error.
 */
@Injectable()
export class HandleMailboxOAuthCallbackService {
  private readonly logger = new Logger(HandleMailboxOAuthCallbackService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly tokenExchangeClient: MailboxOAuthTokenExchangeClientService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly smtpClient: MailboxSmtpSendClientService
  ) {}

  async handle(input: MailboxOAuthCallbackInput): Promise<MailboxOAuthCallbackOutcome> {
    const stateHash = createHash("sha256").update(input.state).digest("hex");
    const now = new Date();

    const stateRow = await this.prisma.workspaceEmailOAuthState.findUnique({
      where: { stateHash }
    });
    if (
      stateRow === null ||
      stateRow.consumedAt !== null ||
      stateRow.expiresAt.getTime() <= now.getTime()
    ) {
      throw this.stateInvalidError();
    }

    // Atomic single-use consume: a concurrent replay races this UPDATE and
    // loses (count 0), so it cannot also complete the connect.
    const consumed = await this.prisma.workspaceEmailOAuthState.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    if (consumed.count !== 1) {
      throw this.stateInvalidError();
    }

    const workspaceId = stateRow.workspaceId;
    const provider = MAILBOX_OAUTH_PROVIDERS[stateRow.provider as MailboxOAuthProviderId];

    try {
      return { redirectUrl: await this.completeConnect(workspaceId, provider, input.code) };
    } catch (error) {
      this.logger.warn({
        event: "mailbox_oauth.callback_failed",
        workspaceId,
        provider: provider.id,
        message: error instanceof Error ? error.message : String(error)
      });
      return { redirectUrl: buildMailboxConnectAppRedirectUrl("error") };
    }
  }

  private async completeConnect(
    workspaceId: string,
    provider: (typeof MAILBOX_OAUTH_PROVIDERS)[MailboxOAuthProviderId],
    code: string
  ): Promise<string> {
    const redirectUri = resolveMailboxOAuthCallbackRedirectUri();
    if (redirectUri === null) {
      this.logger.warn({ event: "mailbox_oauth.redirect_uri_unavailable", workspaceId });
      return buildMailboxConnectAppRedirectUrl("error");
    }

    let clientId: string;
    let clientSecret: string;
    try {
      clientId = await this.secretStore.resolveSecretValueById(provider.clientIdSecretId);
      clientSecret = await this.secretStore.resolveSecretValueById(provider.clientSecretSecretId);
    } catch {
      this.logger.warn({
        event: "mailbox_oauth.credentials_unavailable",
        workspaceId,
        provider: provider.id
      });
      return buildMailboxConnectAppRedirectUrl("error");
    }

    const tokenOutcome = await this.tokenExchangeClient.exchangeCode({
      tokenEndpoint: provider.tokenEndpoint,
      clientId,
      clientSecret,
      code,
      redirectUri
    });
    if (tokenOutcome.kind !== "success") {
      this.logger.warn({
        event: "mailbox_oauth.token_exchange_failed",
        workspaceId,
        provider: provider.id,
        kind: tokenOutcome.kind
      });
      return buildMailboxConnectAppRedirectUrl("error");
    }

    const accessToken = this.readStringField(tokenOutcome.body, "access_token");
    if (accessToken === null) {
      this.logger.warn({
        event: "mailbox_oauth.access_token_missing",
        workspaceId,
        provider: provider.id
      });
      return buildMailboxConnectAppRedirectUrl("error");
    }
    const refreshToken = this.readStringField(tokenOutcome.body, "refresh_token");
    const expiresInSeconds = this.readNumberField(tokenOutcome.body, "expires_in");
    if (refreshToken === null) {
      this.logger.warn({
        event: "mailbox_oauth.refresh_token_missing",
        workspaceId,
        provider: provider.id
      });
      return buildMailboxConnectAppRedirectUrl("error");
    }

    const email = await this.resolveMailboxEmail(provider, tokenOutcome.body, accessToken);
    if (email === null) {
      this.logger.warn({
        event: "mailbox_oauth.email_unresolved",
        workspaceId,
        provider: provider.id
      });
      return buildMailboxConnectAppRedirectUrl("error");
    }

    await this.secretStore.upsertProviderKey(
      mailboxOAuthSecretProviderKey(workspaceId),
      JSON.stringify({ accessToken, refreshToken }),
      null
    );

    const connectedAt = new Date();
    const tokenExpiresAt =
      expiresInSeconds !== null ? new Date(connectedAt.getTime() + expiresInSeconds * 1000) : null;

    await this.prisma.workspaceEmailSenderIdentity.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        email,
        displayName: null,
        provider: provider.id,
        mailboxStatus: WorkspaceEmailMailboxStatus.connected,
        tokenExpiresAt,
        connectedAt,
        lastErrorReason: null
      },
      update: {
        email,
        provider: provider.id,
        mailboxStatus: WorkspaceEmailMailboxStatus.connected,
        tokenExpiresAt,
        connectedAt,
        lastErrorReason: null
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId,
      assistantId: null,
      actorUserId: null,
      eventCategory: "channel_binding",
      eventCode: "workspace.email_mailbox_connected",
      summary: `Workspace connected a ${provider.label} mailbox for assistant email sending.`,
      details: { provider: provider.id }
    });

    const smtpOutcome = await this.smtpClient.verify({
      host: provider.smtp.host,
      port: provider.smtp.port,
      user: email,
      accessToken
    });
    if (smtpOutcome.kind === "ready") {
      return buildMailboxConnectAppRedirectUrl("success");
    }
    if (smtpOutcome.kind === "access_not_enabled") {
      await this.prisma.workspaceEmailSenderIdentity.update({
        where: { workspaceId },
        data: {
          mailboxStatus: WorkspaceEmailMailboxStatus.smtp_access_required,
          lastErrorReason: "smtp_access_required"
        }
      });
      return buildMailboxConnectAppRedirectUrl("smtp_access_required");
    }
    if (smtpOutcome.kind === "auth_rejected") {
      await this.prisma.workspaceEmailSenderIdentity.update({
        where: { workspaceId },
        data: {
          mailboxStatus: WorkspaceEmailMailboxStatus.token_invalid,
          lastErrorReason: "smtp_auth_rejected"
        }
      });
    }
    return buildMailboxConnectAppRedirectUrl("error");
  }

  private async resolveMailboxEmail(
    provider: (typeof MAILBOX_OAUTH_PROVIDERS)[MailboxOAuthProviderId],
    tokenBody: Record<string, unknown>,
    accessToken: string
  ): Promise<string | null> {
    const fromToken = this.readStringField(tokenBody, "email");
    if (fromToken !== null) {
      return fromToken;
    }
    const userInfoOutcome = await this.tokenExchangeClient.fetchUserInfo({
      userInfoEndpoint: provider.userInfoEndpoint,
      accessToken,
      accessTokenTransport: provider.userInfoAccessTokenTransport
    });
    if (userInfoOutcome.kind !== "success") {
      return null;
    }
    return this.readStringField(userInfoOutcome.body, provider.userInfoEmailField);
  }

  private readStringField(body: Record<string, unknown>, field: string): string | null {
    const value = body[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readNumberField(body: Record<string, unknown>, field: string): number | null {
    const value = body[field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private stateInvalidError(): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
      code: "mailbox_oauth_state_invalid",
      category: "validation",
      message: "The mailbox connect link is invalid, expired, or already used."
    });
  }
}
