import assert from "node:assert/strict";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { ProviderVideoGenerationService } from "../src/modules/providers/provider-video-generation.service";
import type { KlingProviderClient } from "../src/modules/providers/kling/kling-provider.client";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";
import type { RunwayProviderClient } from "../src/modules/providers/runway/runway-provider.client";

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

class FakeRunwayProviderClient {
  calls: Array<{ input: ProviderGatewayVideoGenerateRequest; apiKey: string | undefined }> = [];

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "runway",
      model: input.model ?? "gen4.5",
      prompt: input.prompt,
      size: input.size,
      seconds: input.seconds,
      video: {
        bytesBase64: "cnVud2F5LXZpZGVvLWJ5dGVz",
        mimeType: "video/mp4"
      },
      respondedAt: "2026-06-01T15:00:00.000Z",
      usage: null,
      billingFacts: {
        providerKey: "runway",
        modelKey: input.model ?? "gen4.5",
        capability: "video",
        occurredAt: "2026-06-01T15:00:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: Number(input.seconds) * 1000,
          durationSeconds: Number(input.seconds)
        }
      },
      warning: null
    };
  }
}

class FakeKlingProviderClient {
  calls: Array<{
    input: ProviderGatewayVideoGenerateRequest;
    credentialValue: string | undefined;
  }> = [];

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { credentialValue?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.calls.push({ input, credentialValue: options?.credentialValue });
    return {
      provider: "kling",
      model: input.model ?? "kling-v1",
      prompt: input.prompt,
      size: input.size,
      seconds: input.seconds,
      video: {
        bytesBase64: "a2xpbmctdmlkZW8tYnl0ZXM=",
        mimeType: "video/mp4"
      },
      respondedAt: "2026-06-01T15:01:00.000Z",
      usage: null,
      billingFacts: {
        providerKey: "kling",
        modelKey: input.model ?? "kling-v1",
        capability: "video",
        occurredAt: "2026-06-01T15:01:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: Number(input.seconds) * 1000,
          durationSeconds: Number(input.seconds)
        }
      },
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
  const runwayProviderClient = new FakeRunwayProviderClient();
  const klingProviderClient = new FakeKlingProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderVideoGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    runwayProviderClient as unknown as RunwayProviderClient,
    klingProviderClient as unknown as KlingProviderClient,
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

  const runwayResult = await service.generateVideo({
    ...createRequest(),
    model: "gen4.5",
    credential: {
      ...createRequest().credential,
      secretId: "tool/video_generate/runway/api-key",
      providerId: "runway"
    }
  });
  assert.equal(runwayResult.provider, "runway");
  assert.equal(runwayProviderClient.calls[0]?.apiKey, "resolved-tool-secret");
  assert.equal(runwayProviderClient.calls[0]?.input.model, "gen4.5");

  const klingResult = await service.generateVideo({
    ...createRequest(),
    model: "kling-v1",
    credential: {
      ...createRequest().credential,
      secretId: "tool/video_generate/kling/api-key",
      providerId: "kling"
    }
  });
  assert.equal(klingResult.provider, "kling");
  assert.equal(klingProviderClient.calls[0]?.credentialValue, "resolved-tool-secret");
  assert.equal(klingProviderClient.calls[0]?.input.model, "kling-v1");

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
        model: "custom-video-model"
      }),
    /model must be one of.*OpenAI video generation/
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

  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/video_generate/runway/api-key",
    "tool/video_generate/kling/api-key"
  ]);
}
