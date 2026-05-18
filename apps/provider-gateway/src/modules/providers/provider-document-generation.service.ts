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
      outputFormat: "pptx",
      presentationOptions:
        input.providerOptions.presentationOptions === null ||
        input.providerOptions.presentationOptions === undefined
          ? null
          : {
              themeId:
                typeof input.providerOptions.presentationOptions.themeId === "string" &&
                input.providerOptions.presentationOptions.themeId.trim().length > 0
                  ? input.providerOptions.presentationOptions.themeId.trim()
                  : null,
              textMode:
                input.providerOptions.presentationOptions.textMode === "generate" ||
                input.providerOptions.presentationOptions.textMode === "condense" ||
                input.providerOptions.presentationOptions.textMode === "preserve"
                  ? input.providerOptions.presentationOptions.textMode
                  : null,
              numCards:
                input.providerOptions.presentationOptions.numCards === null ||
                input.providerOptions.presentationOptions.numCards === undefined
                  ? null
                  : this.normalizeOptionalPositiveInteger(
                      input.providerOptions.presentationOptions.numCards,
                      "providerOptions.presentationOptions.numCards"
                    ),
              cardSplit:
                input.providerOptions.presentationOptions.cardSplit === "auto" ||
                input.providerOptions.presentationOptions.cardSplit === "inputTextBreaks"
                  ? input.providerOptions.presentationOptions.cardSplit
                  : null,
              additionalInstructions:
                typeof input.providerOptions.presentationOptions.additionalInstructions === "string"
                  ? input.providerOptions.presentationOptions.additionalInstructions.trim() || null
                  : null,
              textOptions:
                input.providerOptions.presentationOptions.textOptions === null ||
                input.providerOptions.presentationOptions.textOptions === undefined
                  ? null
                  : {
                      amount:
                        input.providerOptions.presentationOptions.textOptions.amount === "brief" ||
                        input.providerOptions.presentationOptions.textOptions.amount === "medium" ||
                        input.providerOptions.presentationOptions.textOptions.amount ===
                          "detailed" ||
                        input.providerOptions.presentationOptions.textOptions.amount === "extensive"
                          ? input.providerOptions.presentationOptions.textOptions.amount
                          : null,
                      language:
                        typeof input.providerOptions.presentationOptions.textOptions.language ===
                          "string" &&
                        input.providerOptions.presentationOptions.textOptions.language.trim()
                          .length > 0
                          ? input.providerOptions.presentationOptions.textOptions.language.trim()
                          : null,
                      tone:
                        typeof input.providerOptions.presentationOptions.textOptions.tone ===
                          "string" &&
                        input.providerOptions.presentationOptions.textOptions.tone.trim().length > 0
                          ? input.providerOptions.presentationOptions.textOptions.tone.trim()
                          : null,
                      audience:
                        typeof input.providerOptions.presentationOptions.textOptions.audience ===
                          "string" &&
                        input.providerOptions.presentationOptions.textOptions.audience.trim()
                          .length > 0
                          ? input.providerOptions.presentationOptions.textOptions.audience.trim()
                          : null
                    },
              imageOptions:
                input.providerOptions.presentationOptions.imageOptions === null ||
                input.providerOptions.presentationOptions.imageOptions === undefined
                  ? null
                  : {
                      source:
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "webAllImages" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "webFreeToUse" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "webFreeToUseCommercially" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "aiGenerated" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "pictographic" ||
                        input.providerOptions.presentationOptions.imageOptions.source === "giphy" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "pexels" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "placeholder" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "noImages" ||
                        input.providerOptions.presentationOptions.imageOptions.source ===
                          "themeAccent"
                          ? input.providerOptions.presentationOptions.imageOptions.source
                          : null,
                      model:
                        typeof input.providerOptions.presentationOptions.imageOptions.model ===
                          "string" &&
                        input.providerOptions.presentationOptions.imageOptions.model.trim().length >
                          0
                          ? input.providerOptions.presentationOptions.imageOptions.model.trim()
                          : null,
                      style:
                        typeof input.providerOptions.presentationOptions.imageOptions.style ===
                          "string" &&
                        input.providerOptions.presentationOptions.imageOptions.style.trim().length >
                          0
                          ? input.providerOptions.presentationOptions.imageOptions.style.trim()
                          : null,
                      stylePreset:
                        input.providerOptions.presentationOptions.imageOptions.stylePreset ===
                          "illustration" ||
                        input.providerOptions.presentationOptions.imageOptions.stylePreset ===
                          "abstract" ||
                        input.providerOptions.presentationOptions.imageOptions.stylePreset ===
                          "3D" ||
                        input.providerOptions.presentationOptions.imageOptions.stylePreset ===
                          "lineArt" ||
                        input.providerOptions.presentationOptions.imageOptions.stylePreset ===
                          "custom"
                          ? input.providerOptions.presentationOptions.imageOptions.stylePreset
                          : null
                    },
              cardOptions:
                input.providerOptions.presentationOptions.cardOptions === null ||
                input.providerOptions.presentationOptions.cardOptions === undefined
                  ? null
                  : {
                      dimensions:
                        input.providerOptions.presentationOptions.cardOptions.dimensions ===
                          "16x9" ||
                        input.providerOptions.presentationOptions.cardOptions.dimensions ===
                          "4x3" ||
                        input.providerOptions.presentationOptions.cardOptions.dimensions === "fluid"
                          ? input.providerOptions.presentationOptions.cardOptions.dimensions
                          : null
                    }
            }
    };
  }

  private normalizeOptionalPositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      throw new BadRequestException(`${path} must be a positive integer`);
    }
    return Number(value);
  }
}
