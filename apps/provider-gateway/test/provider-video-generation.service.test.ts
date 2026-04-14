import assert from "node:assert/strict";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { ProviderVideoGenerationService } from "../src/modules/providers/provider-video-generation.service";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

function createRequest(options?: {
  includeReference?: boolean;
  model?: "sora-2" | "sora-2-pro" | null;
}): ProviderGatewayVideoGenerateRequest {
  return {
    prompt: "Animate a calm paper-cut forest at sunrise",
    model: options?.model ?? null,
    size: "1280x720",
    seconds: 4,
    referenceImage: options?.includeReference
      ? {
          bytesBase64: "cmVmLXZpZGVvLWltYWdl",
          mimeType: "image/png",
          filename: "forest.png"
        }
      : null,
    credential: {
      toolCode: "video_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

class FakeOpenAIProviderClient {
  calls: Array<{ input: ProviderGatewayVideoGenerateRequest; apiKey: string | undefined }> = [];

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "openai",
      model: "sora-2",
      prompt: input.prompt,
      size: input.size,
      seconds: input.seconds,
      video: {
        bytesBase64: "dmlkZW8tYnl0ZXM=",
        mimeType: "video/mp4"
      },
      respondedAt: "2026-04-14T12:00:00.000Z",
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

export async function runProviderVideoGenerationServiceTest(): Promise<void> {
  const openaiProviderClient = new FakeOpenAIProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderVideoGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );

  const result = await service.generateVideo(
    createRequest({ includeReference: true, model: "sora-2-pro" })
  );
  assert.equal(result.provider, "openai");
  assert.equal(result.video.mimeType, "video/mp4");
  assert.deepEqual(openaiProviderClient.calls[0], {
    input: createRequest({ includeReference: true, model: "sora-2-pro" }),
    apiKey: "resolved-tool-secret"
  });
  assert.deepEqual(persaiInternalApiClientService.secretIds, ["tool/image_generate/api-key"]);

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest(),
        seconds: 6 as never
      }),
    /seconds must be one of/
  );

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest(),
        model: "sora-3" as never
      }),
    /model must be one of/
  );

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest(),
        credential: {
          ...createRequest().credential,
          providerId: "browserless" as never
        }
      }),
    /supported video-generation provider/
  );

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest({ includeReference: true }),
        referenceImage: {
          ...createRequest({ includeReference: true }).referenceImage!,
          bytesBase64: ""
        }
      }),
    /referenceImage\.bytesBase64 must be a non-empty string/
  );
}
