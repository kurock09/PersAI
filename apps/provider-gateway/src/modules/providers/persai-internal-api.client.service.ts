import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type { RuntimeAcceptedVideoProviderTask } from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../provider-gateway-config";

const INTERNAL_API_TIMEOUT_MS = 10_000;

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

type AppendAuditEventRequest = {
  workspaceId: string | null;
  assistantId: string | null;
  actorUserId: string | null;
  eventCategory: string;
  eventCode: string;
  summary: string;
  outcome?: "succeeded" | "failed" | "degraded" | "denied";
  details?: Record<string, unknown>;
};

const INTERNAL_DEFAULT_PROVIDER_KEYS = ["openai", "anthropic", "deepseek", "kimi"] as const;

type InternalDefaultProvider = (typeof INTERNAL_DEFAULT_PROVIDER_KEYS)[number];

export type InternalDefaultProviderSettings = {
  generation: number;
  mode: "unconfigured_default" | "global_settings";
  primary: { provider: InternalDefaultProvider; model: string } | null;
  availableModelsByProvider: Record<InternalDefaultProvider, string[]>;
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

  async getDefaultProviderSettings(): Promise<InternalDefaultProviderSettings> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/provider-settings/default", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });

    if (!response.ok) {
      const message = this.extractErrorMessage(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          message ?? "PersAI internal API provider-settings request failed."
        );
      }
      throw new BadGatewayException(
        message ?? "PersAI internal API rejected the provider-settings request."
      );
    }

    const payload = this.asObject(response.body);
    const availableModelsByProvider = this.parseAvailableModelsByProvider(
      payload?.availableModelsByProvider
    );
    const primary = this.parseDefaultProviderPrimary(payload?.primary);
    if (
      typeof payload?.generation === "number" &&
      Number.isInteger(payload.generation) &&
      (payload.mode === "unconfigured_default" || payload.mode === "global_settings") &&
      availableModelsByProvider !== null &&
      primary !== undefined
    ) {
      return {
        generation: payload.generation,
        mode: payload.mode,
        primary,
        availableModelsByProvider
      };
    }

    throw new BadGatewayException(
      "PersAI internal API returned an invalid default provider-settings response."
    );
  }

  async appendAssistantAuditEvent(input: AppendAuditEventRequest): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/audit-events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const message = this.extractErrorMessage(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          message ?? "PersAI internal API audit event append failed."
        );
      }
      throw new BadGatewayException(
        message ?? "PersAI internal API rejected the audit event append request."
      );
    }
  }

  async checkpointMediaJobAcceptedProviderTask(input: {
    mediaJobId: string;
    acceptedProviderTask: RuntimeAcceptedVideoProviderTask;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson(
      "/api/v1/internal/runtime/media-jobs/checkpoint-accepted-provider-task",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );
    if (!response.ok) {
      const message = this.extractErrorMessage(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          message ?? "PersAI internal API media-job checkpoint failed."
        );
      }
      throw new BadGatewayException(
        message ?? "PersAI internal API rejected the media-job checkpoint request."
      );
    }
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

  private asStringArray(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? [...value]
      : null;
  }

  private isInternalDefaultProvider(value: unknown): value is InternalDefaultProvider {
    return (
      typeof value === "string" &&
      INTERNAL_DEFAULT_PROVIDER_KEYS.some((provider) => provider === value)
    );
  }

  private parseAvailableModelsByProvider(
    value: unknown
  ): InternalDefaultProviderSettings["availableModelsByProvider"] | null {
    const row = this.asObject(value);
    if (row === null) {
      return null;
    }

    const openai = this.asStringArray(row.openai);
    const anthropic = this.asStringArray(row.anthropic);
    const deepseek = this.asStringArray(row.deepseek);
    const kimi = this.asStringArray(row.kimi);
    if (openai === null || anthropic === null || deepseek === null || kimi === null) {
      return null;
    }

    return {
      openai,
      anthropic,
      deepseek,
      kimi
    };
  }

  private parseDefaultProviderPrimary(
    value: unknown
  ): InternalDefaultProviderSettings["primary"] | undefined {
    if (value === null) {
      return null;
    }

    const row = this.asObject(value);
    if (
      row === null ||
      !this.isInternalDefaultProvider(row.provider) ||
      typeof row.model !== "string"
    ) {
      return undefined;
    }

    return {
      provider: row.provider,
      model: row.model
    };
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
