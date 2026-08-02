import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import {
  MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS,
  MailboxOAuthTokenRefreshClientService
} from "./mailbox-oauth-token-refresh.client";
import {
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProviderId
} from "./mailbox-oauth-provider-registry";
import { mailboxOAuthSecretProviderKey } from "./mailbox-oauth-secret-key";
import { SchedulerLeaseService } from "./scheduler-lease.service";

/** ADR-169 S3 — refresh ahead of expiry rather than racing the provider's own clock. */
const TOKEN_EXPIRY_SKEW_MS = 2 * 60 * 1000;

/**
 * ADR-169 repair — Mail.ru/Yandex rotate refresh tokens on every use, so two
 * concurrent sends racing the same stale refresh token would make the
 * loser's now-consumed token look exactly like a revoked grant. This is the
 * same per-key dynamic lease `ChatWakeCoordinator` already uses for
 * `async-catchup:{chatId}` (`SchedulerLeaseService.acquireOrCreate`) —
 * reused here rather than inventing a second locking mechanism.
 */
const MAILBOX_REFRESH_LOCK_PREFIX = "mailbox-refresh:";
const MAILBOX_REFRESH_LOCK_TTL_MS = 15_000;
/**
 * The winner's critical section is the provider HTTP round trip
 * (`MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS`) plus two secret-store resolves
 * and a Prisma update, so an acquire timeout shorter than that HTTP timeout
 * would let a waiter give up before the winner's refresh could possibly have
 * finished — failing a concurrent send that the winner's own refresh would
 * have unblocked a moment later. Derived from, not just larger than, the
 * timeout it guards, so the two cannot silently drift apart again.
 */
export const MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS =
  MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS + 5_000;
const MAILBOX_REFRESH_LOCK_POLL_INTERVAL_MS = 150;
/**
 * ADR-169 repair — both v1 providers document `expires_in` on every token
 * response, but a refresh response that omits it anyway must not be
 * recorded as `tokenExpiresAt: null`: `isExpiringSoon(null)` is `true`, so
 * the very next send would refresh again, and every subsequent one after
 * that, forever. This is a bounded local assumption, not provider-reported
 * truth — deliberately shorter than either provider's real token lifetime
 * (about an hour) so the fallback stays on the safe (more-frequent-refresh)
 * side.
 */
const MAILBOX_REFRESH_ASSUMED_TTL_MS = 5 * 60 * 1000;

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
 *
 * Refresh is serialized per workspace behind the existing dynamic scheduler
 * lease (see `MAILBOX_REFRESH_LOCK_PREFIX` below) because both v1 providers
 * rotate refresh tokens on use: without the lock, a losing concurrent call
 * would present an already-consumed refresh token and get `invalid_grant`
 * back, indistinguishable from a real revocation.
 */
@Injectable()
export class MailboxTokenLifecycleService {
  private readonly logger = new Logger(MailboxTokenLifecycleService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly tokenRefreshClient: MailboxOAuthTokenRefreshClientService,
    private readonly schedulerLease: SchedulerLeaseService
  ) {}

  async resolveFreshAccessToken(
    workspaceId: string,
    provider: MailboxOAuthProviderId,
    tokenExpiresAt: Date | null,
    options?: { forceRefresh?: boolean }
  ): Promise<MailboxTokenLifecycleResult> {
    const bundle = await this.loadTokenBundle(workspaceId);
    if (bundle === null) {
      return { kind: "not_connected" };
    }

    // Cheap unlocked fast path: the caller-supplied `tokenExpiresAt` can be
    // a hair stale, but that only ever costs an unnecessary lock attempt
    // below, never a wrong "ready" — the locked re-check is what decides.
    if (!options?.forceRefresh && !this.isExpiringSoon(tokenExpiresAt)) {
      return { kind: "ready", accessToken: bundle.accessToken };
    }

    const lockKey = this.refreshLockKey(workspaceId);
    const lock = await this.acquireRefreshLock(lockKey);
    if (lock === null) {
      return {
        kind: "refresh_unavailable",
        message: "Mailbox token refresh is already in progress for this workspace."
      };
    }
    try {
      // Re-read under the per-workspace lock: a concurrent call that just
      // won the race already wrote a fresh bundle/expiry, so the token that
      // looked "expiring soon" a moment ago may already be replaced. Reusing
      // it here — instead of refreshing again with our own now-stale
      // `refreshToken` — is exactly what stops the loser's rotated-away
      // token from coming back `invalid_grant` and mislabeling a healthy
      // mailbox.
      const freshBundle = await this.loadTokenBundle(workspaceId);
      if (freshBundle === null) {
        return { kind: "not_connected" };
      }
      const freshRow = await this.prisma.workspaceEmailSenderIdentity.findUnique({
        where: { workspaceId },
        select: { tokenExpiresAt: true }
      });
      if (!options?.forceRefresh && !this.isExpiringSoon(freshRow?.tokenExpiresAt ?? null)) {
        return { kind: "ready", accessToken: freshBundle.accessToken };
      }

      if (freshBundle.refreshToken === null) {
        // Expiring/expired with nothing to refresh with is functionally the
        // same dead end as a revoked grant: fail closed the same way.
        await this.markTokenInvalid(workspaceId);
        return { kind: "token_invalid" };
      }

      return await this.refresh(workspaceId, provider, freshBundle.refreshToken);
    } finally {
      await this.schedulerLease.releaseKey(lockKey, lock.token);
    }
  }

  private refreshLockKey(workspaceId: string): string {
    return `${MAILBOX_REFRESH_LOCK_PREFIX}${workspaceId}`;
  }

  /**
   * Polls the existing dynamic scheduler lease rather than blocking a
   * database transaction across the provider's network round trip. Bounded
   * by `MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS`; a lock that cannot be
   * acquired in time degrades to `refresh_unavailable` (never a silent
   * success and never a wrongful `token_invalid`).
   */
  private async acquireRefreshLock(lockKey: string): Promise<{ token: string } | null> {
    const deadline = Date.now() + MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS;
    for (;;) {
      const lock = await this.schedulerLease.acquireOrCreate(lockKey, {
        ttlMs: MAILBOX_REFRESH_LOCK_TTL_MS
      });
      if (lock !== null) {
        return lock;
      }
      if (Date.now() >= deadline) {
        return null;
      }
      await this.sleep(MAILBOX_REFRESH_LOCK_POLL_INTERVAL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
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
      expiresInSeconds !== null
        ? new Date(Date.now() + expiresInSeconds * 1000)
        : new Date(Date.now() + MAILBOX_REFRESH_ASSUMED_TTL_MS);

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

  /**
   * ADR-169 repair — an unknown expiry is not evidence of validity. Both v1
   * providers document `expires_in` on every token response, so a null
   * `tokenExpiresAt` means a prior response was missing it, not that the
   * token is good forever. Chosen behaviour: treat "unknown" the same as
   * "due for refresh" rather than "never refresh again" — worst case is an
   * extra refresh call; the alternative (this branch's prior behaviour) was
   * a mailbox that silently stopped refreshing forever.
   */
  private isExpiringSoon(tokenExpiresAt: Date | null): boolean {
    if (tokenExpiresAt === null) {
      return true;
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

  /**
   * Public so `InternalRuntimeEmailSendService` can flip a mailbox to
   * `token_invalid` when the SMTP layer classifies a send-time rejection as
   * an authentication failure — the same fail-closed destination as a
   * refresh-time revocation, reached from a different detection point.
   */
  async markTokenInvalid(workspaceId: string): Promise<void> {
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
