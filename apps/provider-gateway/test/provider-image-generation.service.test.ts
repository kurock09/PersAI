import assert from "node:assert/strict";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult,
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult
} from "@persai/runtime-contract";
import { ProviderDocumentGenerationService } from "../src/modules/providers/provider-document-generation.service";
import type { GammaProviderClient } from "../src/modules/providers/gamma/gamma-provider.client";
import { ProviderImageGenerationService } from "../src/modules/providers/provider-image-generation.service";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PdfMonkeyProviderClient } from "../src/modules/providers/pdfmonkey/pdfmonkey-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

function readPdfMonkeyTemplateId(input: ProviderGatewayDocumentGenerateRequest): string {
  return input.credential.providerId === "pdfmonkey"
    ? (input.providerOptions.pdfmonkeyTemplateId ?? "template-123")
    : "template-123";
}

function createRequest(): ProviderGatewayImageGenerateRequest {
  return {
    prompt: "Generate a paper-cut forest scene",
    model: "gpt-image-1.5",
    count: 2,
    size: "1024x1536",
    background: "transparent",
    timeoutMs: null,
    credential: {
      toolCode: "image_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

function createEditRequest(options?: {
  includeReference?: boolean;
}): ProviderGatewayImageEditRequest {
  return {
    prompt: "Replace the couch with a red chair",
    model: "gpt-image-2",
    size: "1024x1024",
    background: "opaque",
    timeoutMs: null,
    sourceImage: {
      bytesBase64: "cmVmLWltYWdl",
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImage: options?.includeReference
      ? {
          bytesBase64: "cmVmLWNhci1pbWFnZQ==",
          mimeType: "image/png",
          filename: "red-car.png"
        }
      : null,
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

class FakeOpenAIProviderClient {
  calls: Array<{ input: ProviderGatewayImageGenerateRequest; apiKey: string | undefined }> = [];
  editCalls: Array<{ input: ProviderGatewayImageEditRequest; apiKey: string | undefined }> = [];

  async generateImage(
    input: ProviderGatewayImageGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayImageGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "openai",
      model: "gpt-image-1",
      prompt: input.prompt,
      size: input.size,
      images: [
        {
          bytesBase64: "aW1hZ2UtMQ==",
          mimeType: "image/png",
          revisedPrompt: null
        }
      ],
      respondedAt: "2026-04-13T12:00:00.000Z",
      usage: null,
      warning: null
    };
  }

  async editImage(
    input: ProviderGatewayImageEditRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayImageEditResult> {
    this.editCalls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "openai",
      model: "gpt-image-1",
      prompt: input.prompt,
      size: input.size,
      images: [
        {
          bytesBase64: "ZWRpdC1pbWFnZS0x",
          mimeType: "image/png",
          revisedPrompt: null
        }
      ],
      respondedAt: "2026-04-13T12:00:02.000Z",
      usage: null,
      warning: null
    };
  }
}

class FakePersaiInternalApiClientService {
  secretIds: string[] = [];

  async resolveSecretValue(secretId: string): Promise<string> {
    this.secretIds.push(secretId);
    return "resolved-tool-secret";
  }
}

class FakePdfMonkeyProviderClient {
  calls: Array<{ input: ProviderGatewayDocumentGenerateRequest; apiKey: string | undefined }> = [];
  error: Error | null = null;

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    if (this.error !== null) {
      throw this.error;
    }
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "pdfmonkey",
      outputFormat: "pdf",
      documentId: "pdfmonkey-doc-1",
      templateId: readPdfMonkeyTemplateId(input),
      filename: input.filename,
      bytesBase64: "JVBERi0xLjQK",
      mimeType: "application/pdf",
      respondedAt: "2026-05-15T18:00:00.000Z",
      warning: null,
      providerStatus: {
        provider: "pdfmonkey",
        state: "success",
        documentId: "pdfmonkey-doc-1",
        documentTemplateId: readPdfMonkeyTemplateId(input),
        downloadUrl: "https://example.com/document.pdf",
        previewUrl: "https://example.com/preview",
        failureCause: null,
        filename: input.filename,
        outputType: "pdf",
        status: "success",
        updatedAt: "2026-05-15T18:00:00.000Z"
      }
    };
  }
}

class FakeGammaProviderClient {
  calls: Array<{ input: ProviderGatewayDocumentGenerateRequest; apiKey: string | undefined }> = [];

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "gamma",
      outputFormat: "pptx",
      documentId: "gamma-file-1",
      templateId: null,
      filename: input.filename,
      bytesBase64: "cHB0eA==",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      respondedAt: "2026-05-15T18:10:00.000Z",
      warning: null,
      providerStatus: {
        provider: "gamma",
        state: "success",
        generationId: "gen-1",
        gammaId: "g_123",
        gammaUrl: "https://gamma.app/docs/g_123",
        exportUrl: "https://gamma.app/export/g_123.pptx",
        filename: input.filename,
        outputType: "pptx",
        status: "completed",
        updatedAt: "2026-05-15T18:10:00.000Z"
      }
    };
  }
}

function createDocumentRequest(): ProviderGatewayDocumentGenerateRequest {
  return {
    htmlContent: "<!DOCTYPE html><html><body><h1>Test</h1></body></html>",
    filename: "brief.pdf",
    timeoutMs: 120000,
    credential: {
      toolCode: "document",
      secretId: "tool/document/pdfmonkey/api-key",
      providerId: "pdfmonkey"
    },
    providerOptions: {
      pdfmonkeyTemplateId: "template-123",
      outputFormat: "pdf"
    }
  };
}

export async function runProviderImageGenerationServiceTest(): Promise<void> {
  const openaiProviderClient = new FakeOpenAIProviderClient();
  const pdfMonkeyProviderClient = new FakePdfMonkeyProviderClient();
  const gammaProviderClient = new FakeGammaProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderImageGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const documentService = new ProviderDocumentGenerationService(
    pdfMonkeyProviderClient as unknown as PdfMonkeyProviderClient,
    gammaProviderClient as unknown as GammaProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );

  const result = await service.generateImage(createRequest());
  assert.equal(result.provider, "openai");
  assert.equal(result.images.length, 1);
  assert.deepEqual(openaiProviderClient.calls[0], {
    input: createRequest(),
    apiKey: "resolved-tool-secret"
  });
  assert.deepEqual(persaiInternalApiClientService.secretIds, ["tool/image_generate/api-key"]);

  const editResult = await service.editImage(createEditRequest({ includeReference: true }));
  assert.equal(editResult.provider, "openai");
  assert.equal(editResult.images.length, 1);
  assert.deepEqual(openaiProviderClient.editCalls[0], {
    input: createEditRequest({ includeReference: true }),
    apiKey: "resolved-tool-secret"
  });
  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/image_generate/api-key"
  ]);

  await assert.rejects(
    () =>
      service.generateImage({
        ...createRequest(),
        count: 0
      }),
    /count must be an integer between/
  );

  await assert.rejects(
    () =>
      service.generateImage({
        ...createRequest(),
        background: "alpha" as never
      }),
    /background must be a supported image background/
  );

  await assert.rejects(
    () =>
      service.generateImage({
        ...createRequest(),
        credential: {
          ...createRequest().credential,
          providerId: "browserless" as never
        }
      }),
    /supported image-generation provider/
  );

  await assert.rejects(
    () =>
      service.editImage({
        ...createEditRequest(),
        sourceImage: {
          ...createEditRequest().sourceImage,
          bytesBase64: ""
        }
      }),
    /sourceImage\.bytesBase64 must be a non-empty string/
  );

  const documentResult = await documentService.generateDocument(createDocumentRequest());
  assert.equal(documentResult.provider, "pdfmonkey");
  assert.equal(documentResult.mimeType, "application/pdf");
  assert.deepEqual(pdfMonkeyProviderClient.calls[0], {
    input: createDocumentRequest(),
    apiKey: "resolved-tool-secret"
  });

  pdfMonkeyProviderClient.error = new Error("PDFMonkey deterministic failure");
  await assert.rejects(
    () => documentService.generateDocument(createDocumentRequest()),
    /PDFMonkey deterministic failure/
  );
  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/image_generate/api-key",
    "tool/document/pdfmonkey/api-key",
    "tool/document/pdfmonkey/api-key"
  ]);

  await assert.rejects(
    () =>
      documentService.generateDocument({
        htmlContent: "<!DOCTYPE html><html><body><h1>Test</h1></body></html>",
        filename: "brief.pdf",
        timeoutMs: 120000,
        credential: {
          toolCode: "document",
          secretId: "tool/document/pdfmonkey/api-key",
          providerId: "pdfmonkey"
        },
        providerOptions: {
          outputFormat: "pdf",
          pdfmonkeyTemplateId: ""
        }
      }),
    /PDFMonkey document generation requires/
  );

  const gammaResult = await documentService.generateDocument({
    htmlContent: "<!DOCTYPE html><html><body><h1>Deck</h1></body></html>",
    filename: "deck.pptx",
    timeoutMs: 120000,
    credential: {
      toolCode: "document",
      secretId: "tool/document/gamma/api-key",
      providerId: "gamma"
    },
    providerOptions: {
      outputFormat: "pptx",
      presentationOptions: {
        textMode: "generate",
        numCards: 8,
        cardSplit: "auto",
        additionalInstructions: "Make it visual first.",
        textOptions: {
          amount: "brief",
          language: "en",
          tone: "professional",
          audience: "investors"
        },
        imageOptions: {
          source: "aiGenerated",
          style: "bold editorial",
          stylePreset: "custom"
        },
        cardOptions: {
          dimensions: "16x9"
        }
      }
    }
  });
  assert.equal(gammaResult.provider, "gamma");
  assert.equal(gammaResult.outputFormat, "pptx");
  assert.equal(gammaProviderClient.calls.length, 1);
  assert.deepEqual(gammaProviderClient.calls[0], {
    input: {
      htmlContent: "<!DOCTYPE html><html><body><h1>Deck</h1></body></html>",
      filename: "deck.pptx",
      timeoutMs: 120000,
      credential: {
        toolCode: "document",
        secretId: "tool/document/gamma/api-key",
        providerId: "gamma"
      },
      providerOptions: {
        outputFormat: "pptx",
        presentationOptions: {
          themeId: null,
          textMode: "generate",
          numCards: 8,
          cardSplit: "auto",
          additionalInstructions: "Make it visual first.",
          textOptions: {
            amount: "brief",
            language: "en",
            tone: "professional",
            audience: "investors"
          },
          imageOptions: {
            model: null,
            source: "aiGenerated",
            style: "bold editorial",
            stylePreset: "custom"
          },
          cardOptions: {
            dimensions: "16x9"
          }
        }
      }
    },
    apiKey: "resolved-tool-secret"
  });
}
