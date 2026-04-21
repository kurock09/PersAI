import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  PersaiRuntimeChannel,
  PersaiRuntimeTier,
  RuntimeCompactionResult
} from "@persai/runtime-contract";

const COMPACT_AND_EXTRACT_TIMEOUT_MS = 30_000;

export interface InternalRuntimeCompactAndExtractInput {
  assistantId: string;
  workspaceId: string;
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: PersaiRuntimeTier;
  enqueuedRequestId: string | null;
}

export type InternalRuntimeCompactAndExtractOutcome =
  | {
      ok: true;
      result: RuntimeCompactionResult;
    }
  | {
      ok: false;
      retryable: boolean;
      status: number | null;
      code: string | null;
      message: string;
    };

@Injectable()
export class InternalRuntimeCompactionClientService {
  private readonly logger = new Logger(InternalRuntimeCompactionClientService.name);

  async execute(
    input: InternalRuntimeCompactAndExtractInput
  ): Promise<InternalRuntimeCompactAndExtractOutcome> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "runtime_base_url_missing",
        message: "PERSAI_RUNTIME_BASE_URL is not configured for background compaction."
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for background compaction."
      };
    }

    const url = new URL(
      "/api/v1/internal/runtime/sessions/compact-and-extract",
      baseUrl
    ).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COMPACT_AND_EXTRACT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          runtimeTier: input.runtimeTier,
          conversation: {
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            channel: input.channel,
            externalThreadKey: input.externalThreadKey,
            externalUserKey: input.externalUserKey,
            mode: "direct"
          },
          enqueuedRequestId: input.enqueuedRequestId
        }),
        signal: controller.signal
      });

      const body = await this.readBody(response);
      if (response.ok) {
        if (this.isRuntimeCompactionResult(body)) {
          return { ok: true, result: body };
        }
        return {
          ok: false,
          retryable: false,
          status: response.status,
          code: "invalid_response",
          message: "Background compaction runtime returned an unexpected response shape."
        };
      }

      const error = this.extractError(body);
      const retryable =
        response.status >= 500 || response.status === 408 || response.status === 429;
      return {
        ok: false,
        retryable,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Background compaction runtime returned HTTP ${response.status}.`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Background compaction runtime call timed out after ${COMPACT_AND_EXTRACT_TIMEOUT_MS}ms.`
        };
      }
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message:
          error instanceof Error
            ? `Background compaction runtime call failed: ${error.message}`
            : "Background compaction runtime call failed."
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return await response.json();
      } catch {
        return null;
      }
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private isRuntimeCompactionResult(value: unknown): value is RuntimeCompactionResult {
    const row = this.asObject(value);
    if (row === null) {
      return false;
    }
    return (
      typeof row.compacted === "boolean" &&
      (typeof row.reason === "string" || row.reason === null) &&
      this.asObject(row.toolResult) !== null
    );
  }

  private extractError(body: unknown): { code: string | null; message: string | null } {
    if (typeof body === "string" && body.trim().length > 0) {
      return { code: null, message: body.trim() };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (error !== null) {
      return {
        code: typeof error.code === "string" ? error.code : null,
        message: typeof error.message === "string" ? error.message : null
      };
    }
    return { code: null, message: null };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
