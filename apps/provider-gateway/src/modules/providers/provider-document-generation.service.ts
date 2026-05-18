import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS,
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
  ): ProviderGatewayDocumentGenerateRequest {
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
    if (!PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS.includes(input.credential.providerId)) {
      throw new BadRequestException("credential.providerId must be a supported document provider");
    }
    if (input.credential.providerId === "pdfmonkey") {
      const providerOptions = this.normalizePdfMonkeyProviderOptions(
        input as Extract<
          ProviderGatewayDocumentGenerateRequest,
          { credential: { providerId: "pdfmonkey" } }
        >
      );
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
          providerId: "pdfmonkey"
        },
        providerOptions
      };
    }
    const providerOptions = this.normalizeGammaProviderOptions(
      input as Extract<
        ProviderGatewayDocumentGenerateRequest,
        { credential: { providerId: "gamma" } }
      >
    );
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
        providerId: "gamma"
      },
      providerOptions
    };
  }

  private normalizePdfMonkeyProviderOptions(
    input: Extract<
      ProviderGatewayDocumentGenerateRequest,
      { credential: { providerId: "pdfmonkey" } }
    >
  ): Extract<
    ProviderGatewayDocumentGenerateRequest,
    { credential: { providerId: "pdfmonkey" } }
  >["providerOptions"] {
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

  private normalizeGammaProviderOptions(
    input: Extract<ProviderGatewayDocumentGenerateRequest, { credential: { providerId: "gamma" } }>
  ): Extract<
    ProviderGatewayDocumentGenerateRequest,
    { credential: { providerId: "gamma" } }
  >["providerOptions"] {
    if (
      input.providerOptions.outputFormat !== "pdf" &&
      input.providerOptions.outputFormat !== "pptx"
    ) {
      throw new BadRequestException(
        'Gamma document generation requires providerOptions.outputFormat="pdf" or "pptx"'
      );
    }
    const presentationOptions =
      "presentationOptions" in input.providerOptions
        ? input.providerOptions.presentationOptions
        : null;
    return {
      outputFormat: input.providerOptions.outputFormat,
      presentationOptions:
        presentationOptions === null || presentationOptions === undefined
          ? null
          : {
              themeId:
                typeof presentationOptions.themeId === "string" &&
                presentationOptions.themeId.trim().length > 0
                  ? presentationOptions.themeId.trim()
                  : null,
              textMode:
                presentationOptions.textMode === "generate" ||
                presentationOptions.textMode === "condense" ||
                presentationOptions.textMode === "preserve"
                  ? presentationOptions.textMode
                  : null,
              numCards:
                presentationOptions.numCards === null || presentationOptions.numCards === undefined
                  ? null
                  : this.normalizeOptionalPositiveInteger(
                      presentationOptions.numCards,
                      "providerOptions.presentationOptions.numCards"
                    ),
              cardSplit:
                presentationOptions.cardSplit === "auto" ||
                presentationOptions.cardSplit === "inputTextBreaks"
                  ? presentationOptions.cardSplit
                  : null,
              additionalInstructions:
                typeof presentationOptions.additionalInstructions === "string"
                  ? presentationOptions.additionalInstructions.trim() || null
                  : null,
              textOptions:
                presentationOptions.textOptions === null ||
                presentationOptions.textOptions === undefined
                  ? null
                  : {
                      amount:
                        presentationOptions.textOptions.amount === "brief" ||
                        presentationOptions.textOptions.amount === "medium" ||
                        presentationOptions.textOptions.amount === "detailed" ||
                        presentationOptions.textOptions.amount === "extensive"
                          ? presentationOptions.textOptions.amount
                          : null,
                      language:
                        typeof presentationOptions.textOptions.language === "string" &&
                        presentationOptions.textOptions.language.trim().length > 0
                          ? presentationOptions.textOptions.language.trim()
                          : null,
                      tone:
                        typeof presentationOptions.textOptions.tone === "string" &&
                        presentationOptions.textOptions.tone.trim().length > 0
                          ? presentationOptions.textOptions.tone.trim()
                          : null,
                      audience:
                        typeof presentationOptions.textOptions.audience === "string" &&
                        presentationOptions.textOptions.audience.trim().length > 0
                          ? presentationOptions.textOptions.audience.trim()
                          : null
                    },
              imageOptions:
                presentationOptions.imageOptions === null ||
                presentationOptions.imageOptions === undefined
                  ? null
                  : {
                      source:
                        presentationOptions.imageOptions.source === "webAllImages" ||
                        presentationOptions.imageOptions.source === "webFreeToUse" ||
                        presentationOptions.imageOptions.source === "webFreeToUseCommercially" ||
                        presentationOptions.imageOptions.source === "aiGenerated" ||
                        presentationOptions.imageOptions.source === "pictographic" ||
                        presentationOptions.imageOptions.source === "giphy" ||
                        presentationOptions.imageOptions.source === "pexels" ||
                        presentationOptions.imageOptions.source === "placeholder" ||
                        presentationOptions.imageOptions.source === "noImages" ||
                        presentationOptions.imageOptions.source === "themeAccent"
                          ? presentationOptions.imageOptions.source
                          : null,
                      model:
                        typeof presentationOptions.imageOptions.model === "string" &&
                        presentationOptions.imageOptions.model.trim().length > 0
                          ? presentationOptions.imageOptions.model.trim()
                          : null,
                      style:
                        typeof presentationOptions.imageOptions.style === "string" &&
                        presentationOptions.imageOptions.style.trim().length > 0
                          ? presentationOptions.imageOptions.style.trim()
                          : null,
                      stylePreset:
                        presentationOptions.imageOptions.stylePreset === "illustration" ||
                        presentationOptions.imageOptions.stylePreset === "abstract" ||
                        presentationOptions.imageOptions.stylePreset === "3D" ||
                        presentationOptions.imageOptions.stylePreset === "lineArt" ||
                        presentationOptions.imageOptions.stylePreset === "custom"
                          ? presentationOptions.imageOptions.stylePreset
                          : null
                    },
              cardOptions:
                presentationOptions.cardOptions === null ||
                presentationOptions.cardOptions === undefined
                  ? null
                  : {
                      dimensions:
                        presentationOptions.cardOptions.dimensions === "16x9" ||
                        presentationOptions.cardOptions.dimensions === "4x3" ||
                        presentationOptions.cardOptions.dimensions === "fluid"
                          ? presentationOptions.cardOptions.dimensions
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
