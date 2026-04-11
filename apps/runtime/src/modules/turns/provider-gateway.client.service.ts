import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";

export interface ProviderGatewayDependencyReadiness {
  ready: boolean;
  providerCacheReady: boolean;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class ProviderGatewayClientService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  isConfigured(): boolean {
    return this.getBaseUrl() !== null;
  }

  async getReadiness(): Promise<ProviderGatewayDependencyReadiness> {
    if (!this.isConfigured()) {
      return {
        ready: false,
        providerCacheReady: false
      };
    }

    try {
      const response = await this.fetchJson(this.buildUrl("/ready"), { method: "GET" });
      const body = this.asObject(response.body);
      return {
        ready: response.ok && body?.ready === true,
        providerCacheReady: body?.providerCacheReady === true
      };
    } catch {
      return {
        ready: false,
        providerCacheReady: false
      };
    }
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(this.buildUrl("/api/v1/providers/generate-text"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isTextGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid text generation response."
      );
    }

    return response.body;
  }

  private getBaseUrl(): string | null {
    return this.config.RUNTIME_PROVIDER_GATEWAY_BASE_URL ?? null;
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.getBaseUrl();
    if (baseUrl === null) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }
    return new URL(pathname, baseUrl).toString();
  }

  private async fetchJson(url: string, init: RequestInit): Promise<JsonResponse> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS)
    });
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;

    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      const text = await response.text();
      body = text.length > 0 ? text : null;
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  }

  private toGatewayException(
    response: JsonResponse
  ): BadGatewayException | ServiceUnavailableException {
    const message = this.extractErrorMessage(response.body);
    if (response.status >= 500) {
      return new ServiceUnavailableException(
        message ?? `Provider gateway request failed with status ${response.status}.`
      );
    }
    return new BadGatewayException(
      message ?? `Provider gateway rejected the request with status ${response.status}.`
    );
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body;
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (typeof error?.message === "string" && error.message.trim().length > 0) {
      return error.message;
    }
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isTextGenerateResult(value: unknown): value is ProviderGatewayTextGenerateResult {
    const row = this.asObject(value);
    return (
      row?.provider !== undefined &&
      row.provider !== null &&
      (row.provider === "openai" || row.provider === "anthropic") &&
      typeof row.model === "string" &&
      typeof row.text === "string" &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
  }
}
