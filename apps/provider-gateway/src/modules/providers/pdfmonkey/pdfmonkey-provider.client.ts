import {
  BadGatewayException,
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

const PDFMONKEY_BASE_URL = "https://api.pdfmonkey.io";

type PdfMonkeyProviderFailure = {
  code: string;
  message: string;
  retryable: boolean;
  providerStatus: Record<string, unknown>;
};

type PdfMonkeyDocumentCard = {
  id: string;
  document_template_id: string;
  download_url: string;
  failure_cause: string | null;
  filename: string | null;
  preview_url: string | null;
  output_type: "pdf";
  status: "success";
  updated_at: string | null;
};

@Injectable()
export class PdfMonkeyProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest,
    options: { apiKey: string }
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    if (input.providerOptions.outputFormat !== "pdf") {
      throw new BadRequestException(
        'PDFMonkey provider requires providerOptions.outputFormat="pdf".'
      );
    }
    const timeoutMs = input.timeoutMs ?? this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const createResponse = await fetch(new URL("/api/v1/documents/sync", PDFMONKEY_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          document: {
            document_template_id: input.providerOptions.pdfmonkeyTemplateId,
            status: "pending",
            payload: {
              htmlContent: input.htmlContent
            },
            meta:
              input.filename === null
                ? undefined
                : {
                    _filename: input.filename
                  }
          }
        }),
        signal: controller.signal
      });
      const body = await this.readJson(createResponse);
      if (!createResponse.ok) {
        throw this.toPdfMonkeyCreateFailure({
          status: createResponse.status,
          body,
          templateId: input.providerOptions.pdfmonkeyTemplateId,
          filename: input.filename
        });
      }
      const card = this.readDocumentCard(body);
      const downloadResponse = await fetch(card.download_url, { signal: controller.signal });
      if (!downloadResponse.ok) {
        throw this.toPdfMonkeyDownloadFailure({
          status: downloadResponse.status,
          body: await this.readJson(downloadResponse),
          documentId: card.id,
          templateId: card.document_template_id,
          filename: card.filename,
          downloadUrl: card.download_url,
          previewUrl: card.preview_url,
          outputType: card.output_type,
          updatedAt: card.updated_at
        });
      }
      const arrayBuffer = await downloadResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length === 0) {
        throw this.raiseFailure({
          code: "pdfmonkey_empty_pdf_payload",
          message: "PDFMonkey returned an empty PDF payload.",
          retryable: true,
          providerStatus: {
            provider: "pdfmonkey",
            state: "failed",
            status: "download_empty",
            documentTemplateId: card.document_template_id,
            filename: card.filename,
            downloadUrl: card.download_url,
            previewUrl: card.preview_url,
            outputType: card.output_type,
            failureCause: card.failure_cause,
            updatedAt: card.updated_at
          }
        });
      }
      return {
        provider: "pdfmonkey",
        outputFormat: "pdf",
        documentId: card.id,
        templateId: card.document_template_id,
        filename: card.filename,
        bytesBase64: buffer.toString("base64"),
        mimeType: "application/pdf",
        respondedAt: new Date().toISOString(),
        warning: null,
        providerStatus: {
          provider: "pdfmonkey",
          state: "success",
          documentId: card.id,
          documentTemplateId: card.document_template_id,
          downloadUrl: card.download_url,
          previewUrl: card.preview_url,
          failureCause: card.failure_cause,
          filename: card.filename,
          outputType: card.output_type,
          status: card.status,
          updatedAt: card.updated_at
        }
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceUnavailableException(`PDFMonkey request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private readDocumentCard(value: unknown): PdfMonkeyDocumentCard {
    const row = this.asObject(value);
    const card = this.asObject(row?.document_card);
    if (
      card === null ||
      typeof card.id !== "string" ||
      typeof card.document_template_id !== "string" ||
      typeof card.download_url !== "string" ||
      (card.failure_cause !== null && typeof card.failure_cause !== "string") ||
      (card.filename !== null && typeof card.filename !== "string") ||
      (card.preview_url !== null && typeof card.preview_url !== "string") ||
      card.output_type !== "pdf" ||
      card.status !== "success" ||
      (card.updated_at !== null && typeof card.updated_at !== "string")
    ) {
      throw new ServiceUnavailableException(
        "PDFMonkey returned an invalid document_card response."
      );
    }
    return card as PdfMonkeyDocumentCard;
  }

  private extractErrorMessage(body: unknown, status: number): string {
    if (typeof body === "string" && body.trim().length > 0) {
      return body.trim();
    }
    const row = this.asObject(body);
    const errors = this.asObject(row?.errors);
    if (errors !== null) {
      const first = Object.values(errors)[0];
      if (Array.isArray(first) && typeof first[0] === "string") {
        return first[0];
      }
    }
    return `PDFMonkey returned HTTP ${status}.`;
  }

  private toPdfMonkeyCreateFailure(input: {
    status: number;
    body: unknown;
    templateId: string;
    filename: string | null;
  }):
    | BadRequestException
    | UnauthorizedException
    | BadGatewayException
    | ServiceUnavailableException {
    const message = this.extractErrorMessage(input.body, input.status);
    const code = this.classifyFailureCode(input.status, message);
    const retryable = input.status >= 500 || input.status === 408 || input.status === 429;
    const providerStatus = {
      provider: "pdfmonkey",
      state: "failed",
      status: "create_failed",
      httpStatus: input.status,
      documentTemplateId: input.templateId,
      filename: input.filename,
      message,
      failureCause: message,
      retryable
    };
    return this.raiseFailure({
      code,
      message,
      retryable,
      providerStatus
    });
  }

  private toPdfMonkeyDownloadFailure(input: {
    status: number;
    body: unknown;
    documentId: string;
    templateId: string;
    filename: string | null;
    downloadUrl: string;
    previewUrl: string | null;
    outputType: "pdf";
    updatedAt: string | null;
  }):
    | BadRequestException
    | UnauthorizedException
    | BadGatewayException
    | ServiceUnavailableException {
    const message = this.extractErrorMessage(input.body, input.status);
    const retryable = true;
    return this.raiseFailure({
      code: "pdfmonkey_download_unavailable",
      message,
      retryable,
      providerStatus: {
        provider: "pdfmonkey",
        state: "failed",
        status: "download_failed",
        httpStatus: input.status,
        documentId: input.documentId,
        documentTemplateId: input.templateId,
        filename: input.filename,
        downloadUrl: input.downloadUrl,
        previewUrl: input.previewUrl,
        outputType: input.outputType,
        updatedAt: input.updatedAt,
        message,
        failureCause: message,
        retryable
      }
    });
  }

  private classifyFailureCode(status: number, message: string): string {
    const normalized = message.trim().toLowerCase();
    if (status === 401 || status === 403) {
      return "pdfmonkey_auth_failed";
    }
    if (status === 404) {
      return "pdfmonkey_template_not_found";
    }
    if (status === 408 || status === 429) {
      return status === 408 ? "pdfmonkey_timeout" : "pdfmonkey_rate_limited";
    }
    if (status >= 500) {
      return "pdfmonkey_unavailable";
    }
    if (normalized.includes("template")) {
      return "pdfmonkey_template_invalid";
    }
    if (normalized.includes("api key") || normalized.includes("unauthorized")) {
      return "pdfmonkey_auth_failed";
    }
    return "pdfmonkey_request_invalid";
  }

  private raiseFailure(
    input: PdfMonkeyProviderFailure
  ):
    | BadRequestException
    | UnauthorizedException
    | BadGatewayException
    | ServiceUnavailableException {
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
    if (input.code === "pdfmonkey_auth_failed") {
      return new UnauthorizedException(payload);
    }
    return new BadRequestException(payload);
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
