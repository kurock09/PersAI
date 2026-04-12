import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import { PROVIDER_GATEWAY_CONFIG } from "../../provider-gateway-config";

const INTERNAL_API_TIMEOUT_MS = 10_000;

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

@Injectable()
export class PersaiInternalApiClientService {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.PERSAI_API_BASE_URL?.trim() && this.config.PERSAI_INTERNAL_API_TOKEN
    );
  }

  async resolveSecretValue(secretId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/provider-secrets/resolve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        protocolVersion: 1,
        ids: [secretId]
      })
    });

    if (!response.ok) {
      const message = this.extractErrorMessage(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          message ?? "PersAI internal API secret resolution failed."
        );
      }
      throw new BadGatewayException(
        message ?? "PersAI internal API rejected the secret resolution request."
      );
    }

    const payload = this.asObject(response.body);
    const values = this.asObject(payload?.values);
    const value = values?.[secretId];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    const errors = this.asObject(payload?.errors);
    const entry = this.asObject(errors?.[secretId]);
    if (typeof entry?.message === "string" && entry.message.trim().length > 0) {
      throw new BadGatewayException(entry.message);
    }

    throw new BadGatewayException(
      `PersAI internal API did not return a value for secret "${secretId}".`
    );
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.config.PERSAI_API_BASE_URL?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    return new URL(pathname, baseUrl).toString();
  }

  private async fetchJson(urlPath: string, init: RequestInit): Promise<JsonResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INTERNAL_API_TIMEOUT_MS);
    try {
      const response = await fetch(this.buildUrl(urlPath), {
        ...init,
        signal: controller.signal
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await this.readBody(response)
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new ServiceUnavailableException(
          `PersAI internal API request timed out after ${INTERNAL_API_TIMEOUT_MS}ms.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body.trim();
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (typeof error?.message === "string" && error.message.trim().length > 0) {
      return error.message;
    }
    return null;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
