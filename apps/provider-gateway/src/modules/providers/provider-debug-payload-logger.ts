import { Logger } from "@nestjs/common";

export const PROVIDER_DEBUG_LOGGER_NAME = "persai.debug.provider" as const;

const TRUTHY_ENV_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthyEnvFlag(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  return TRUTHY_ENV_FLAG_VALUES.has(raw.trim().toLowerCase());
}

const DEFAULT_DEBUG_PAYLOAD_RATE = 0.05;
const DEBUG_PAYLOAD_PREVIEW_CHARS = 500;
const DEBUG_PAYLOAD_SYSTEM_EDGE_CHARS = 500;

let warnedInvalidDebugPayloadRate = false;

type DebugProvider = "anthropic" | "openai";

type DebugSystemPromptPreview = {
  systemPromptFirst500: string;
  systemPromptLast500: string | null;
  systemPromptTotalChars: number;
};

type DebugMessagePreview = {
  role: string;
  textPreview: string | null;
  toolPreview: string | null;
  redactedAttachments?: string[];
};

export class ProviderDebugPayloadLogger {
  private readonly logger: Logger;

  constructor(loggerName: string) {
    this.logger = new Logger(loggerName);
  }

  /**
   * ADR-119 Slice 14: accept any common truthy spelling (`"1"`, `"true"`, `"yes"`,
   * `"on"`) case-insensitively so live-debug can be enabled the same way a human
   * operator would set a feature flag. Anything else (including the empty string)
   * keeps the dumper off.
   */
  shouldDump(): boolean {
    if (!isTruthyEnvFlag(process.env.PERSAI_DEBUG_PROVIDER_PAYLOAD)) {
      return false;
    }
    return Math.random() < this.resolveSampleRate();
  }

  dumpRequest(opts: {
    provider: DebugProvider;
    requestId: string;
    payload: unknown;
    systemPromptText: string | null;
    messages: unknown[];
  }): void {
    void opts.payload;
    if (!this.shouldDump()) {
      return;
    }
    // ADR-119 Slice 14: emit at INFO so a default LOG_LEVEL=info pod can surface
    // the dump without flipping the entire logger to debug (which is noisy for
    // every other module). Gating still lives in `shouldDump()`.
    this.logger.log({
      event: "provider_payload_dump",
      provider: opts.provider,
      requestId: opts.requestId,
      system:
        opts.systemPromptText === null ? null : this.previewSystemPrompt(opts.systemPromptText),
      messages: opts.messages.map((message) => this.previewMessage(message))
    });
  }

  dumpResponse(opts: { provider: DebugProvider; requestId: string; response: unknown }): void {
    if (!this.shouldDump()) {
      return;
    }
    this.logger.log({
      event: "provider_payload_response_dump",
      provider: opts.provider,
      requestId: opts.requestId,
      response: this.sanitizeResponseValue(opts.response)
    });
  }

  private resolveSampleRate(): number {
    const rawValue =
      process.env.PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE ?? String(DEFAULT_DEBUG_PAYLOAD_RATE);
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      if (!warnedInvalidDebugPayloadRate) {
        warnedInvalidDebugPayloadRate = true;
        this.logger.warn({
          event: "provider_payload_debug_rate_invalid",
          configuredValue: rawValue,
          fallbackRate: DEFAULT_DEBUG_PAYLOAD_RATE
        });
      }
      return DEFAULT_DEBUG_PAYLOAD_RATE;
    }
    return parsed;
  }

  private previewSystemPrompt(text: string): DebugSystemPromptPreview {
    if (text.length <= DEBUG_PAYLOAD_SYSTEM_EDGE_CHARS * 2) {
      return {
        systemPromptFirst500: text,
        systemPromptLast500: null,
        systemPromptTotalChars: text.length
      };
    }
    return {
      systemPromptFirst500: text.slice(0, DEBUG_PAYLOAD_SYSTEM_EDGE_CHARS),
      systemPromptLast500: `...[${String(text.length)} chars total]...${text.slice(
        -DEBUG_PAYLOAD_SYSTEM_EDGE_CHARS
      )}`,
      systemPromptTotalChars: text.length
    };
  }

  private previewMessage(message: unknown): DebugMessagePreview {
    const row = this.asRecord(message);
    const roleCandidate = row?.role ?? row?.type;
    const textParts: string[] = [];
    const toolParts: string[] = [];
    const redactedAttachments: string[] = [];
    this.collectMessagePreviewParts(row?.content ?? row, {
      textParts,
      toolParts,
      redactedAttachments
    });
    return {
      role: typeof roleCandidate === "string" ? roleCandidate : "unknown",
      textPreview: this.previewJoinedParts(textParts),
      toolPreview: this.previewJoinedParts(toolParts),
      ...(redactedAttachments.length === 0 ? {} : { redactedAttachments })
    };
  }

  private collectMessagePreviewParts(
    value: unknown,
    output: { textParts: string[]; toolParts: string[]; redactedAttachments: string[] }
  ): void {
    if (typeof value === "string") {
      output.textParts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectMessagePreviewParts(item, output);
      }
      return;
    }
    const row = this.asRecord(value);
    if (row === null) {
      return;
    }
    const type = typeof row.type === "string" ? row.type : null;
    if (
      (type === "text" || type === "input_text" || type === "output_text") &&
      typeof row.text === "string"
    ) {
      output.textParts.push(row.text);
      return;
    }
    if (type === "image" || type === "document" || type === "input_image") {
      const marker = this.redactBase64Attachment(row);
      if (marker !== null) {
        output.redactedAttachments.push(marker);
      }
      return;
    }
    if (type === "tool_use" && row.input !== undefined) {
      output.toolParts.push(this.safeJsonStringify(row.input));
      return;
    }
    if (type === "function_call" && typeof row.arguments === "string") {
      output.toolParts.push(row.arguments);
      return;
    }
    if (Array.isArray(row.tool_calls)) {
      for (const toolCall of row.tool_calls) {
        const toolCallRow = this.asRecord(toolCall);
        const functionRow = this.asRecord(toolCallRow?.function);
        const argumentsValue = functionRow?.arguments ?? toolCallRow?.arguments;
        if (typeof argumentsValue === "string") {
          output.toolParts.push(argumentsValue);
        } else if (argumentsValue !== undefined) {
          output.toolParts.push(this.safeJsonStringify(argumentsValue));
        }
      }
      return;
    }
    if (row.text !== undefined || row.input !== undefined || row.arguments !== undefined) {
      this.collectMessagePreviewParts(row.text ?? row.input ?? row.arguments, output);
    }
  }

  private redactBase64Attachment(row: Record<string, unknown>): string | null {
    const source = this.asRecord(row.source);
    const sourceType = typeof source?.type === "string" ? source.type : null;
    if (sourceType === "base64" && typeof source?.data === "string") {
      return this.buildBase64Marker(
        typeof source.media_type === "string" ? source.media_type : null,
        source.data
      );
    }
    const imageUrl = typeof row.image_url === "string" ? row.image_url : null;
    if (imageUrl !== null && imageUrl.startsWith("data:") && imageUrl.includes(";base64,")) {
      const [metadata, data] = imageUrl.split(";base64,", 2);
      const mime = metadata?.slice("data:".length) ?? null;
      return this.buildBase64Marker(mime, data ?? "");
    }
    const fileData = typeof row.file_data === "string" ? row.file_data : null;
    if (fileData !== null && fileData.startsWith("data:") && fileData.includes(";base64,")) {
      const [metadata, data] = fileData.split(";base64,", 2);
      const mime = metadata?.slice("data:".length) ?? null;
      return this.buildBase64Marker(mime, data ?? "");
    }
    return null;
  }

  private buildBase64Marker(mimeType: string | null, base64Value: string): string {
    return `<redacted:${mimeType ?? "application/octet-stream"}:base64:LENGTH=${String(
      base64Value.length
    )}>`;
  }

  private previewJoinedParts(parts: string[]): string | null {
    const joined = parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join("\n\n");
    return joined.length === 0 ? null : joined.slice(0, DEBUG_PAYLOAD_PREVIEW_CHARS);
  }

  private sanitizeResponseValue(value: unknown): unknown {
    if (typeof value === "string") {
      return value.slice(0, DEBUG_PAYLOAD_PREVIEW_CHARS);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeResponseValue(item));
    }
    const row = this.asRecord(value);
    if (row === null) {
      return value;
    }
    const redacted = this.redactBase64Attachment(row);
    if (redacted !== null) {
      return redacted;
    }
    return Object.fromEntries(
      Object.entries(row).map(([key, entryValue]) => [key, this.sanitizeResponseValue(entryValue)])
    );
  }

  private safeJsonStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
