import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const GAMMA_BASE_URL = "https://public-api.gamma.app";
const GAMMA_POLL_INTERVAL_MS = 5_000;
const GAMMA_ALLOWED_EXPORT_HOST_SUFFIX = ".gamma.app";

type GammaCreateResponse = {
  generationId: string;
  warnings?: string | undefined;
};

type GammaStatusResponse = {
  generationId: string;
  status: "pending" | "completed" | "failed";
  gammaId?: string | undefined;
  gammaUrl?: string | undefined;
  exportUrl?: string | undefined;
  error?:
    | {
        message: string;
        statusCode: number;
      }
    | undefined;
};

@Injectable()
export class GammaProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest,
    options: { apiKey: string }
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    const requestedOutputFormat = this.readRequestedOutputFormat(input);
    const timeoutMs = input.timeoutMs ?? this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const createResponse = await fetch(new URL("/v1.0/generations", GAMMA_BASE_URL), {
        method: "POST",
        headers: {
          "X-API-KEY": options.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(this.buildCreatePayload(input)),
        signal: controller.signal
      });
      const createBody = await this.readJson(createResponse);
      if (!createResponse.ok) {
        throw this.toGammaCreateFailure({
          status: createResponse.status,
          body: createBody
        });
      }
      const created = this.readCreateResponse(createBody);
      const settled = await this.pollUntilSettled(
        created.generationId,
        options.apiKey,
        controller.signal
      );
      if (settled.status === "failed") {
        throw this.toGammaGenerationFailure(settled, requestedOutputFormat);
      }
      const exportUrl =
        typeof settled.exportUrl === "string" && settled.exportUrl.trim().length > 0
          ? this.readTrustedGammaExportUrl(settled.exportUrl)
          : null;
      if (exportUrl === null) {
        throw this.raiseFailure({
          code: "gamma_export_unavailable",
          message: `Gamma completed the generation but did not provide a ${requestedOutputFormat.toUpperCase()} export URL.`,
          retryable: true,
          providerStatus: {
            provider: "gamma",
            state: "failed",
            generationId: created.generationId,
            gammaId: settled.gammaId ?? null,
            gammaUrl: settled.gammaUrl ?? null,
            exportUrl: null,
            status: "completed_missing_export",
            outputType: requestedOutputFormat,
            filename: input.filename,
            updatedAt: new Date().toISOString(),
            retryable: true
          }
        });
      }
      const downloadResponse = await fetch(exportUrl, {
        method: "GET",
        signal: controller.signal
      });
      if (!downloadResponse.ok) {
        throw this.raiseFailure({
          code: "gamma_export_unavailable",
          message: `Gamma export download failed with HTTP ${downloadResponse.status}.`,
          retryable: true,
          providerStatus: {
            provider: "gamma",
            state: "failed",
            generationId: created.generationId,
            gammaId: settled.gammaId ?? null,
            gammaUrl: settled.gammaUrl ?? null,
            exportUrl,
            status: "export_download_failed",
            httpStatus: downloadResponse.status,
            outputType: requestedOutputFormat,
            filename: input.filename,
            updatedAt: new Date().toISOString(),
            retryable: true
          }
        });
      }
      const arrayBuffer = await downloadResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length === 0) {
        throw this.raiseFailure({
          code: "gamma_empty_export_payload",
          message: `Gamma returned an empty ${requestedOutputFormat.toUpperCase()} payload.`,
          retryable: true,
          providerStatus: {
            provider: "gamma",
            state: "failed",
            generationId: created.generationId,
            gammaId: settled.gammaId ?? null,
            gammaUrl: settled.gammaUrl ?? null,
            exportUrl,
            status: "export_empty",
            outputType: requestedOutputFormat,
            filename: input.filename,
            updatedAt: new Date().toISOString(),
            retryable: true
          }
        });
      }
      const mimeType =
        downloadResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
        this.defaultMimeTypeForOutputFormat(requestedOutputFormat);
      return {
        provider: "gamma",
        outputFormat: requestedOutputFormat,
        documentId: settled.gammaId ?? created.generationId,
        templateId: null,
        filename: input.filename,
        bytesBase64: buffer.toString("base64"),
        mimeType,
        respondedAt: new Date().toISOString(),
        warning:
          typeof created.warnings === "string" && created.warnings.trim().length > 0
            ? created.warnings
            : null,
        providerStatus: {
          provider: "gamma",
          state: "success",
          generationId: created.generationId,
          gammaId: this.requiredString(settled.gammaId, "gammaId"),
          gammaUrl:
            typeof settled.gammaUrl === "string" && settled.gammaUrl.trim().length > 0
              ? settled.gammaUrl.trim()
              : null,
          exportUrl,
          filename: input.filename,
          outputType: requestedOutputFormat,
          status: "completed",
          updatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceUnavailableException(`Gamma request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildCreatePayload(
    input: ProviderGatewayDocumentGenerateRequest
  ): Record<string, unknown> {
    const requestedOutputFormat = this.readRequestedOutputFormat(input);
    const presentationOptions =
      "presentationOptions" in input.providerOptions
        ? input.providerOptions.presentationOptions
        : null;
    const audience =
      presentationOptions?.textOptions?.audience ?? this.readAudience(input.htmlContent);
    const tone = presentationOptions?.textOptions?.tone ?? this.readTone(input.htmlContent);
    return {
      inputText: this.toGammaInputText(input.htmlContent),
      textMode: presentationOptions?.textMode ?? "generate",
      format: "presentation",
      exportAs: requestedOutputFormat,
      ...(presentationOptions?.themeId === null || presentationOptions?.themeId === undefined
        ? {}
        : { themeId: presentationOptions.themeId }),
      ...(input.filename === null ? {} : { title: this.stripExtension(input.filename) }),
      ...(presentationOptions?.numCards === null || presentationOptions?.numCards === undefined
        ? { numCards: this.estimateCardCount(input.htmlContent) }
        : { numCards: presentationOptions.numCards }),
      ...(presentationOptions?.cardSplit === null || presentationOptions?.cardSplit === undefined
        ? {}
        : { cardSplit: presentationOptions.cardSplit }),
      ...(presentationOptions?.additionalInstructions === null ||
      presentationOptions?.additionalInstructions === undefined
        ? {}
        : { additionalInstructions: presentationOptions.additionalInstructions }),
      textOptions: {
        amount: presentationOptions?.textOptions?.amount ?? "medium",
        language: presentationOptions?.textOptions?.language ?? "en",
        ...(tone === null ? {} : { tone }),
        ...(audience === null ? {} : { audience })
      },
      ...(presentationOptions?.cardOptions?.dimensions === null ||
      presentationOptions?.cardOptions?.dimensions === undefined
        ? {}
        : {
            cardOptions: {
              dimensions: presentationOptions.cardOptions.dimensions
            }
          }),
      imageOptions:
        presentationOptions?.imageOptions === null ||
        presentationOptions?.imageOptions === undefined
          ? {
              source: "themeAccent"
            }
          : {
              source: presentationOptions.imageOptions.source ?? "themeAccent",
              ...(presentationOptions.imageOptions.model === null ||
              presentationOptions.imageOptions.model === undefined
                ? {}
                : { model: presentationOptions.imageOptions.model }),
              ...(presentationOptions.imageOptions.style === null ||
              presentationOptions.imageOptions.style === undefined
                ? {}
                : { style: presentationOptions.imageOptions.style }),
              ...(presentationOptions.imageOptions.stylePreset === null ||
              presentationOptions.imageOptions.stylePreset === undefined
                ? {}
                : { stylePreset: presentationOptions.imageOptions.stylePreset })
            }
    };
  }

  private readRequestedOutputFormat(
    input: ProviderGatewayDocumentGenerateRequest
  ): Extract<ProviderGatewayDocumentGenerateResult, { provider: "gamma" }>["outputFormat"] {
    return input.providerOptions.outputFormat === "pdf" ? "pdf" : "pptx";
  }

  private defaultMimeTypeForOutputFormat(outputFormat: "pdf" | "pptx"): string {
    return outputFormat === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  private readTrustedGammaExportUrl(value: string): string | null {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:") {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      return hostname === "gamma.app" || hostname.endsWith(GAMMA_ALLOWED_EXPORT_HOST_SUFFIX)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  private async pollUntilSettled(
    generationId: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<GammaStatusResponse> {
    let current: GammaStatusResponse | null = null;
    while (current === null || current.status === "pending") {
      await this.sleep(GAMMA_POLL_INTERVAL_MS, signal);
      const response = await fetch(new URL(`/v1.0/generations/${generationId}`, GAMMA_BASE_URL), {
        method: "GET",
        headers: {
          "X-API-KEY": apiKey
        },
        signal
      });
      const body = await this.readJson(response);
      if (!response.ok) {
        throw this.toGammaPollFailure({
          generationId,
          status: response.status,
          body
        });
      }
      current = this.readStatusResponse(body);
    }
    return current;
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async readJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private readCreateResponse(value: unknown): GammaCreateResponse {
    const row = this.asObject(value);
    if (typeof row?.generationId !== "string" || row.generationId.trim().length === 0) {
      throw new ServiceUnavailableException(
        "Gamma returned an invalid generation creation response."
      );
    }
    return {
      generationId: row.generationId.trim(),
      warnings: typeof row.warnings === "string" ? row.warnings : undefined
    };
  }

  private readStatusResponse(value: unknown): GammaStatusResponse {
    const row = this.asObject(value);
    if (
      typeof row?.generationId !== "string" ||
      (row.status !== "pending" && row.status !== "completed" && row.status !== "failed")
    ) {
      throw new ServiceUnavailableException(
        "Gamma returned an invalid generation status response."
      );
    }
    return {
      generationId: row.generationId,
      status: row.status,
      gammaId: typeof row.gammaId === "string" ? row.gammaId : undefined,
      gammaUrl: typeof row.gammaUrl === "string" ? row.gammaUrl : undefined,
      exportUrl: typeof row.exportUrl === "string" ? row.exportUrl : undefined,
      error:
        row.error !== null &&
        typeof row.error === "object" &&
        !Array.isArray(row.error) &&
        typeof (row.error as Record<string, unknown>).message === "string" &&
        typeof (row.error as Record<string, unknown>).statusCode === "number"
          ? {
              message: (row.error as Record<string, unknown>).message as string,
              statusCode: (row.error as Record<string, unknown>).statusCode as number
            }
          : undefined
    };
  }

  private toGammaCreateFailure(input: { status: number; body: unknown }) {
    const message = this.extractErrorMessage(input.body, input.status);
    const retryable = input.status >= 500 || input.status === 408 || input.status === 429;
    const code =
      input.status === 401
        ? "gamma_auth_failed"
        : input.status === 402
          ? "gamma_credits_exhausted"
          : input.status === 403
            ? "gamma_access_denied"
            : retryable
              ? "gamma_unavailable"
              : "gamma_request_invalid";
    return this.raiseFailure({
      code,
      message,
      retryable,
      providerStatus: {
        provider: "gamma",
        state: "failed",
        status: "create_failed",
        httpStatus: input.status,
        message,
        retryable
      }
    });
  }

  private toGammaPollFailure(input: { generationId: string; status: number; body: unknown }) {
    const message = this.extractErrorMessage(input.body, input.status);
    const retryable = input.status >= 500 || input.status === 408 || input.status === 429;
    const code = input.status === 404 ? "gamma_generation_not_found" : "gamma_poll_failed";
    return this.raiseFailure({
      code,
      message,
      retryable,
      providerStatus: {
        provider: "gamma",
        state: "failed",
        generationId: input.generationId,
        status: "poll_failed",
        httpStatus: input.status,
        message,
        retryable
      }
    });
  }

  private toGammaGenerationFailure(input: GammaStatusResponse, outputType: "pdf" | "pptx") {
    const message = input.error?.message?.trim() || "Gamma generation failed.";
    return this.raiseFailure({
      code: "gamma_generation_failed",
      message,
      retryable: false,
      providerStatus: {
        provider: "gamma",
        state: "failed",
        generationId: input.generationId,
        gammaId: input.gammaId ?? null,
        gammaUrl: input.gammaUrl ?? null,
        exportUrl: input.exportUrl ?? null,
        status: "failed",
        outputType,
        updatedAt: new Date().toISOString(),
        message,
        retryable: false
      }
    });
  }

  private raiseFailure(input: {
    code: string;
    message: string;
    retryable: boolean;
    providerStatus: Record<string, unknown>;
  }) {
    const payload = {
      error: {
        code: input.code,
        message: input.message,
        retryable: input.retryable,
        providerStatus: input.providerStatus
      }
    };
    if (input.retryable) {
      return new ServiceUnavailableException(payload);
    }
    if (input.code === "gamma_auth_failed") {
      return new UnauthorizedException(payload);
    }
    return new BadRequestException(payload);
  }

  private extractErrorMessage(body: unknown, status: number): string {
    if (typeof body === "string" && body.trim().length > 0) {
      return body.trim();
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (typeof error?.message === "string" && error.message.trim().length > 0) {
      return error.message.trim();
    }
    return `Gamma returned HTTP ${status}.`;
  }

  private toGammaInputText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private estimateCardCount(text: string): number {
    const normalized = this.toGammaInputText(text);
    const approx = Math.ceil(normalized.length / 700);
    return Math.max(6, Math.min(12, approx));
  }

  private readTone(text: string): string | null {
    const match = /Instructions\s+(.*?)\s+Source User Message/i.exec(this.toGammaInputText(text));
    return match?.[1]?.trim() || null;
  }

  private readAudience(text: string): string | null {
    const normalized = this.toGammaInputText(text).toLowerCase();
    if (normalized.includes("investor")) return "investors";
    if (normalized.includes("executive")) return "executives";
    if (normalized.includes("customer")) return "customers";
    return null;
  }

  private stripExtension(filename: string): string {
    return filename.replace(/\.[^.]+$/, "").trim();
  }

  private requiredString(value: string | undefined, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ServiceUnavailableException(`Gamma completed without a valid ${fieldName}.`);
    }
    return value.trim();
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
