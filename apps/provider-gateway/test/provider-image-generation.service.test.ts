import assert from "node:assert/strict";
import type {
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult
} from "@persai/runtime-contract";
import { ProviderImageGenerationService } from "../src/modules/providers/provider-image-generation.service";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

function createRequest(): ProviderGatewayImageGenerateRequest {
  return {
    prompt: "Generate a paper-cut forest scene",
    count: 2,
    size: "1024x1536",
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
    size: "1024x1024",
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

export async function runProviderImageGenerationServiceTest(): Promise<void> {
  const openaiProviderClient = new FakeOpenAIProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderImageGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
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
}
