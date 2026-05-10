import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeBackgroundTaskEvaluationRequest,
  RuntimeBackgroundTaskEvaluationResult
} from "@persai/runtime-contract";

const BACKGROUND_TASK_EVALUATION_TIMEOUT_MS = 45_000;

export type InternalRuntimeBackgroundTaskEvaluationOutcome =
  | {
      ok: true;
      result: RuntimeBackgroundTaskEvaluationResult;
    }
  | {
      ok: false;
      deferred: true;
      status: 409;
      code: "runtime_session_busy";
      message: string;
    }
  | {
      ok: false;
      deferred?: false;
      retryable: boolean;
      status: number | null;
      code: string | null;
      message: string;
    };

@Injectable()
export class InternalRuntimeBackgroundTaskClientService {
  private readonly logger = new Logger(InternalRuntimeBackgroundTaskClientService.name);

  async evaluate(
    input: RuntimeBackgroundTaskEvaluationRequest,
    options?: { timeoutMs?: number }
  ): Promise<InternalRuntimeBackgroundTaskEvaluationOutcome> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "runtime_base_url_missing",
        message: "PERSAI_RUNTIME_BASE_URL is not configured for background tasks."
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for background tasks."
      };
    }

    const timeoutMs =
      typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
        ? Math.max(1_000, Math.floor(options.timeoutMs))
        : BACKGROUND_TASK_EVALUATION_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        new URL("/api/v1/internal/runtime/background-tasks/evaluate", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(input),
          signal: controller.signal
        }
      );
      const body = await this.readBody(response);
      if (response.ok) {
        if (this.isEvaluationResult(body)) {
          return { ok: true, result: body };
        }
        return {
          ok: false,
          retryable: false,
          status: response.status,
          code: "invalid_response",
          message: "Background-task runtime returned an unexpected response shape."
        };
      }
      if (response.status === 409) {
        const error409 = this.extractError(body);
        return {
          ok: false,
          deferred: true,
          status: 409,
          code: "runtime_session_busy",
          message:
            error409.message ?? "Background-task runtime session is busy; evaluation deferred."
        };
      }
      const error = this.extractError(body);
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Background-task runtime returned HTTP ${response.status}.`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Background-task runtime call timed out after ${timeoutMs}ms.`
        };
      }
      this.logger.warn(
        `Background-task runtime call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message: error instanceof Error ? error.message : "Background-task runtime call failed."
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

  private isEvaluationResult(value: unknown): value is RuntimeBackgroundTaskEvaluationResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.decision === "push" || row.decision === "no_push" || row.decision === "complete") &&
      (row.pushText === null || typeof row.pushText === "string") &&
      (row.rationale === null || typeof row.rationale === "string") &&
      (row.confidence === "low" || row.confidence === "medium" || row.confidence === "high") &&
      (row.toolRunText === null || typeof row.toolRunText === "string") &&
      Array.isArray(row.artifacts) &&
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
}
