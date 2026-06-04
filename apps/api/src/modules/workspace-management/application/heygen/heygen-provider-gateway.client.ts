import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { ProviderGatewayHeyGenCreatePhotoAvatarRequest } from "@persai/runtime-contract";

const DEFAULT_HEYGEN_AVATAR_TIMEOUT_MS = 60_000;

/**
 * ADR-109 Slice 5b (E12) — API-side HTTP client for the provider-gateway
 * HeyGen avatar-creation endpoint.
 *
 * Reads PERSAI_PROVIDER_GATEWAY_BASE_URL and
 * PERSAI_PROVIDER_GATEWAY_HEYGEN_AVATAR_TIMEOUT_MS directly from process.env
 * at call time (lightweight client, does not need full loadApiConfig validation).
 *
 * Error mapping:
 *   - gateway 4xx → BadRequestException(code: "heygen_avatar_create_failed")
 *   - gateway 5xx / network error / timeout → ServiceUnavailableException(code: "heygen_unavailable")
 *   - 200 with malformed response → ServiceUnavailableException(code: "heygen_unavailable")
 */
@Injectable()
export class HeyGenProviderGatewayClient {
  async createPhotoAvatar(input: {
    credentialSecretId: string;
    name: string;
    portraitImageBytesBase64: string;
    portraitImageMimeType: string;
  }): Promise<{ avatarId: string }> {
    const baseUrl = (process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] ?? "").trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException({
        error: {
          code: "heygen_unavailable",
          message:
            "PERSAI_PROVIDER_GATEWAY_BASE_URL is not configured. " +
            "Operator must set the provider-gateway URL before persona creation can succeed."
        }
      });
    }
    const rawTimeout = process.env["PERSAI_PROVIDER_GATEWAY_HEYGEN_AVATAR_TIMEOUT_MS"];
    const timeoutMs =
      rawTimeout !== undefined && /^\d+$/.test(rawTimeout)
        ? parseInt(rawTimeout, 10)
        : DEFAULT_HEYGEN_AVATAR_TIMEOUT_MS;

    const url = new URL("/api/v1/providers/heygen/create-photo-avatar", baseUrl).toString();

    const requestBody: ProviderGatewayHeyGenCreatePhotoAvatarRequest = {
      schema: "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1",
      credential: {
        secretId: input.credentialSecretId,
        providerId: "heygen"
      },
      name: input.name,
      portraitImageBytesBase64: input.portraitImageBytesBase64,
      portraitImageMimeType: input.portraitImageMimeType
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceUnavailableException({
          error: {
            code: "heygen_unavailable",
            message: `Provider-gateway HeyGen avatar creation timed out after ${String(timeoutMs)}ms.`
          }
        });
      }
      const message = error instanceof Error ? error.message : "Provider-gateway network error.";
      throw new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message }
      });
    }
    clearTimeout(timeoutId);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.status >= 400 && response.status < 500) {
      const message =
        this.readErrorMessage(body) ?? `Provider-gateway returned HTTP ${String(response.status)}.`;
      throw new BadRequestException({
        error: { code: "heygen_avatar_create_failed", message }
      });
    }

    if (!response.ok) {
      const message =
        this.readErrorMessage(body) ?? `Provider-gateway returned HTTP ${String(response.status)}.`;
      throw new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message }
      });
    }

    // Defensive parse of the 200 response.
    const parsed = this.parseSuccessBody(body);
    if (parsed === null) {
      throw new ServiceUnavailableException({
        error: {
          code: "heygen_unavailable",
          message:
            "Provider-gateway returned an unrecognised response for HeyGen avatar creation " +
            "(missing schema or avatarId)."
        }
      });
    }

    return { avatarId: parsed.avatarId };
  }

  private parseSuccessBody(body: unknown): { avatarId: string } | null {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const record = body as Record<string, unknown>;
    if (record["schema"] !== "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1") {
      return null;
    }
    const avatarId = record["avatarId"];
    if (typeof avatarId !== "string" || avatarId.trim().length === 0) {
      return null;
    }
    return { avatarId: avatarId.trim() };
  }

  private readErrorMessage(body: unknown): string | null {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const record = body as Record<string, unknown>;
    const errorObj = record["error"];
    if (errorObj !== null && typeof errorObj === "object" && !Array.isArray(errorObj)) {
      const msg = (errorObj as Record<string, unknown>)["message"];
      if (typeof msg === "string" && msg.trim().length > 0) {
        return msg.trim();
      }
    }
    const msg = record["message"];
    if (typeof msg === "string" && msg.trim().length > 0) {
      return msg.trim();
    }
    return null;
  }
}
