import { loadApiConfig } from "@persai/config";
import {
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { Injectable, Logger } from "@nestjs/common";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";

const PDF_TEXT_EXTRACTION_TIMEOUT_MS = 45_000;
const PDF_TEXT_EXTRACTION_MAX_OUTPUT_TOKENS = 6_000;

@Injectable()
export class ProviderGatewayPdfTextExtractionService {
  private readonly logger = new Logger(ProviderGatewayPdfTextExtractionService.name);

  constructor(
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  async extractText(params: { buffer: Buffer; filename: string | null }): Promise<string | null> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      return null;
    }

    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    if (settings.primary === null) {
      return null;
    }

    const request: ProviderGatewayTextGenerateRequest = {
      provider: settings.primary.provider,
      model: settings.primary.model,
      systemPrompt:
        "You extract searchable plain text from PDF documents for internal knowledge indexing. Return only plain UTF-8 text. Prefer faithful extraction of readable document text. If the PDF is image-based or diagram-heavy, OCR clearly visible titles, labels, headings, captions, callouts, and table text without inventing unreadable content. Do not add commentary, markdown fences, or explanations about the extraction process.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract searchable text from this PDF for internal indexing. Return plain text only."
            },
            {
              type: "pdf",
              mimeType: "application/pdf",
              dataBase64: params.buffer.toString("base64"),
              filename: params.filename
            }
          ]
        }
      ],
      maxOutputTokens: PDF_TEXT_EXTRACTION_MAX_OUTPUT_TOKENS
    };

    try {
      const result = await this.postJson(
        new URL("/api/v1/providers/generate-text", baseUrl).toString(),
        request,
        PDF_TEXT_EXTRACTION_TIMEOUT_MS
      );
      const text = result.text?.trim() ?? "";
      return text.length > 0 ? text : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Provider PDF text extraction failed for "${params.filename ?? "document"}": ${message}`
      );
      return null;
    }
  }

  private async postJson(
    url: string,
    body: ProviderGatewayTextGenerateRequest,
    timeoutMs: number
  ): Promise<ProviderGatewayTextGenerateResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          bodyText.trim().length > 0
            ? `HTTP ${response.status}: ${bodyText.trim()}`
            : `HTTP ${response.status}`
        );
      }
      return (await response.json()) as ProviderGatewayTextGenerateResult;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
