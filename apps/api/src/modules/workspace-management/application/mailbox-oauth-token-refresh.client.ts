import { Injectable } from "@nestjs/common";
import type { MailboxOAuthHttpOutcome } from "./mailbox-oauth-token-exchange.client";
import { postMailboxOAuthTokenForm } from "./mailbox-oauth-http-transport";

/**
 * Exported so `MailboxTokenLifecycleService` can size its refresh-lock
 * acquire timeout relative to the round trip it actually guards, instead of
 * two independently-chosen constants silently drifting apart.
 */
export const MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS = 10_000;

/**
 * ADR-169 S3 — thin transport for the mailbox OAuth `refresh_token` grant.
 * A sibling of `MailboxOAuthTokenExchangeClientService` (S2,
 * `authorization_code` grant only) rather than an extension of it: S2's
 * client is locked as already-landed foundation, so the refresh grant gets
 * its own equally-thin transport instead of a modification. Owns only the
 * grant body; the abort-timeout/form-post/parse mechanic is shared with the
 * exchange client via `postMailboxOAuthTokenForm`.
 */
@Injectable()
export class MailboxOAuthTokenRefreshClientService {
  async refresh(params: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<MailboxOAuthHttpOutcome> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret
    });

    return postMailboxOAuthTokenForm(
      params.tokenEndpoint,
      body,
      MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS
    );
  }
}
