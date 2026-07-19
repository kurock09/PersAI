import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeAsyncContinuationResult,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";

export class AsyncContinuationDispatchAmbiguousError extends ServiceUnavailableException {
  constructor(message: string) {
    super(message);
    this.name = "AsyncContinuationDispatchAmbiguousError";
  }
}

/** Caller AbortSignal (Stop / cancel) — not post-accept connection ambiguity. */
export class AsyncContinuationInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsyncContinuationInterruptedError";
  }
}

export type RuntimeAsyncContinuationStreamStart =
  | { mode: "outcome"; result: RuntimeAsyncContinuationResult }
  | { mode: "events"; events: AsyncGenerator<RuntimeTurnStreamEvent> };

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

  /**
   * ADR-152 web notify continuation stream. Early busy/duplicate/invalid stay
   * JSON outcomes; accepted work is NDJSON `RuntimeTurnStreamEvent` lines.
   * Wall-clock timeout covers both connect and full stream consumption.
   */
  async stream(
    input: RuntimeTurnRequest,
    options: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<RuntimeAsyncContinuationStreamStart> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    const token = config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException("Async continuation runtime is not configured.");
    }
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort);
    if (options.signal?.aborted) {
      controller.abort();
    }
    const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
    const disposeConnectGuards = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    };
    try {
      const response = await fetch(
        new URL("/api/v1/internal/runtime/async-continuations/stream", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/x-ndjson, application/json"
          },
          body: JSON.stringify(input),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        disposeConnectGuards();
        throw new AsyncContinuationDispatchAmbiguousError(
          "Runtime continuation stream response was not authoritative."
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
        try {
          const body = await response.json().catch(() => null);
          const parsed = this.parseExecuteResponse(body);
          if (parsed === null) {
            throw new AsyncContinuationDispatchAmbiguousError(
              "Runtime continuation stream returned a malformed JSON outcome."
            );
          }
          return { mode: "outcome", result: parsed };
        } finally {
          disposeConnectGuards();
        }
      }
      if (response.body === null) {
        disposeConnectGuards();
        throw new AsyncContinuationDispatchAmbiguousError(
          "Runtime continuation stream returned an empty body."
        );
      }
      // Keep wall-clock + external abort active for the full NDJSON lifetime.
      return {
        mode: "events",
        events: this.readNdjsonEvents(response, {
          signal: controller.signal,
          isCallerAborted: () => options.signal?.aborted === true,
          onDone: disposeConnectGuards
        })
      };
    } catch (error) {
      disposeConnectGuards();
      if (error instanceof AsyncContinuationDispatchAmbiguousError) throw error;
      if (error instanceof AsyncContinuationInterruptedError) throw error;
      if (options.signal?.aborted) {
        throw new AsyncContinuationInterruptedError(
          "Runtime continuation stream aborted by caller."
        );
      }
      throw new AsyncContinuationDispatchAmbiguousError(
        controller.signal.aborted
          ? "Runtime continuation stream timed out after acceptance became possible."
          : "Runtime continuation stream connection failed after acceptance became possible."
      );
    }
  }

  private async *readNdjsonEvents(
    response: Response,
    options: {
      signal: AbortSignal;
      isCallerAborted: () => boolean;
      onDone: () => void;
    }
  ): AsyncGenerator<RuntimeTurnStreamEvent> {
    const { signal, isCallerAborted, onDone } = options;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const abortListener = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", abortListener);
    try {
      while (true) {
        if (signal.aborted) {
          if (isCallerAborted()) {
            throw new AsyncContinuationInterruptedError(
              "Runtime continuation stream aborted by caller."
            );
          }
          throw new AsyncContinuationDispatchAmbiguousError(
            "Runtime continuation stream timed out after acceptance became possible."
          );
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) break;
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length === 0) continue;
          yield this.parseStreamEventLine(line);
        }
      }
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail.length > 0) {
        yield this.parseStreamEventLine(tail);
      }
    } catch (error) {
      if (
        error instanceof AsyncContinuationDispatchAmbiguousError ||
        error instanceof AsyncContinuationInterruptedError
      ) {
        throw error;
      }
      if (isCallerAborted()) {
        throw new AsyncContinuationInterruptedError(
          "Runtime continuation stream aborted by caller."
        );
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", abortListener);
      reader.releaseLock();
      onDone();
    }
  }

  private parseStreamEventLine(line: string): RuntimeTurnStreamEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AsyncContinuationDispatchAmbiguousError(
        "Runtime continuation stream returned malformed NDJSON."
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== "string"
    ) {
      throw new AsyncContinuationDispatchAmbiguousError(
        "Runtime continuation stream event missing type."
      );
    }
    return parsed as RuntimeTurnStreamEvent;
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
