import assert from "node:assert/strict";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult,
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult
} from "@persai/runtime-contract";
import {
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_EDIT_COUNT
} from "@persai/runtime-contract";
import { ProviderDocumentGenerationService } from "../src/modules/providers/provider-document-generation.service";
import type { GammaProviderClient } from "../src/modules/providers/gamma/gamma-provider.client";
import { ProviderImageGenerationService } from "../src/modules/providers/provider-image-generation.service";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

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
  count?: number;
}): ProviderGatewayImageEditRequest {
  return {
    prompt: "Replace the couch with a red chair",
    model: "gpt-image-2",
    count: options?.count ?? 1,
    size: "1024x1024",
    background: "opaque",
    timeoutMs: null,
    sourceImage: {
      bytesBase64: "cmVmLWltYWdl",
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImages: options?.includeReference
      ? [
          {
            bytesBase64: "cmVmLWNhci1pbWFnZQ==",
            mimeType: "image/png",
            filename: "red-car.png"
          }
        ]
      : null,
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

class FakeOpenAIProviderClient {
  calls: Array<{
    input: ProviderGatewayImageGenerateRequest;
    apiKey: string | undefined;
    reserveApiKey: string | null | undefined;
  }> = [];
  editCalls: Array<{
    input: ProviderGatewayImageEditRequest;
    apiKey: string | undefined;
    reserveApiKey: string | null | undefined;
  }> = [];

  async generateImage(
    input: ProviderGatewayImageGenerateRequest,
    options?: { apiKey?: string; reserveApiKey?: string | null }
  ): Promise<ProviderGatewayImageGenerateResult> {
    this.calls.push({
      input,
      apiKey: options?.apiKey,
      reserveApiKey: options?.reserveApiKey
    });
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
    options?: { apiKey?: string; reserveApiKey?: string | null }
  ): Promise<ProviderGatewayImageEditResult> {
    this.editCalls.push({
      input,
      apiKey: options?.apiKey,
      reserveApiKey: options?.reserveApiKey
    });
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
    return secretId.includes("/reserve/") ? "resolved-reserve-secret" : "resolved-tool-secret";
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
      secretId: "tool/document/gamma/api-key",
      providerId: "gamma"
    },
    providerOptions: {
      outputFormat: "pdf",
      presentationOptions: null
    }
  };
}

export async function runProviderImageGenerationServiceTest(): Promise<void> {
  const openaiProviderClient = new FakeOpenAIProviderClient();
  const gammaProviderClient = new FakeGammaProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderImageGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const documentService = new ProviderDocumentGenerationService(
    gammaProviderClient as unknown as GammaProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );

  const result = await service.generateImage(createRequest());
  assert.equal(result.provider, "openai");
  assert.equal(result.images.length, 1);
  assert.deepEqual(openaiProviderClient.calls[0], {
    input: {
      ...createRequest(),
      credential: {
        ...createRequest().credential,
        requestContext: null,
        reserveTransport: null
      }
    },
    apiKey: "resolved-tool-secret",
    reserveApiKey: null
  });
  assert.deepEqual(persaiInternalApiClientService.secretIds, ["tool/image_generate/api-key"]);

  const editResult = await service.editImage(createEditRequest({ includeReference: true }));
  assert.equal(editResult.provider, "openai");
  assert.equal(editResult.images.length, 1);
  assert.deepEqual(openaiProviderClient.editCalls[0], {
    input: {
      ...createEditRequest({ includeReference: true }),
      credential: {
        ...createEditRequest({ includeReference: true }).credential,
        requestContext: null,
        reserveTransport: null
      }
    },
    apiKey: "resolved-tool-secret",
    reserveApiKey: null
  });
  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/image_generate/api-key"
  ]);

  const reserveGenerateRequest: ProviderGatewayImageGenerateRequest = {
    ...createRequest(),
    credential: {
      ...createRequest().credential,
      requestContext: {
        workspaceId: "ws-1",
        runtimeRequestId: "req-1",
        runtimeSessionId: "session-1"
      },
      reserveTransport: {
        enabled: true,
        secretId: "tool/image_generate/reserve/api-key",
        baseUrl: "https://api.proxyapi.ru/openai/v1"
      }
    }
  };
  await service.generateImage(reserveGenerateRequest);
  const reserveGenerateCall = openaiProviderClient.calls.at(-1);
  assert.equal(
    reserveGenerateCall?.reserveApiKey,
    "resolved-reserve-secret",
    "reserve api key should be resolved when reserve transport is enabled"
  );
  assert.equal(
    reserveGenerateCall?.input.credential.reserveTransport?.baseUrl,
    "https://api.proxyapi.ru/openai/v1"
  );
  assert.deepEqual(persaiInternalApiClientService.secretIds.slice(-2), [
    "tool/image_generate/api-key",
    "tool/image_generate/reserve/api-key"
  ]);

  // DEFECT 1: normalizeEditInput must preserve count and forward it to the client
  const editResultMulti = await service.editImage(createEditRequest({ count: 3 }));
  assert.equal(editResultMulti.provider, "openai");
  const lastEditCall = openaiProviderClient.editCalls.at(-1);
  assert.equal(lastEditCall?.input.count, 3, "count must be forwarded to the provider client");

  // DEFECT 1: normalizeEditInput must reject out-of-range count
  await assert.rejects(
    () => service.editImage(createEditRequest({ count: 0 })),
    /count must be an integer between/
  );
  await assert.rejects(
    () =>
      service.editImage({
        ...createEditRequest(),
        count: MAX_RUNTIME_IMAGE_EDIT_COUNT + 1
      }),
    /count must be an integer between/
  );
  await assert.rejects(
    () =>
      service.editImage({
        ...createEditRequest(),
        count: 1.5
      }),
    /count must be an integer between/
  );
  assert.equal(MIN_RUNTIME_IMAGE_EDIT_COUNT, 1, "MIN_RUNTIME_IMAGE_EDIT_COUNT sanity check");

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
  assert.equal(documentResult.provider, "gamma");
  assert.equal(
    documentResult.mimeType,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
  assert.deepEqual(gammaProviderClient.calls[0], {
    input: createDocumentRequest(),
    apiKey: "resolved-tool-secret"
  });

  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/image_generate/api-key",
    "tool/image_generate/api-key",
    "tool/image_generate/reserve/api-key",
    "tool/image_generate/api-key",
    "tool/document/gamma/api-key"
  ]);

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
  assert.equal(gammaProviderClient.calls.length, 2);
  assert.deepEqual(gammaProviderClient.calls[1], {
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
