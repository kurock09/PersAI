import { Injectable } from "@nestjs/common";

const POSTMARK_EMAIL_SEND_TIMEOUT_MS = 10_000;

export type PostmarkEmailSendOutcome =
  | { kind: "success"; httpStatus: number; body: Record<string, unknown> }
  | { kind: "network_error"; message: string }
  | { kind: "http_error"; httpStatus: number; body: Record<string, unknown> };

/**
 * ADR-168 — shared thin Postmark `/email` transport used by both
 * `EmailChannelAdapter` (ADR-088 platform notifications) and
 * `InternalRuntimeEmailSendService` (ADR-168 assistant-initiated send).
 * Owns only the HTTP POST, the bounded AbortController timeout, and the
 * JSON parse, returning a discriminated network-vs-HTTP-vs-success outcome.
 * Callers keep building their own payloads and keep their own
 * field-extraction, logging, and result-mapping logic — this client makes
 * no assumption about which Postmark response fields a caller needs.
 */
@Injectable()
export class PostmarkEmailSendClientService {
  async send(params: {
    url: string;
    serverToken: string;
    payload: Record<string, unknown>;
  }): Promise<PostmarkEmailSendOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, POSTMARK_EMAIL_SEND_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(params.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": params.serverToken
        },
        body: JSON.stringify(params.payload),
        signal: controller.signal
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network_error", message };
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return { kind: "http_error", httpStatus: response.status, body };
    }

    return { kind: "success", httpStatus: response.status, body };
  }
}
