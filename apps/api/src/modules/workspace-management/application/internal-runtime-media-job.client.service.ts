import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeMediaJobCompletionRequest,
  RuntimeMediaJobCompletionResult,
  RuntimeMediaJobRunRequest,
  RuntimeMediaJobRunResult
} from "@persai/runtime-contract";

const MEDIA_JOB_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export type InternalRuntimeMediaJobRunOutcome =
  | {
      ok: true;
      result: RuntimeMediaJobRunResult;
    }
  | {
      ok: false;
      retryable: boolean;
      status: number | null;
      code: string | null;
      message: string;
    };

@Injectable()
export class InternalRuntimeMediaJobClientService {
  private readonly logger = new Logger(InternalRuntimeMediaJobClientService.name);

  async run(input: RuntimeMediaJobRunRequest): Promise<InternalRuntimeMediaJobRunOutcome> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "runtime_base_url_missing",
        message: "PERSAI_RUNTIME_BASE_URL is not configured for media jobs."
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for media jobs."
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MEDIA_JOB_RUN_TIMEOUT_MS);
    try {
      const response = await fetch(new URL("/api/v1/internal/runtime/media-jobs/run", baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      const body = await this.readBody(response);
      if (response.ok) {
        if (this.isRunResult(body)) {
          return { ok: true, result: body };
        }
        return {
          ok: false,
          retryable: false,
          status: response.status,
          code: "invalid_response",
          message: "Media-job runtime returned an unexpected response shape."
        };
      }
      const error = this.extractError(body);
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Media-job runtime returned HTTP ${response.status}.`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Media-job runtime call timed out after ${MEDIA_JOB_RUN_TIMEOUT_MS}ms.`
        };
      }
      this.logger.warn(
        `Media-job runtime call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message: error instanceof Error ? error.message : "Media-job runtime call failed."
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async complete(input: RuntimeMediaJobCompletionRequest): Promise<
    | {
        ok: true;
        result: RuntimeMediaJobCompletionResult;
      }
    | {
        ok: false;
        retryable: boolean;
        status: number | null;
        code: string | null;
        message: string;
      }
  > {
    return this.postJson("/api/v1/internal/runtime/media-jobs/complete", input, (body) =>
      this.isCompletionResult(body)
    );
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

  private isRunResult(value: unknown): value is RuntimeMediaJobRunResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.assistantText === "string" &&
      Array.isArray(row.artifacts) &&
      Array.isArray(row.toolInvocations) &&
      (row.usage === null || this.asObject(row.usage) !== null) &&
      (row.rawText === null || typeof row.rawText === "string")
    );
  }

  private extractError(body: unknown): { code: string | null; message: string | null } {
    if (typeof body === "string" && body.trim().length > 0) {
      return { code: null, message: body.trim() };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    return {
      code: typeof error?.code === "string" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : null
    };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isCompletionResult(value: unknown): value is RuntimeMediaJobCompletionResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.assistantText === null || typeof row.assistantText === "string") &&
      (row.usage === null || this.asObject(row.usage) !== null) &&
      (row.rawText === null || typeof row.rawText === "string")
    );
  }

  private async postJson<T>(
    path: string,
    input: unknown,
    guard: (body: unknown) => body is T
  ): Promise<
    | {
        ok: true;
        result: T;
      }
    | {
        ok: false;
        retryable: boolean;
        status: number | null;
        code: string | null;
        message: string;
      }
  > {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "runtime_base_url_missing",
        message: "PERSAI_RUNTIME_BASE_URL is not configured for media jobs."
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for media jobs."
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MEDIA_JOB_RUN_TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      const body = await this.readBody(response);
      if (response.ok) {
        if (guard(body)) {
          return { ok: true, result: body };
        }
        return {
          ok: false,
          retryable: false,
          status: response.status,
          code: "invalid_response",
          message: "Media-job runtime returned an unexpected response shape."
        };
      }
      const error = this.extractError(body);
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Media-job runtime returned HTTP ${response.status}.`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Media-job runtime call timed out after ${MEDIA_JOB_RUN_TIMEOUT_MS}ms.`
        };
      }
      this.logger.warn(
        `Media-job runtime call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message: error instanceof Error ? error.message : "Media-job runtime call failed."
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
