import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeAsyncContinuationResult,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";

export class AsyncContinuationDispatchAmbiguousError extends ServiceUnavailableException {
  constructor(message: string) {
    super(message);
    this.name = "AsyncContinuationDispatchAmbiguousError";
  }
}

@Injectable()
export class InternalRuntimeAsyncContinuationClientService {
  async execute(
    input: RuntimeTurnRequest,
    options: { timeoutMs: number }
  ): Promise<RuntimeAsyncContinuationResult> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException("Async continuation runtime is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
    try {
      const response = await fetch(
        new URL("/api/v1/internal/runtime/async-continuations", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input),
          signal: controller.signal
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new AsyncContinuationDispatchAmbiguousError(
          "Runtime continuation response was not authoritative."
        );
      }
      const parsed = this.parseExecuteResponse(body);
      if (parsed === null) {
        throw new AsyncContinuationDispatchAmbiguousError(
          "Runtime continuation returned a malformed success response."
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof AsyncContinuationDispatchAmbiguousError) throw error;
      throw new AsyncContinuationDispatchAmbiguousError(
        controller.signal.aborted
          ? "Runtime continuation dispatch timed out after acceptance became possible."
          : "Runtime continuation dispatch connection failed after acceptance became possible."
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private parseExecuteResponse(value: unknown): RuntimeAsyncContinuationResult | null {
    if (!this.isRecord(value) || typeof value.outcome !== "string") return null;
    if (value.outcome === "busy" || value.outcome === "duplicate") {
      return this.hasExactKeys(value, ["outcome"]) ? { outcome: value.outcome } : null;
    }
    if (value.outcome === "failed") {
      return this.hasExactKeys(value, ["outcome", "code"]) &&
        typeof value.code === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(value.code)
        ? { outcome: "failed", code: value.code }
        : null;
    }
    if (value.outcome !== "completed") return null;
    if (
      !this.hasExactKeys(value, ["outcome", "result", "duplicate"]) ||
      typeof value.duplicate !== "boolean" ||
      !this.isRuntimeTurnResult(value.result)
    ) {
      return null;
    }
    return {
      outcome: "completed",
      result: value.result,
      duplicate: value.duplicate
    };
  }

  private isRuntimeTurnResult(value: unknown): value is RuntimeTurnResult {
    if (
      !this.isRecord(value) ||
      typeof value.requestId !== "string" ||
      value.requestId.length === 0 ||
      typeof value.sessionId !== "string" ||
      value.sessionId.length === 0 ||
      typeof value.assistantText !== "string" ||
      typeof value.respondedAt !== "string" ||
      value.respondedAt.length === 0 ||
      !Array.isArray(value.artifacts) ||
      !(value.usage === null || (this.isRecord(value.usage) && !Array.isArray(value.usage))) ||
      (value.answerText !== undefined && typeof value.answerText !== "string")
    ) {
      return false;
    }
    return value.artifacts.every(
      (artifact) =>
        this.isRecord(artifact) &&
        typeof artifact.artifactId === "string" &&
        typeof artifact.storagePath === "string" &&
        ["image", "audio", "video", "file"].includes(String(artifact.kind)) &&
        typeof artifact.mimeType === "string" &&
        (artifact.filename === null || typeof artifact.filename === "string") &&
        (artifact.sizeBytes === null ||
          (typeof artifact.sizeBytes === "number" && Number.isFinite(artifact.sizeBytes))) &&
        typeof artifact.voiceNote === "boolean"
    );
  }

  private hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return (
      actual.length === expected.length && actual.every((key, index) => key === expected[index])
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  async inspect(
    input: RuntimeTurnRequest & { sessionId: string },
    options: { timeoutMs?: number } = {}
  ): Promise<{
    proof: "proven" | "ambiguous";
    receiptStatus: "absent" | "accepted" | "completed" | "interrupted" | "failed";
    exactInFlight: boolean;
  }> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      return { proof: "ambiguous", receiptStatus: "absent", exactInFlight: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 10_000));
    try {
      const response = await fetch(
        new URL("/api/v1/internal/runtime/async-continuations/status", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input),
          signal: controller.signal
        }
      );
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        !response.ok ||
        body === null ||
        (body.proof !== "proven" && body.proof !== "ambiguous") ||
        !["absent", "accepted", "completed", "interrupted", "failed"].includes(
          String(body.receiptStatus)
        ) ||
        typeof body.exactInFlight !== "boolean"
      ) {
        return { proof: "ambiguous", receiptStatus: "absent", exactInFlight: false };
      }
      return body as {
        proof: "proven" | "ambiguous";
        receiptStatus: "absent" | "accepted" | "completed" | "interrupted" | "failed";
        exactInFlight: boolean;
      };
    } catch {
      return { proof: "ambiguous", receiptStatus: "absent", exactInFlight: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
