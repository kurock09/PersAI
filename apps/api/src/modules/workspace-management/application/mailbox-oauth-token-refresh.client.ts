import { Injectable } from "@nestjs/common";
import type { MailboxOAuthHttpOutcome } from "./mailbox-oauth-token-exchange.client";

const MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS = 10_000;

/**
 * ADR-169 S3 — thin transport for the mailbox OAuth `refresh_token` grant.
 * A sibling of `MailboxOAuthTokenExchangeClientService` (S2,
 * `authorization_code` grant only) rather than an extension of it: S2's
 * client is locked as already-landed foundation, so the refresh grant gets
 * its own equally-thin transport instead of a modification. Owns only the
 * HTTP POST, the bounded AbortController timeout, and the JSON parse; it
 * never resolves secrets and never decides what a caller does with the
 * response body.
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

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(params.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: body.toString(),
        signal: controller.signal
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network_error", message };
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { kind: "http_error", httpStatus: response.status, body: responseBody };
    }
    return { kind: "success", httpStatus: response.status, body: responseBody };
  }
}
