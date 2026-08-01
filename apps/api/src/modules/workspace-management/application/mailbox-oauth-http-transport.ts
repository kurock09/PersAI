import type { MailboxOAuthHttpOutcome } from "./mailbox-oauth-token-exchange.client";

/**
 * ADR-169 — the single abort-timeout / form-post / JSON-parse mechanic for
 * the mailbox OAuth token endpoint. `MailboxOAuthTokenExchangeClientService`
 * (`authorization_code`) and `MailboxOAuthTokenRefreshClientService`
 * (`refresh_token`) both POST a form body to the same provider token
 * endpoint shape and previously re-implemented this by hand; this is the one
 * place that HTTP mechanic lives now. Callers own the grant-specific body
 * and timeout budget; this owns only the request/response plumbing.
 */
export async function postMailboxOAuthTokenForm(
  url: string,
  body: URLSearchParams,
  timeoutMs: number
): Promise<MailboxOAuthHttpOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
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
