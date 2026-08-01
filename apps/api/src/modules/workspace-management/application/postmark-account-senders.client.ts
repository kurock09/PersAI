import { Injectable, Logger } from "@nestjs/common";

const POSTMARK_SENDERS_BASE_URL = "https://api.postmarkapp.com/senders";
const POSTMARK_SENDERS_TIMEOUT_MS = 10_000;

export type PostmarkSendersFailure = {
  ok: false;
  reason: "postmark_error" | "postmark_network_error";
  httpStatus?: number;
  errorCode?: number;
  message?: string;
};

export type PostmarkSendersSuccess<T> = { ok: true; data: T };

export type PostmarkSendersResult<T> = PostmarkSendersSuccess<T> | PostmarkSendersFailure;

export type PostmarkSenderSignature = {
  id: number;
  emailAddress: string;
  name: string | null;
  confirmed: boolean;
};

/**
 * ADR-168 — thin HTTP client for the Postmark Sender Signatures API
 * (`/senders`), authenticated with the Account API token
 * (`X-Postmark-Account-Token`). Distinct from Postmark's server-scoped
 * `/email` send API used by `EmailChannelAdapter`.
 *
 * Mirrors the error-handling shape used by `EmailChannelAdapter`: bounded
 * AbortController timeout, structured logger events, and a discriminated
 * result union instead of thrown raw fetch/HTTP errors.
 */
@Injectable()
export class PostmarkAccountSendersClientService {
  private readonly logger = new Logger(PostmarkAccountSendersClientService.name);

  async createSignature(
    accountToken: string,
    params: { fromEmail: string; name: string }
  ): Promise<PostmarkSendersResult<PostmarkSenderSignature>> {
    const result = await this.request(accountToken, "POST", POSTMARK_SENDERS_BASE_URL, {
      FromEmail: params.fromEmail,
      Name: params.name
    });
    if (!result.ok) {
      return result;
    }
    return this.parseSignature(result.data);
  }

  async getSignature(
    accountToken: string,
    signatureId: string
  ): Promise<PostmarkSendersResult<PostmarkSenderSignature>> {
    const result = await this.request(
      accountToken,
      "GET",
      `${POSTMARK_SENDERS_BASE_URL}/${encodeURIComponent(signatureId)}`
    );
    if (!result.ok) {
      return result;
    }
    return this.parseSignature(result.data);
  }

  async resendConfirmation(
    accountToken: string,
    signatureId: string
  ): Promise<PostmarkSendersResult<PostmarkSenderSignature>> {
    const result = await this.request(
      accountToken,
      "POST",
      `${POSTMARK_SENDERS_BASE_URL}/${encodeURIComponent(signatureId)}/resend`
    );
    if (!result.ok) {
      return result;
    }
    return this.parseSignature(result.data);
  }

  async deleteSignature(
    accountToken: string,
    signatureId: string
  ): Promise<PostmarkSendersResult<{ deleted: true }>> {
    const result = await this.request(
      accountToken,
      "DELETE",
      `${POSTMARK_SENDERS_BASE_URL}/${encodeURIComponent(signatureId)}`
    );
    if (!result.ok) {
      return result;
    }
    return { ok: true, data: { deleted: true } };
  }

  private parseSignature(
    body: Record<string, unknown>
  ): PostmarkSendersResult<PostmarkSenderSignature> {
    const id = body["ID"];
    const emailAddress = body["EmailAddress"];
    if (typeof id !== "number" || typeof emailAddress !== "string") {
      return {
        ok: false,
        reason: "postmark_error",
        message: "Postmark returned an unrecognised sender signature response."
      };
    }
    const name = body["Name"];
    const confirmed = body["Confirmed"];
    return {
      ok: true,
      data: {
        id,
        emailAddress,
        name: typeof name === "string" ? name : null,
        confirmed: confirmed === true
      }
    };
  }

  private async request(
    accountToken: string,
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: Record<string, unknown>
  ): Promise<PostmarkSendersResult<Record<string, unknown>>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, POSTMARK_SENDERS_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Account-Token": accountToken
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({
        event: "postmark_senders.request_error",
        method,
        url,
        error: errorMsg
      });
      return { ok: false, reason: "postmark_network_error", message: errorMsg };
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const errorCode =
        typeof responseBody["ErrorCode"] === "number" ? responseBody["ErrorCode"] : undefined;
      const message =
        typeof responseBody["Message"] === "string" ? responseBody["Message"] : undefined;
      this.logger.warn({
        event: "postmark_senders.request_failed",
        method,
        url,
        httpStatus: response.status,
        errorCode,
        message
      });
      return {
        ok: false,
        reason: "postmark_error",
        httpStatus: response.status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(message !== undefined ? { message } : {})
      };
    }

    return { ok: true, data: responseBody };
  }
}
