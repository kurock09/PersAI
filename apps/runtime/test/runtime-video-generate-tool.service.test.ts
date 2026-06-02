import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeAttachmentRef,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeVideoModelParameters,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { RuntimeVideoGenerateToolService } from "../src/modules/turns/runtime-video-generate-tool.service";
import type {
  ConsumeToolDailyLimitOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import type { PersaiMediaObjectStorageService } from "../src/modules/turns/persai-media-object-storage.service";
import {
  type ProviderGatewayClientService,
  ProviderGatewayHttpError
} from "../src/modules/turns/provider-gateway.client.service";

const KNOWLEDGE_ACCESS_CONFIG = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: [
    {
      toolCode: "video_generate",
      family: "media_generation",
      outcomeKind: "artifact_refs",
      timeoutMs: 600000,
      confirmationRule: "none",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    }
  ]
} satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act"],
  confirmationRequiredActions: ["act"]
} satisfies RuntimeBrowserConfig;

function createBundle(options?: {
  configured?: boolean;
  providerId?: "openai" | "runway" | "kling";
  secretId?: string;
  modelKey?: string;
  videoModelParameters?: RuntimeVideoModelParameters | null;
  videoVoiceCatalog?: {
    provider: "kling";
    fetchedAt: string;
    shortlist: Array<{
      voiceKey: string;
      providerVoiceId: string;
      displayName: string;
      locale: string | null;
      gender: "male" | "female" | "neutral" | "unknown";
      description: string | null;
      styleTags: string[];
    }>;
  } | null;
  fallbacks?: Array<{
    providerId: "openai" | "runway" | "kling";
    secretId: string;
    modelKey?: string;
    videoModelParameters?: RuntimeVideoModelParameters | null;
  }>;
}) {
  return compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Answer as a concise assistant.",
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "en-US",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: null
        },
        openai: {
          voice: "marin"
        }
      }
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "en-US",
      timezone: "UTC"
    },
    runtime: {
      runtimeAssignment: { tier: "paid_shared_restricted" },
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        }
      },
      runtimeProviderRouting: {
        schema: "persai.runtimeProviderRouting.v1",
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true,
          inactiveReason: null
        }
      },
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        telegramAutoSummarizeEnabled: true
      }
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      effectiveCapabilities: null,
      toolAvailability: null,
      memoryControl: null,
      tasksControl: null,
      toolCredentialRefs: {
        video_generate: {
          refKey: `persai:persai-runtime:${options?.secretId ?? "tool/image_generate/api-key"}`,
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: options?.secretId ?? "tool/image_generate/api-key"
          },
          configured: options?.configured ?? true,
          providerId: options?.providerId ?? "openai",
          ...(options?.modelKey ? { modelKey: options.modelKey } : {}),
          ...(options?.videoModelParameters
            ? { videoModelParameters: options.videoModelParameters }
            : {}),
          ...(options?.videoVoiceCatalog ? { videoVoiceCatalog: options.videoVoiceCatalog } : {}),
          ...(options?.fallbacks
            ? {
                fallbacks: options.fallbacks.map((fallback) => ({
                  refKey: `persai:persai-runtime:${fallback.secretId}`,
                  secretRef: {
                    source: "persai",
                    provider: "persai-runtime",
                    id: fallback.secretId
                  },
                  configured: true,
                  providerId: fallback.providerId,
                  ...(fallback.modelKey ? { modelKey: fallback.modelKey } : {}),
                  ...(fallback.videoModelParameters
                    ? { videoModelParameters: fallback.videoModelParameters }
                    : {})
                }))
              }
            : {})
        }
      },
      toolPolicies: [
        {
          toolCode: "video_generate",
          displayName: "Video Generate",
          description: "Generate a short video clip from text.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 5
        }
      ],
      quota: {
        planCode: "paid",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mentions_only",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "disabled",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      preview: "",
      welcome: ""
    }
  }).bundle;
}

const OPENAI_VIDEO_MODEL_PARAMETERS: RuntimeVideoModelParameters = {
  duration: {
    kind: "allowed_list" as const,
    values: [4, 8, 12]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280x720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720x1280" }
  ],
  referenceImageSupported: true,
  audioCapabilities: ["silent"],
  inputCapabilities: ["text", "single_reference_image"],
  providerParameters: null
};

const RUNWAY_VIDEO_MODEL_PARAMETERS: RuntimeVideoModelParameters = {
  duration: {
    kind: "allowed_list" as const,
    values: [5, 8, 10]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280:720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720:1280" }
  ],
  referenceImageSupported: true,
  audioCapabilities: ["silent"],
  inputCapabilities: ["text", "single_reference_image"],
  providerParameters: null
};

const RUNWAY_VEO31_VIDEO_MODEL_PARAMETERS: RuntimeVideoModelParameters = {
  duration: {
    kind: "allowed_list" as const,
    values: [4, 6, 8]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280:720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720:1280" }
  ],
  referenceImageSupported: true,
  audioCapabilities: ["silent", "provider_native_audio", "voice_control"],
  inputCapabilities: ["text", "single_reference_image"],
  providerParameters: null
};

const KLING_VIDEO_MODEL_PARAMETERS: RuntimeVideoModelParameters = {
  duration: {
    kind: "range" as const,
    min: 3,
    max: 15,
    step: null,
    preferredValues: [4, 8, 12]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "16:9" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "9:16" }
  ],
  referenceImageSupported: true,
  audioCapabilities: ["silent", "provider_native_audio", "voice_control"],
  inputCapabilities: ["text", "single_reference_image", "multi_image", "omni"],
  providerParameters: {
    mode: "pro",
    sound: "off" as const
  }
};

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-1",
    name: "video_generate",
    arguments: argumentsObject
  };
}

function createReferenceAttachment(
  aliases: string[] = ["current image #1", "current attachment #1"],
  options?: { objectKey?: string; filename?: string; attachmentId?: string }
): RuntimeAttachmentRef {
  return {
    attachmentId: options?.attachmentId ?? "attachment-1",
    kind: "image",
    objectKey: options?.objectKey ?? "media/reference-1.png",
    mimeType: "image/png",
    filename: options?.filename ?? "forest.png",
    sizeBytes: 10,
    aliases
  };
}

class FakeProviderGatewayClientService {
  videoCalls: Array<{
    input: ProviderGatewayVideoGenerateRequest;
    options?: { timeoutMs?: number };
  }> = [];
  failuresByProvider = new Map<string, Error>();

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.videoCalls.push(options === undefined ? { input } : { input, options });
    const providerId = input.credential.providerId ?? "openai";
    const failure = this.failuresByProvider.get(providerId);
    if (failure) {
      throw failure;
    }
    const resolvedModel =
      input.model ??
      (providerId === "runway" ? "gen4_turbo" : providerId === "kling" ? "kling-v3" : "sora-2");
    return {
      provider: providerId,
      model: resolvedModel,
      prompt: input.prompt,
      size: input.size,
      seconds: input.seconds,
      video: {
        bytesBase64: Buffer.from("video-binary").toString("base64"),
        mimeType: "video/mp4"
      },
      respondedAt: "2026-04-14T12:00:00.000Z",
      usage: {
        providerKey: providerId,
        modelKey: resolvedModel,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null
      },
      warning: null
    };
  }
}

class FakePersaiInternalApiClientService {
  dailyQuotaCalls: Array<{
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number | null;
    units?: number;
  }> = [];

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number | null;
    units?: number;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    this.dailyQuotaCalls.push(input);
    return {
      allowed: true,
      currentCount: 1,
      limit: input.dailyCallLimit
    };
  }
}

class FakePersaiMediaObjectStorageService {
  savedObjects: Array<{ objectKey: string; mimeType: string; sizeBytes: number }> = [];
  sourceObjects = new Map<string, Buffer>();

  buildRuntimeOutputObjectKey(input: { artifactId: string; extension: string | null }): string {
    return `runtime/${input.artifactId}.${input.extension ?? "bin"}`;
  }

  async saveObject(input: {
    objectKey: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ objectKey: string; mimeType: string; sizeBytes: number }> {
    const stored = {
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length
    };
    this.savedObjects.push(stored);
    return stored;
  }

  async downloadObject(objectKey: string): Promise<Buffer | null> {
    return this.sourceObjects.get(objectKey) ?? null;
  }
}

const fakeRuntimeAssistantFileRegistryService = {
  async ensureAttachmentBackedFile(input: {
    referenceId: string;
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: number;
  }) {
    return {
      fileRef: `file-${input.referenceId}`,
      origin: "runtime_output",
      sourceToolCode: null,
      objectKey: input.objectKey,
      relativePath: `artifacts/${input.referenceId}/${input.filename ?? "file"}`,
      displayName: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      logicalSizeBytes: input.sizeBytes
    };
  },
  toRuntimeFileRef(record: {
    fileRef: string;
    origin: "runtime_output";
    sourceToolCode: null;
    objectKey: string;
    relativePath: string;
    displayName: string | null;
    mimeType: string;
    sizeBytes: number;
    logicalSizeBytes: number;
  }) {
    return record;
  }
};

export async function runRuntimeVideoGenerateToolServiceTest(): Promise<void> {
  const providerGatewayClientService = new FakeProviderGatewayClientService();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const mediaObjectStorage = new FakePersaiMediaObjectStorageService();
  const service = new RuntimeVideoGenerateToolService(
    providerGatewayClientService as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as unknown as PersaiMediaObjectStorageService,
    fakeRuntimeAssistantFileRegistryService as never
  );

  const bundle = createBundle();
  bundle.governance.toolCredentialRefs.video_generate!.videoModelParameters =
    OPENAI_VIDEO_MODEL_PARAMETERS;
  const bundleWithProModel = createBundle({
    modelKey: "sora-2-pro",
    videoModelParameters: OPENAI_VIDEO_MODEL_PARAMETERS
  });
  const runwayBundle = createBundle({
    providerId: "runway",
    secretId: "tool/video_generate/runway/api-key",
    modelKey: "gen4_turbo",
    videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
  });
  const runwayVeoBundle = createBundle({
    providerId: "runway",
    secretId: "tool/video_generate/runway/api-key",
    modelKey: "veo3.1",
    videoModelParameters: RUNWAY_VEO31_VIDEO_MODEL_PARAMETERS
  });
  const klingBundle = createBundle({
    providerId: "kling",
    secretId: "tool/video_generate/kling/api-key",
    modelKey: "kling-v3",
    videoModelParameters: KLING_VIDEO_MODEL_PARAMETERS,
    videoVoiceCatalog: {
      provider: "kling",
      fetchedAt: "2026-06-02T12:00:00.000Z",
      shortlist: [
        {
          voiceKey: "owen",
          providerVoiceId: "voice-1",
          displayName: "Owen",
          locale: "en",
          gender: "male",
          description: "en | calm, narrator",
          styleTags: ["calm", "narrator"]
        }
      ]
    }
  });
  const fallbackBundle = createBundle({
    providerId: "runway",
    secretId: "tool/video_generate/runway/api-key",
    modelKey: "gen4_turbo",
    videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS,
    fallbacks: [
      {
        providerId: "kling",
        secretId: "tool/video_generate/kling/api-key",
        modelKey: "kling-v3",
        videoModelParameters: KLING_VIDEO_MODEL_PARAMETERS
      }
    ]
  });
  const klingToRunwayFallbackBundle = createBundle({
    providerId: "kling",
    secretId: "tool/video_generate/kling/api-key",
    modelKey: "kling-v3",
    videoModelParameters: KLING_VIDEO_MODEL_PARAMETERS,
    fallbacks: [
      {
        providerId: "runway",
        secretId: "tool/video_generate/runway/api-key",
        modelKey: "gen4.5",
        videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
      }
    ]
  });
  const projection = projectRuntimeNativeTools(bundle);
  assert.equal(
    projection.tools.some((tool) => tool.name === "video_generate"),
    true
  );

  const hiddenProjection = projectRuntimeNativeTools(createBundle({ configured: false }));
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "video_generate"),
    false
  );

  const proModelResult = await service.executeToolCall({
    bundle: bundleWithProModel,
    toolCall: createToolCall({
      prompt: "Animate a premium cinematic forest sunrise",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-0"
  });
  assert.equal(proModelResult.payload.action, "generated");
  assert.equal(proModelResult.payload.model, "sora-2-pro");
  assert.equal(providerGatewayClientService.videoCalls[0]?.input.model, "sora-2-pro");

  const promptOnlyResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate a calm paper-cut forest at sunrise",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-1"
  });
  assert.equal(promptOnlyResult.payload.action, "generated");
  assert.equal(promptOnlyResult.payload.provider, "openai");
  assert.equal(promptOnlyResult.payload.referenceImageAlias, null);
  assert.equal(promptOnlyResult.payload.artifact?.kind, "video");
  assert.equal(promptOnlyResult.artifacts.length, 1);
  assert.deepEqual(providerGatewayClientService.videoCalls[0], {
    input: {
      prompt: "Animate a premium cinematic forest sunrise",
      model: "sora-2-pro",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/image_generate/api-key",
        providerId: "openai"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });
  assert.deepEqual(providerGatewayClientService.videoCalls[1], {
    input: {
      prompt: "Animate a calm paper-cut forest at sunrise",
      model: null,
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/image_generate/api-key",
        providerId: "openai"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  mediaObjectStorage.sourceObjects.set(
    "media/reference-1.png",
    Buffer.from("reference-image-binary")
  );
  mediaObjectStorage.sourceObjects.set(
    "media/reference-2.png",
    Buffer.from("reference-image-binary-2")
  );
  const referenceResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate the attached image into a calm sunrise clip",
      referenceImageAlias: "current image #1",
      seconds: 8
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-2"
  });
  assert.equal(referenceResult.payload.action, "generated");
  assert.equal(referenceResult.payload.referenceImageAlias, "current image #1");
  assert.equal(referenceResult.payload.referenceFilename, "forest.png");
  assert.equal(referenceResult.payload.artifact?.filename, "forest-video.mp4");
  assert.equal(referenceResult.payload.model, "sora-2");
  assert.equal(
    providerGatewayClientService.videoCalls[2]?.input.referenceImage?.mimeType,
    "image/png"
  );
  assert.equal(
    providerGatewayClientService.videoCalls[2]?.input.referenceImage?.bytesBase64,
    Buffer.from("reference-image-binary").toString("base64")
  );
  assert.equal(providerGatewayClientService.videoCalls[2]?.input.referenceTailImage, null);
  assert.equal(providerGatewayClientService.videoCalls[2]?.input.voiceIds, null);

  const runwayResult = await service.executeToolCall({
    bundle: runwayBundle,
    toolCall: createToolCall({
      prompt: "Create a glossy product teaser video",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2c"
  });
  assert.equal(runwayResult.payload.action, "generated");
  assert.equal(runwayResult.payload.provider, "runway");
  assert.equal(runwayResult.payload.model, "gen4_turbo");
  assert.equal(runwayResult.payload.requestedSeconds, 5);
  assert.match(
    runwayResult.payload.warning ?? "",
    /Adjusted requested video duration from 4s to 5s/i
  );
  assert.deepEqual(providerGatewayClientService.videoCalls[3], {
    input: {
      prompt: "Create a glossy product teaser video",
      model: "gen4_turbo",
      size: "1280x720",
      seconds: 5,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/runway/api-key",
        providerId: "runway"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const klingResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: "Create an anime-style city flythrough",
      seconds: 4,
      size: "720x1280"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2d"
  });
  assert.equal(klingResult.payload.action, "generated");
  assert.equal(klingResult.payload.provider, "kling");
  assert.equal(klingResult.payload.model, "kling-v3");
  assert.deepEqual(providerGatewayClientService.videoCalls[4], {
    input: {
      prompt: "Create an anime-style city flythrough",
      model: "kling-v3",
      size: "720x1280",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "off"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const klingNativeAudioResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: "Create a rainy neon alley video with natural ambient sound",
      audioMode: "provider_native_audio",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2da"
  });
  assert.equal(klingNativeAudioResult.payload.action, "generated");
  assert.equal(klingNativeAudioResult.payload.provider, "kling");
  assert.equal(klingNativeAudioResult.payload.requestedAudioMode, "provider_native_audio");
  assert.deepEqual(providerGatewayClientService.videoCalls[5], {
    input: {
      prompt: "Create a rainy neon alley video with natural ambient sound",
      model: "kling-v3",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "on"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  providerGatewayClientService.failuresByProvider.set(
    "runway",
    new Error("Runway returned a terminal provider failure.")
  );
  const fallbackResult = await service.executeToolCall({
    bundle: fallbackBundle,
    toolCall: createToolCall({
      prompt: "Create a moody noir trailer shot",
      seconds: 8,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2e"
  });
  providerGatewayClientService.failuresByProvider.delete("runway");
  assert.equal(fallbackResult.payload.action, "generated");
  assert.equal(fallbackResult.payload.provider, "kling");
  assert.equal(fallbackResult.payload.model, "kling-v3");
  assert.match(fallbackResult.payload.warning ?? "", /runway failed/i);
  assert.match(fallbackResult.payload.warning ?? "", /Used fallback provider "kling"/i);
  assert.deepEqual(providerGatewayClientService.videoCalls[6], {
    input: {
      prompt: "Create a moody noir trailer shot",
      model: "gen4_turbo",
      size: "1280x720",
      seconds: 8,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/runway/api-key",
        providerId: "runway"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });
  assert.deepEqual(providerGatewayClientService.videoCalls[7], {
    input: {
      prompt: "Create a moody noir trailer shot",
      model: "kling-v3",
      size: "1280x720",
      seconds: 8,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "off"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  providerGatewayClientService.failuresByProvider.set(
    "kling",
    new ProviderGatewayHttpError(500, "Kling video generation request failed with status 500.")
  );
  const httpFallbackResult = await service.executeToolCall({
    bundle: klingToRunwayFallbackBundle,
    toolCall: createToolCall({
      prompt: "Create a cinematic city shot from this reference",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2f"
  });
  providerGatewayClientService.failuresByProvider.delete("kling");
  assert.equal(httpFallbackResult.payload.action, "generated");
  assert.equal(httpFallbackResult.payload.provider, "runway");
  assert.equal(httpFallbackResult.payload.model, "gen4.5");
  assert.match(httpFallbackResult.payload.warning ?? "", /kling failed/i);
  assert.match(httpFallbackResult.payload.warning ?? "", /Used fallback provider "runway"/i);
  assert.deepEqual(providerGatewayClientService.videoCalls[8], {
    input: {
      prompt: "Create a cinematic city shot from this reference",
      model: "kling-v3",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "off"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });
  assert.deepEqual(providerGatewayClientService.videoCalls[9], {
    input: {
      prompt: "Create a cinematic city shot from this reference",
      model: "gen4.5",
      size: "1280x720",
      seconds: 5,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/runway/api-key",
        providerId: "runway"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  providerGatewayClientService.failuresByProvider.set(
    "kling",
    new ServiceUnavailableException({
      error: {
        code: "accepted_primary_unconfirmed",
        message:
          "Provider task was accepted, but polling continuity was lost before terminal status.",
        providerStatus: {
          providerTaskId: "task_kling_accepted_1",
          provider: "kling",
          model: "kling-v3",
          acceptedAt: "2026-06-02T12:00:00.000Z",
          providerStage: "accepted"
        }
      }
    })
  );
  const acceptedPrimaryUnconfirmedResult = await service.executeToolCall({
    bundle: klingToRunwayFallbackBundle,
    toolCall: createToolCall({
      prompt: "Create a cinematic city shot with no duplicate billing",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2f-accepted-unconfirmed"
  });
  providerGatewayClientService.failuresByProvider.delete("kling");
  assert.equal(acceptedPrimaryUnconfirmedResult.payload.action, "skipped");
  assert.equal(acceptedPrimaryUnconfirmedResult.payload.reason, "accepted_primary_unconfirmed");
  assert.equal(acceptedPrimaryUnconfirmedResult.isError, true);
  assert.equal(providerGatewayClientService.videoCalls.length, 11);
  assert.match(
    acceptedPrimaryUnconfirmedResult.payload.warning ?? "",
    /Fallback is forbidden until provider terminal status is confirmed/i
  );
  assert.equal(
    (
      acceptedPrimaryUnconfirmedResult.payload.providerStatus as
        | { providerTaskId?: string }
        | undefined
    )?.providerTaskId,
    "task_kling_accepted_1"
  );

  const promptOnlyReferenceTextResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate this reference image into a short sunrise clip",
      seconds: 4
    }),
    availableAttachments: [
      createReferenceAttachment(["last generated image", "previous image #1"])
    ],
    sessionId: "session-1",
    requestId: "request-2b"
  });
  assert.equal(promptOnlyReferenceTextResult.payload.action, "generated");
  assert.equal(promptOnlyReferenceTextResult.payload.referenceImageAlias, null);
  assert.equal(promptOnlyReferenceTextResult.payload.referenceFilename, null);
  assert.equal(providerGatewayClientService.videoCalls[10]?.input.referenceImage, null);
  assert.equal(providerGatewayClientService.videoCalls[10]?.input.referenceTailImage, null);
  assert.equal(providerGatewayClientService.videoCalls[10]?.input.voiceIds, null);
  assert.equal(providerGatewayClientService.videoCalls[10]?.input.size, "1280x720");

  const nativeAudioUnsupported = await service.executeToolCall({
    bundle: runwayBundle,
    toolCall: createToolCall({
      prompt: "Create a teaser with natural ambient sound",
      audioMode: "provider_native_audio",
      seconds: 5
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-audio-unsupported"
  });
  assert.equal(nativeAudioUnsupported.payload.action, "skipped");
  assert.equal(nativeAudioUnsupported.payload.reason, "requested_mode_unsupported");
  assert.match(
    nativeAudioUnsupported.payload.warning ?? "",
    /does not support provider-native audio/i
  );

  const runwayVeoNativeAudioResult = await service.executeToolCall({
    bundle: runwayVeoBundle,
    toolCall: createToolCall({
      prompt: "Create a stormy coastline video with natural wave audio",
      audioMode: "provider_native_audio",
      referenceImageAlias: "current image #1",
      seconds: 4
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-runway-veo-audio"
  });
  assert.equal(runwayVeoNativeAudioResult.payload.action, "generated");
  assert.equal(runwayVeoNativeAudioResult.payload.provider, "runway");
  assert.equal(runwayVeoNativeAudioResult.payload.requestedAudioMode, "provider_native_audio");
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1), {
    input: {
      prompt: "Create a stormy coastline video with natural wave audio",
      model: "veo3.1",
      size: "1280x720",
      seconds: 4,
      referenceImage: {
        bytesBase64: Buffer.from("reference-image-binary").toString("base64"),
        mimeType: "image/png",
        filename: "forest.png"
      },
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        audio: true
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/runway/api-key",
        providerId: "runway"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const runwayVeoTextNativeAudioResult = await service.executeToolCall({
    bundle: runwayVeoBundle,
    toolCall: createToolCall({
      prompt: "Create a thunderstorm teaser with natural thunder audio",
      audioMode: "provider_native_audio",
      seconds: 4
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-runway-veo-text-audio"
  });
  assert.equal(runwayVeoTextNativeAudioResult.payload.action, "generated");
  assert.equal(runwayVeoTextNativeAudioResult.payload.provider, "runway");
  assert.equal(runwayVeoTextNativeAudioResult.payload.requestedAudioMode, "provider_native_audio");
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1), {
    input: {
      prompt: "Create a thunderstorm teaser with natural thunder audio",
      model: "veo3.1",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        audio: true
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/runway/api-key",
        providerId: "runway"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const voiceControlMissingVoiceUnsupported = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: "Create a narrated product video with spoken voice-over",
      audioMode: "voice_control",
      seconds: 4
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-voice-unsupported"
  });
  assert.equal(voiceControlMissingVoiceUnsupported.payload.action, "skipped");
  assert.equal(voiceControlMissingVoiceUnsupported.payload.reason, "requested_mode_unsupported");
  assert.match(
    voiceControlMissingVoiceUnsupported.payload.warning ?? "",
    /requires explicit voice/i
  );

  const multiImageUnsupported = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Blend these two images into one cinematic video",
      inputMode: "multi_image",
      referenceImageAliases: ["current image #1", "current image #2"],
      seconds: 4
    }),
    availableAttachments: [
      createReferenceAttachment(["current image #1"]),
      createReferenceAttachment(["current image #2"])
    ],
    sessionId: "session-1",
    requestId: "request-multi-image-unsupported"
  });
  assert.equal(multiImageUnsupported.payload.action, "skipped");
  assert.equal(multiImageUnsupported.payload.reason, "requested_mode_unsupported");
  assert.match(
    multiImageUnsupported.payload.warning ?? "",
    /does not support multi-image video input/i
  );

  const klingVoiceControlResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: 'A presenter<<<voice_1>>> says: "Welcome to the launch."',
      referenceImageAlias: "current image #1",
      audioMode: "voice_control",
      seconds: 4,
      voiceIds: ["voice-1"]
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-voice-control-success"
  });
  assert.equal(klingVoiceControlResult.payload.action, "generated");
  assert.equal(klingVoiceControlResult.payload.requestedAudioMode, "voice_control");
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1), {
    input: {
      prompt: 'A presenter<<<voice_1>>> says: "Welcome to the launch."',
      model: "kling-v3",
      size: "1280x720",
      seconds: 4,
      referenceImage: {
        bytesBase64: Buffer.from("reference-image-binary").toString("base64"),
        mimeType: "image/png",
        filename: "forest.png"
      },
      referenceTailImage: null,
      voiceIds: ["voice-1"],
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "off"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const klingPromptOnlyVoiceControlResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: 'A presenter<<<voice_1>>> says: "Welcome to the launch."',
      audioMode: "voice_control",
      seconds: 4,
      voiceKeys: ["owen"]
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-prompt-only-voice-control-success"
  });
  assert.equal(klingPromptOnlyVoiceControlResult.payload.action, "generated");
  assert.equal(klingPromptOnlyVoiceControlResult.payload.referenceImageAlias, null);
  assert.equal(providerGatewayClientService.videoCalls.at(-1)?.input.referenceImage, null);
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1)?.input.voiceIds, ["voice-1"]);

  const klingVoiceKeyResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: 'A presenter<<<voice_1>>> says: "This is the keynote opening."',
      referenceImageAlias: "current image #1",
      audioMode: "voice_control",
      seconds: 4,
      voiceKeys: ["owen"]
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-voice-key-success"
  });
  assert.equal(klingVoiceKeyResult.payload.action, "generated");
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1)?.input.voiceIds, ["voice-1"]);

  const klingTwoImageResult = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: "Transition from the first product photo into the second lifestyle shot",
      inputMode: "multi_image",
      referenceImageAliases: ["current image #1", "current image #2"],
      seconds: 4
    }),
    availableAttachments: [
      createReferenceAttachment(["current image #1"], {
        objectKey: "media/reference-1.png",
        filename: "forest.png",
        attachmentId: "attachment-1"
      }),
      createReferenceAttachment(["current image #2"], {
        objectKey: "media/reference-2.png",
        filename: "forest-2.png",
        attachmentId: "attachment-2"
      })
    ],
    sessionId: "session-1",
    requestId: "request-kling-two-image"
  });
  assert.equal(klingTwoImageResult.payload.action, "generated");
  assert.equal(klingTwoImageResult.payload.requestedInputMode, "multi_image");
  assert.deepEqual(providerGatewayClientService.videoCalls.at(-1), {
    input: {
      prompt: "Transition from the first product photo into the second lifestyle shot",
      model: "kling-v3",
      size: "1280x720",
      seconds: 4,
      referenceImage: {
        bytesBase64: Buffer.from("reference-image-binary").toString("base64"),
        mimeType: "image/png",
        filename: "forest.png"
      },
      referenceTailImage: {
        bytesBase64: Buffer.from("reference-image-binary-2").toString("base64"),
        mimeType: "image/png",
        filename: "forest-2.png"
      },
      voiceIds: null,
      acceptedTask: null,
      providerParameters: {
        mode: "pro",
        sound: "off"
      },
      credential: {
        toolCode: "video_generate",
        secretId: "tool/video_generate/kling/api-key",
        providerId: "kling"
      }
    },
    options: {
      timeoutMs: 600000
    }
  });

  const omniUnsupported = await service.executeToolCall({
    bundle: klingBundle,
    toolCall: createToolCall({
      prompt: "Use omni mode to combine rich inputs into a video",
      inputMode: "omni",
      seconds: 4
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-omni-unsupported"
  });
  assert.equal(omniUnsupported.payload.action, "skipped");
  assert.equal(omniUnsupported.payload.reason, "requested_mode_unsupported");
  assert.match(omniUnsupported.payload.warning ?? "", /Omni video requests are deferred/i);

  const normalized = await service.executeToolCall({
    bundle: runwayBundle,
    toolCall: createToolCall({
      prompt: "Animate this",
      seconds: 6
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-3"
  });
  assert.equal(normalized.payload.action, "generated");
  assert.equal(normalized.payload.requestedSeconds, 5);
  assert.equal(normalized.payload.size, "1280x720");
  assert.match(
    normalized.payload.warning ?? "",
    /Adjusted requested video duration from 6s to 5s/i
  );
  assert.match(normalized.payload.warning ?? "", /Used default video size 1280x720/i);
  assert.equal(providerGatewayClientService.videoCalls.at(-1)?.input.seconds, 5);
  assert.equal(providerGatewayClientService.videoCalls.at(-1)?.input.size, "1280x720");
}
