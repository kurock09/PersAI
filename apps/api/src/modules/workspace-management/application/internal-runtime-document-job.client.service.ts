import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeDocumentJobCompletionRequest,
  RuntimeDocumentJobCompletionResult,
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult
} from "@persai/runtime-contract";

const DOCUMENT_JOB_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export type InternalRuntimeDocumentJobRunOutcome =
  | {
      ok: true;
      result: RuntimeDocumentJobRunResult;
    }
  | {
      ok: false;
      retryable: boolean;
      status: number | null;
      code: string | null;
      message: string;
      providerStatus: Record<string, unknown> | null;
    };

@Injectable()
export class InternalRuntimeDocumentJobClientService {
  private readonly logger = new Logger(InternalRuntimeDocumentJobClientService.name);

  async run(input: RuntimeDocumentJobRunRequest): Promise<InternalRuntimeDocumentJobRunOutcome> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "runtime_base_url_missing",
        message: "PERSAI_RUNTIME_BASE_URL is not configured for document jobs.",
        providerStatus: null
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for document jobs.",
        providerStatus: null
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOCUMENT_JOB_RUN_TIMEOUT_MS);
    try {
      const response = await fetch(new URL("/api/v1/internal/runtime/document-jobs/run", baseUrl), {
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
          message: "Document-job runtime returned an unexpected response shape.",
          providerStatus: null
        };
      }
      const error = this.extractError(body);
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Document-job runtime returned HTTP ${response.status}.`,
        providerStatus: error.providerStatus
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Document-job runtime call timed out after ${DOCUMENT_JOB_RUN_TIMEOUT_MS}ms.`,
          providerStatus: null
        };
      }
      this.logger.warn(
        `Document-job runtime call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message: error instanceof Error ? error.message : "Document-job runtime call failed.",
        providerStatus: null
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async complete(input: RuntimeDocumentJobCompletionRequest): Promise<
    | {
        ok: true;
        result: RuntimeDocumentJobCompletionResult;
      }
    | {
        ok: false;
        retryable: boolean;
        status: number | null;
        code: string | null;
        message: string;
        providerStatus: Record<string, unknown> | null;
      }
  > {
    return this.postJson("/api/v1/internal/runtime/document-jobs/complete", input, (body) =>
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

  private extractError(body: unknown): {
    code: string | null;
    message: string | null;
    providerStatus: Record<string, unknown> | null;
  } {
    if (typeof body === "string" && body.trim().length > 0) {
      return { code: null, message: body.trim(), providerStatus: null };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    return {
      code: typeof error?.code === "string" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : null,
      providerStatus: this.asObject(error?.providerStatus)
    };
  }

  private isRunResult(value: unknown): value is RuntimeDocumentJobRunResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.assistantText === null || typeof row.assistantText === "string") &&
      Array.isArray(row.artifacts) &&
      Array.isArray(row.toolInvocations) &&
      (row.usage === null || this.asObject(row.usage) !== null) &&
      (row.rawText === null || typeof row.rawText === "string") &&
      (row.providerStatus === undefined ||
        row.providerStatus === null ||
        this.asObject(row.providerStatus) !== null)
    );
  }

  private isCompletionResult(value: unknown): value is RuntimeDocumentJobCompletionResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.assistantText === null || typeof row.assistantText === "string") &&
      (row.usage === null || this.asObject(row.usage) !== null) &&
      (row.rawText === null || typeof row.rawText === "string")
    );
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
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
        providerStatus: Record<string, unknown> | null;
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
        message: "PERSAI_RUNTIME_BASE_URL is not configured for document jobs.",
        providerStatus: null
      };
    }
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        retryable: false,
        status: null,
        code: "internal_token_missing",
        message: "PERSAI_INTERNAL_API_TOKEN is not configured for document jobs.",
        providerStatus: null
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOCUMENT_JOB_RUN_TIMEOUT_MS);
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
          message: "Document-job runtime returned an unexpected response shape.",
          providerStatus: null
        };
      }
      const error = this.extractError(body);
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        status: response.status,
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `Document-job runtime returned HTTP ${response.status}.`,
        providerStatus: error.providerStatus
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          retryable: true,
          status: null,
          code: "timeout",
          message: `Document-job runtime call timed out after ${DOCUMENT_JOB_RUN_TIMEOUT_MS}ms.`,
          providerStatus: null
        };
      }
      this.logger.warn(
        `Document-job runtime call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        ok: false,
        retryable: true,
        status: null,
        code: "network_error",
        message: error instanceof Error ? error.message : "Document-job runtime call failed.",
        providerStatus: null
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
