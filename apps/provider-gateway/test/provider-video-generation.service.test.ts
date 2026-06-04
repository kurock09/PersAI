import assert from "node:assert/strict";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { ProviderVideoGenerationService } from "../src/modules/providers/provider-video-generation.service";
import type { HeyGenProviderClient } from "../src/modules/providers/heygen/heygen-provider.client";
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
    },
    providerParameters: null
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
      model: input.model ?? "kling-v3",
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
        modelKey: input.model ?? "kling-v3",
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

class FakeHeyGenProviderClient {
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
      provider: "heygen",
      model: input.model ?? "heygen-photo-avatar-v3",
      prompt: input.prompt,
      size: input.size,
      seconds: 8.5,
      video: {
        bytesBase64: "aGV5Z2VuLXZpZGVvLWJ5dGVz",
        mimeType: "video/mp4"
      },
      respondedAt: "2026-06-05T00:00:00.000Z",
      usage: null,
      billingFacts: {
        providerKey: "heygen",
        modelKey: input.model ?? "heygen-photo-avatar-v3",
        capability: "video",
        occurredAt: "2026-06-05T00:00:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: 8500,
          durationSeconds: 8.5
        }
      },
      warning: null,
      lazyCreatedHeygenAvatarId: null
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
  const heyGenProviderClient = new FakeHeyGenProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderVideoGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    runwayProviderClient as unknown as RunwayProviderClient,
    klingProviderClient as unknown as KlingProviderClient,
    heyGenProviderClient as unknown as HeyGenProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );

  const result = await service.generateVideo(
    createRequest({ includeReference: true, model: "sora-2-pro" })
  );
  assert.equal(result.provider, "openai");
  assert.equal(result.video.mimeType, "video/mp4");
  assert.deepEqual(openaiProviderClient.calls[0], {
    input: {
      ...createRequest({ includeReference: true, model: "sora-2-pro" }),
      acceptedTask: null,
      referenceTailImage: null,
      voiceIds: null
    },
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
    model: "kling-v3",
    referenceTailImage: {
      bytesBase64: "tail-image",
      mimeType: "image/png",
      filename: "forest-end.png"
    },
    voiceIds: ["voice-1"],
    providerParameters: { mode: "pro", sound: "off" },
    credential: {
      ...createRequest().credential,
      secretId: "tool/video_generate/kling/api-key",
      providerId: "kling"
    }
  });
  assert.equal(klingResult.provider, "kling");
  assert.equal(klingProviderClient.calls[0]?.credentialValue, "resolved-tool-secret");
  assert.equal(klingProviderClient.calls[0]?.input.model, "kling-v3");
  assert.deepEqual(klingProviderClient.calls[0]?.input.referenceTailImage, {
    bytesBase64: "tail-image",
    mimeType: "image/png",
    filename: "forest-end.png"
  });
  assert.deepEqual(klingProviderClient.calls[0]?.input.voiceIds, ["voice-1"]);
  assert.deepEqual(klingProviderClient.calls[0]?.input.providerParameters, {
    mode: "pro",
    sound: "off"
  });

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest(),
        seconds: 0
      }),
    /seconds must be a positive integer/
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

  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest(),
        voiceIds: [""]
      }),
    /voiceIds must contain only non-empty strings/
  );

  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/image_generate/api-key",
    "tool/video_generate/runway/api-key",
    "tool/video_generate/kling/api-key"
  ]);

  class ThrowingKlingProviderClient extends FakeKlingProviderClient {
    override async generateVideo(): Promise<ProviderGatewayVideoGenerateResult> {
      throw new Error(
        'PERSAI_VIDEO_POLLING_LOST::{"providerTaskId":"task_kling_accepted_1","provider":"kling","model":"kling-v3","providerStage":"accepted","acceptedAt":"2026-06-02T12:00:00.000Z","code":"accepted_primary_unconfirmed","reason":"provider accepted but polling transport lost","message":"fetch failed","taskKind":"image2video"}'
      );
    }
  }

  const pollingLossService = new ProviderVideoGenerationService(
    openaiProviderClient as unknown as OpenAIProviderClient,
    runwayProviderClient as unknown as RunwayProviderClient,
    new ThrowingKlingProviderClient() as unknown as KlingProviderClient,
    heyGenProviderClient as unknown as HeyGenProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  await assert.rejects(
    () =>
      pollingLossService.generateVideo({
        ...createRequest(),
        model: "kling-v3",
        credential: {
          ...createRequest().credential,
          secretId: "tool/video_generate/kling/api-key",
          providerId: "kling"
        }
      }),
    /accepted_primary_unconfirmed/i
  );

  // ADR-109 Slice 3: structurally accept talking-avatar fields and pass them
  // through to the provider client. Slice 6 will wire them into HeyGen's HTTP
  // surface; today the gateway just forwards them faithfully without coercing
  // cinematic-only requests to carry empty fields.
  const talkingAvatarPassThroughCalls = openaiProviderClient.calls.length;
  const talkingAvatarPassThrough = await service.generateVideo({
    ...createRequest({ model: "sora-2-pro" }),
    mode: "talking_avatar",
    speechText: "Welcome to PersAI.",
    speechLanguage: "en-US",
    personaId: "persona-anya",
    portraitImageAlias: null,
    voiceKey: "anya-warm"
  });
  assert.equal(talkingAvatarPassThrough.provider, "openai");
  const talkingAvatarPassThroughInput =
    openaiProviderClient.calls[talkingAvatarPassThroughCalls]?.input;
  assert.equal(talkingAvatarPassThroughInput?.mode, "talking_avatar");
  assert.equal(talkingAvatarPassThroughInput?.speechText, "Welcome to PersAI.");
  assert.equal(talkingAvatarPassThroughInput?.speechLanguage, "en-US");
  assert.equal(talkingAvatarPassThroughInput?.personaId, "persona-anya");
  assert.equal(talkingAvatarPassThroughInput?.portraitImageAlias, null);
  assert.equal(talkingAvatarPassThroughInput?.voiceKey, "anya-warm");

  // ADR-109 Slice 3: cinematic / unspecified mode must NOT inject talking-avatar
  // keys into the normalized payload. This protects existing pass-through tests
  // and confirms the gateway does not silently add talking-avatar surface where
  // none was requested.
  const cinematicPassThroughCalls = openaiProviderClient.calls.length;
  await service.generateVideo({
    ...createRequest({ model: "sora-2-pro" }),
    mode: "cinematic"
  });
  const cinematicPassThroughInput = openaiProviderClient.calls[cinematicPassThroughCalls]?.input;
  assert.equal(cinematicPassThroughInput?.mode, "cinematic");
  assert.equal(
    Object.prototype.hasOwnProperty.call(cinematicPassThroughInput ?? {}, "speechText"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(cinematicPassThroughInput ?? {}, "personaId"),
    false
  );

  // ADR-109 Slice 3: defensive type checks. Hostile mode / non-string speechText
  // must surface as honest 400s, not silently coerce.
  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest({ model: "sora-2-pro" }),
        mode: "talking_garbage" as never
      }),
    /mode must be one of/i
  );
  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest({ model: "sora-2-pro" }),
        speechText: 123 as never
      }),
    /speechText must be a non-empty string or null/i
  );

  // ADR-109 Slice 6: HeyGen dispatch routes to HeyGenProviderClient.
  const heyGenResult = await service.generateVideo({
    ...createRequest({ model: null }),
    mode: "talking_avatar",
    speechText: "Welcome to PersAI.",
    speechLanguage: "en-US",
    personaId: "persona-anya",
    voiceKey: "voice-ru-female-1",
    cachedHeygenAvatarId: "ava-cached-123",
    credential: {
      ...createRequest().credential,
      secretId: "tool/video_generate/heygen/api-key",
      providerId: "heygen"
    }
  });
  assert.equal(heyGenResult.provider, "heygen");
  assert.equal(heyGenProviderClient.calls[0]?.credentialValue, "resolved-tool-secret");
  assert.equal(heyGenProviderClient.calls[0]?.input.mode, "talking_avatar");
  assert.equal(heyGenProviderClient.calls[0]?.input.speechText, "Welcome to PersAI.");
  assert.equal(heyGenProviderClient.calls[0]?.input.personaId, "persona-anya");
  assert.equal(heyGenProviderClient.calls[0]?.input.voiceKey, "voice-ru-female-1");
  assert.equal(heyGenProviderClient.calls[0]?.input.cachedHeygenAvatarId, "ava-cached-123");

  // ADR-109 Slice 6: normalizeInput accepts and forwards new HeyGen fields.
  const heyGenWithPortraitResult = await service.generateVideo({
    ...createRequest({ model: null }),
    mode: "talking_avatar",
    speechText: "Welcome.",
    personaId: null,
    cachedHeygenAvatarId: null,
    portraitImageBytesBase64: "cG9ydHJhaXQ=",
    portraitImageMimeType: "image/jpeg",
    credential: {
      ...createRequest().credential,
      secretId: "tool/video_generate/heygen/api-key",
      providerId: "heygen"
    }
  });
  assert.equal(heyGenWithPortraitResult.provider, "heygen");
  assert.equal(heyGenProviderClient.calls[1]?.input.portraitImageBytesBase64, "cG9ydHJhaXQ=");
  assert.equal(heyGenProviderClient.calls[1]?.input.portraitImageMimeType, "image/jpeg");
  assert.equal(heyGenProviderClient.calls[1]?.input.cachedHeygenAvatarId, null);

  // ADR-109 Slice 6: normalizeInput rejects non-string values for new HeyGen fields.
  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest({ model: null }),
        mode: "talking_avatar",
        cachedHeygenAvatarId: 123 as never,
        credential: {
          ...createRequest().credential,
          secretId: "tool/video_generate/heygen/api-key",
          providerId: "heygen"
        }
      }),
    /cachedHeygenAvatarId must be a non-empty string or null/i
  );
  await assert.rejects(
    () =>
      service.generateVideo({
        ...createRequest({ model: null }),
        mode: "talking_avatar",
        portraitImageBytesBase64: 456 as never,
        credential: {
          ...createRequest().credential,
          secretId: "tool/video_generate/heygen/api-key",
          providerId: "heygen"
        }
      }),
    /portraitImageBytesBase64 must be a non-empty string or null/i
  );
}
