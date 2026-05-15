import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS,
  type PersaiRuntimeDocumentProviderId,
  type ProviderGatewayDocumentGenerateRequest,
  type ProviderGatewayDocumentGenerateResult
} from "@persai/runtime-contract";
import { GammaProviderClient } from "./gamma/gamma-provider.client";
import { PdfMonkeyProviderClient } from "./pdfmonkey/pdfmonkey-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class ProviderDocumentGenerationService {
  constructor(
    private readonly pdfMonkeyProviderClient: PdfMonkeyProviderClient,
    private readonly gammaProviderClient: GammaProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    const normalized = this.normalizeInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId) {
      case "pdfmonkey":
        return this.pdfMonkeyProviderClient.generateDocument(normalized, { apiKey });
      case "gamma":
        return this.gammaProviderClient.generateDocument(normalized, { apiKey });
    }
  }

  private normalizeInput(
    input: ProviderGatewayDocumentGenerateRequest
  ): ProviderGatewayDocumentGenerateRequest & {
    credential: ProviderGatewayDocumentGenerateRequest["credential"] & {
      providerId: PersaiRuntimeDocumentProviderId;
    };
  } {
    if (typeof input.htmlContent !== "string" || input.htmlContent.trim().length === 0) {
      throw new BadRequestException("htmlContent must be a non-empty string");
    }
    if (
      input.filename !== null &&
      input.filename !== undefined &&
      (typeof input.filename !== "string" || input.filename.trim().length === 0)
    ) {
      throw new BadRequestException("filename must be a non-empty string or null");
    }
    if (input.credential.toolCode !== "document") {
      throw new BadRequestException('credential.toolCode must be "document"');
    }
    if (
      typeof input.credential.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (
      input.credential.providerId === null ||
      !PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS.includes(input.credential.providerId)
    ) {
      throw new BadRequestException("credential.providerId must be a supported document provider");
    }
    const providerOptions = this.normalizeProviderOptions(input);
    return {
      htmlContent: input.htmlContent,
      filename:
        input.filename === null || input.filename === undefined ? null : input.filename.trim(),
      timeoutMs:
        input.timeoutMs === null || input.timeoutMs === undefined
          ? null
          : this.normalizeOptionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      credential: {
        toolCode: "document",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId
      },
      providerOptions
    };
  }

  private normalizeProviderOptions(
    input: ProviderGatewayDocumentGenerateRequest
  ): ProviderGatewayDocumentGenerateRequest["providerOptions"] {
    if (input.credential.providerId === "pdfmonkey") {
      if (
        input.providerOptions.outputFormat !== "pdf" ||
        typeof input.providerOptions.pdfmonkeyTemplateId !== "string" ||
        input.providerOptions.pdfmonkeyTemplateId.trim().length === 0
      ) {
        throw new BadRequestException(
          'PDFMonkey document generation requires providerOptions.outputFormat="pdf" and a non-empty providerOptions.pdfmonkeyTemplateId'
        );
      }
      return {
        pdfmonkeyTemplateId: input.providerOptions.pdfmonkeyTemplateId.trim(),
        outputFormat: "pdf"
      };
    }
    if (input.providerOptions.outputFormat !== "pptx") {
      throw new BadRequestException(
        'Gamma document generation requires providerOptions.outputFormat="pptx"'
      );
    }
    return {
      outputFormat: "pptx"
    };
  }

  private normalizeOptionalPositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      throw new BadRequestException(`${path} must be a positive integer`);
    }
    return Number(value);
  }
}
