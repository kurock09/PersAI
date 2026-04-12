import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { RuntimeMediaTranscriptionResult } from "@persai/runtime-contract";
import { AssistantRuntimeError } from "../assistant-runtime.facade";

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class NativeMediaTranscriptionService {
  async transcribe(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<RuntimeMediaTranscriptionResult> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime media transcription is enabled but PERSAI_RUNTIME_BASE_URL is not configured."
      );
    }

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType }),
      input.filename ?? this.defaultAudioFilename(input.mimeType)
    );

    const response = await this.postForm(
      new URL("/api/v1/media/transcribe", baseUrl).toString(),
      formData,
      config.PERSAI_RUNTIME_TURN_TIMEOUT_MS
    );
    if (!response.ok) {
      this.throwForFailedResponse(response);
    }
    if (!this.isRuntimeMediaTranscriptionResult(response.body)) {
      throw new AssistantRuntimeError(
        "invalid_response",
        "Native runtime returned an invalid media transcription response."
      );
    }

    return response.body;
  }

  private async postForm(url: string, body: FormData, timeoutMs: number): Promise<JsonResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        body,
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown = null;

      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        responseBody = text.length > 0 ? text : null;
      }

      return {
        ok: response.ok,
        status: response.status,
        body: responseBody
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AssistantRuntimeError(
          "timeout",
          `Native runtime media transcription timed out after ${timeoutMs}ms.`
        );
      }
      const message =
        error instanceof Error ? error.message : "Unknown native runtime media failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Native runtime media transcription failed: ${message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Native runtime media transcription failed with HTTP ${response.status}.`;

    if (response.status === 400) {
      throw new AssistantRuntimeError("invalid_response", message);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AssistantRuntimeError("auth_failure", message);
    }
    if (response.status === 408 || response.status === 504) {
      throw new AssistantRuntimeError("timeout", message);
    }
    if (response.status >= 500) {
      throw new AssistantRuntimeError("runtime_unreachable", message);
    }

    throw new AssistantRuntimeError("runtime_degraded", message);
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body;
    }

    const row = this.asObject(body);
    const nestedError = this.asObject(row?.error);
    const nestedErrorMessage = this.readMessageField(nestedError?.message);
    if (nestedErrorMessage !== null) {
      return nestedErrorMessage;
    }

    return this.readMessageField(row?.message);
  }

  private readMessageField(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const messages = value.filter((entry): entry is string => typeof entry === "string");
      return messages.length > 0 ? messages.join("; ") : null;
    }
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isRuntimeMediaTranscriptionResult(
    value: unknown
  ): value is RuntimeMediaTranscriptionResult {
    const row = this.asObject(value);
    return (
      row?.provider === "openai" &&
      typeof row.model === "string" &&
      typeof row.text === "string" &&
      typeof row.respondedAt === "string"
    );
  }

  private defaultAudioFilename(mimeType: string): string {
    switch (mimeType) {
      case "audio/mpeg":
      case "audio/mp3":
        return "audio.mp3";
      case "audio/wav":
        return "audio.wav";
      case "audio/mp4":
      case "audio/aac":
        return "audio.m4a";
      case "audio/ogg":
      case "audio/opus":
      case "audio/x-opus+ogg":
        return "audio.ogg";
      case "audio/flac":
        return "audio.flac";
      case "audio/webm":
      default:
        return "audio.webm";
    }
  }
}
