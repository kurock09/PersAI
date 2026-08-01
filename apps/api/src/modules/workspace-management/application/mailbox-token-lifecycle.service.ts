import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { MailboxOAuthTokenRefreshClientService } from "./mailbox-oauth-token-refresh.client";
import {
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProviderId
} from "./mailbox-oauth-provider-registry";
import { mailboxOAuthSecretProviderKey } from "./assistant-email-mailbox.service";

/** ADR-169 S3 — refresh ahead of expiry rather than racing the provider's own clock. */
const TOKEN_EXPIRY_SKEW_MS = 2 * 60 * 1000;

export type MailboxTokenLifecycleResult =
  | { kind: "ready"; accessToken: string }
  | { kind: "not_connected" }
  | { kind: "token_invalid" }
  | { kind: "refresh_unavailable"; message: string };

type MailboxTokenBundle = { accessToken: string; refreshToken: string | null };

/**
 * ADR-169 D6/D9 — resolves a fresh access token for a connected mailbox
 * ahead of every SMTP send. Loads the encrypted token bundle, refreshes it
 * at the provider token endpoint when expired or within skew of expiring,
 * and persists the refreshed bundle/expiry. A refresh rejected because the
 * user revoked access (`invalid_grant`, RFC 6749 §5.2 — the standard OAuth2
 * code for an invalid/expired/revoked grant, and the only revocation signal
 * either provider's ordinary token-endpoint error shape gives us) flips
 * `mailboxStatus` to `token_invalid` and returns fail-closed; this service
 * never retries and never falls back to another transport.
 */
@Injectable()
export class MailboxTokenLifecycleService {
  private readonly logger = new Logger(MailboxTokenLifecycleService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly tokenRefreshClient: MailboxOAuthTokenRefreshClientService
  ) {}

  async resolveFreshAccessToken(
    workspaceId: string,
    provider: MailboxOAuthProviderId,
    tokenExpiresAt: Date | null
  ): Promise<MailboxTokenLifecycleResult> {
    const bundle = await this.loadTokenBundle(workspaceId);
    if (bundle === null) {
      return { kind: "not_connected" };
    }

    if (!this.isExpiringSoon(tokenExpiresAt)) {
      return { kind: "ready", accessToken: bundle.accessToken };
    }

    if (bundle.refreshToken === null) {
      // Expiring/expired with nothing to refresh with is functionally the
      // same dead end as a revoked grant: fail closed the same way.
      await this.markTokenInvalid(workspaceId);
      return { kind: "token_invalid" };
    }

    return this.refresh(workspaceId, provider, bundle.refreshToken);
  }

  private async refresh(
    workspaceId: string,
    provider: MailboxOAuthProviderId,
    refreshToken: string
  ): Promise<MailboxTokenLifecycleResult> {
    const providerConfig = MAILBOX_OAUTH_PROVIDERS[provider];

    let clientId: string;
    let clientSecret: string;
    try {
      clientId = await this.secretStore.resolveSecretValueById(providerConfig.clientIdSecretId);
      clientSecret = await this.secretStore.resolveSecretValueById(
        providerConfig.clientSecretSecretId
      );
    } catch (err) {
      return { kind: "refresh_unavailable", message: this.readErrorMessage(err) };
    }

    const outcome = await this.tokenRefreshClient.refresh({
      tokenEndpoint: providerConfig.tokenEndpoint,
      clientId,
      clientSecret,
      refreshToken
    });

    if (outcome.kind === "network_error") {
      this.logger.warn({
        event: "mailbox_token_lifecycle.refresh_network_error",
        workspaceId,
        provider,
        message: outcome.message
      });
      return { kind: "refresh_unavailable", message: outcome.message };
    }

    if (outcome.kind === "http_error") {
      if (this.isRevokedGrant(outcome.body)) {
        this.logger.warn({
          event: "mailbox_token_lifecycle.refresh_revoked",
          workspaceId,
          provider
        });
        await this.markTokenInvalid(workspaceId);
        return { kind: "token_invalid" };
      }
      const message =
        this.readStringField(outcome.body, "error_description") ??
        `HTTP ${String(outcome.httpStatus)}`;
      this.logger.warn({
        event: "mailbox_token_lifecycle.refresh_rejected",
        workspaceId,
        provider,
        httpStatus: outcome.httpStatus,
        message
      });
      return { kind: "refresh_unavailable", message };
    }

    const accessToken = this.readStringField(outcome.body, "access_token");
    if (accessToken === null) {
      return {
        kind: "refresh_unavailable",
        message: "Provider token refresh response is missing access_token."
      };
    }
    const newRefreshToken = this.readStringField(outcome.body, "refresh_token") ?? refreshToken;
    const expiresInSeconds = this.readNumberField(outcome.body, "expires_in");
    const tokenExpiresAt =
      expiresInSeconds !== null ? new Date(Date.now() + expiresInSeconds * 1000) : null;

    await this.secretStore.upsertProviderKey(
      mailboxOAuthSecretProviderKey(workspaceId),
      JSON.stringify({ accessToken, refreshToken: newRefreshToken }),
      null
    );
    await this.prisma.workspaceEmailSenderIdentity.update({
      where: { workspaceId },
      data: { tokenExpiresAt }
    });

    this.logger.log({ event: "mailbox_token_lifecycle.refreshed", workspaceId, provider });
    return { kind: "ready", accessToken };
  }

  private isExpiringSoon(tokenExpiresAt: Date | null): boolean {
    // No expiry on record means the provider never told us one; there is no
    // evidence a refresh is needed, so use the stored token as-is.
    if (tokenExpiresAt === null) {
      return false;
    }
    return tokenExpiresAt.getTime() - Date.now() <= TOKEN_EXPIRY_SKEW_MS;
  }

  private async loadTokenBundle(workspaceId: string): Promise<MailboxTokenBundle | null> {
    const raw = await this.secretStore.resolveSecretValueByProviderKey(
      mailboxOAuthSecretProviderKey(workspaceId)
    );
    if (raw === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
      if (typeof parsed.accessToken !== "string" || parsed.accessToken.trim().length === 0) {
        return null;
      }
      const refreshToken =
        typeof parsed.refreshToken === "string" && parsed.refreshToken.trim().length > 0
          ? parsed.refreshToken
          : null;
      return { accessToken: parsed.accessToken, refreshToken };
    } catch {
      return null;
    }
  }

  private async markTokenInvalid(workspaceId: string): Promise<void> {
    await this.prisma.workspaceEmailSenderIdentity.update({
      where: { workspaceId },
      data: { mailboxStatus: WorkspaceEmailMailboxStatus.token_invalid }
    });
  }

  private isRevokedGrant(body: Record<string, unknown>): boolean {
    return body["error"] === "invalid_grant";
  }

  private readStringField(body: Record<string, unknown>, field: string): string | null {
    const value = body[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readNumberField(body: Record<string, unknown>, field: string): number | null {
    const value = body[field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private readErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
