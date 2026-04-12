import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import { RUNTIME_CONFIG } from "../../runtime-config";

const INTERNAL_API_TIMEOUT_MS = 10_000;

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type ConsumeToolDailyLimitOutcome =
  | {
      allowed: true;
      currentCount: number;
      limit: number;
    }
  | {
      allowed: false;
      code: string;
      message: string;
    };

@Injectable()
export class PersaiInternalApiClientService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.PERSAI_API_BASE_URL?.trim() && this.config.PERSAI_INTERNAL_API_TOKEN
    );
  }

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tools/consume", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (
        payload?.ok === true &&
        Number.isInteger(payload.currentCount) &&
        Number.isInteger(payload.limit)
      ) {
        return {
          allowed: true,
          currentCount: Number(payload.currentCount),
          limit: Number(payload.limit)
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid tool quota consume response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status === 400 || response.status === 409) {
      return {
        allowed: false,
        code: error.code ?? "tool_quota_rejected",
        message:
          error.message ??
          `PersAI internal API rejected tool quota consume for "${input.toolCode}".`
      };
    }

    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API tool quota consume request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the tool quota consume request."
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

  private extractError(body: unknown): { code: string | null; message: string | null } {
    if (typeof body === "string" && body.trim().length > 0) {
      return {
        code: null,
        message: body.trim()
      };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (error) {
      return {
        code: typeof error.code === "string" ? error.code : null,
        message: typeof error.message === "string" ? error.message : null
      };
    }
    return {
      code: null,
      message: null
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
