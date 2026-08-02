import { Injectable } from "@nestjs/common";
import { postMailboxOAuthTokenForm } from "./mailbox-oauth-http-transport";

const MAILBOX_OAUTH_HTTP_TIMEOUT_MS = 10_000;

export type MailboxOAuthHttpOutcome =
  | { kind: "success"; httpStatus: number; body: Record<string, unknown> }
  | { kind: "network_error"; message: string }
  | { kind: "http_error"; httpStatus: number; body: Record<string, unknown> };

/**
 * ADR-169 S2 — thin transport for the mailbox OAuth token endpoint and the
 * provider userinfo endpoint. Owns only the HTTP call, the bounded
 * AbortController timeout, and the JSON parse; it never resolves secrets and
 * never decides what a caller does with the response body.
 */
@Injectable()
export class MailboxOAuthTokenExchangeClientService {
  async exchangeCode(params: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<MailboxOAuthHttpOutcome> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret
    });
    return this.post(params.tokenEndpoint, body);
  }

  async fetchUserInfo(params: {
    userInfoEndpoint: string;
    accessToken: string;
    accessTokenTransport: "bearer_header" | "query_parameter";
  }): Promise<MailboxOAuthHttpOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, MAILBOX_OAUTH_HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      const userInfoUrl = new URL(params.userInfoEndpoint);
      if (params.accessTokenTransport === "query_parameter") {
        userInfoUrl.searchParams.set("access_token", params.accessToken);
      }
      response = await fetch(userInfoUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(params.accessTokenTransport === "bearer_header"
            ? { Authorization: `Bearer ${params.accessToken}` }
            : {})
        },
        signal: controller.signal
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network_error", message };
    } finally {
      clearTimeout(timeout);
    }

    return this.parseResponse(response);
  }

  private async post(url: string, body: URLSearchParams): Promise<MailboxOAuthHttpOutcome> {
    return postMailboxOAuthTokenForm(url, body, MAILBOX_OAUTH_HTTP_TIMEOUT_MS);
  }

  private async parseResponse(response: Response): Promise<MailboxOAuthHttpOutcome> {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { kind: "http_error", httpStatus: response.status, body };
    }
    return { kind: "success", httpStatus: response.status, body };
  }
}
