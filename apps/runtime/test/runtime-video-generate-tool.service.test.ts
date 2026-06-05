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
  providerId?: "openai" | "runway" | "kling" | "heygen";
  secretId?: string;
  modelKey?: string;
  videoModelParameters?: RuntimeVideoModelParameters | null;
  videoVoiceCatalog?: {
    provider: "kling" | "heygen";
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
  // ADR-109 Slice 10c: when true, also add a video_generate_talking_avatar
  // credential ref mirroring the primary HeyGen ref. Required for talking_avatar
  // execution tests since Fix #3e routes mode=talking_avatar through the separate key.
  includeTalkingAvatarRef?: boolean;
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
        },
        // ADR-109 Slice 10c: separate talking-avatar credential ref. Present only when
        // includeTalkingAvatarRef=true. Mirrors the HeyGen primary ref so talking_avatar
        // execution tests can proceed past the new credential gate (Fix #3e).
        ...(options?.includeTalkingAvatarRef
          ? {
              video_generate_talking_avatar: {
                refKey: `persai:persai-runtime:${options?.secretId ?? "tool/image_generate/api-key"}`,
                secretRef: {
                  source: "persai",
                  provider: "persai-runtime",
                  id: options?.secretId ?? "tool/image_generate/api-key"
                },
                configured: true,
                providerId: options?.providerId ?? "heygen",
                ...(options?.modelKey ? { modelKey: options.modelKey } : {}),
                ...(options?.videoModelParameters
                  ? { videoModelParameters: options.videoModelParameters }
                  : {}),
                ...(options?.videoVoiceCatalog
                  ? { videoVoiceCatalog: options.videoVoiceCatalog }
                  : {})
              }
            }
          : {})
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

const HEYGEN_VIDEO_MODEL_PARAMETERS: RuntimeVideoModelParameters = {
  duration: {
    kind: "allowed_list" as const,
    values: [15, 30, 60]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280x720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720x1280" }
  ],
  referenceImageSupported: false,
  audioCapabilities: ["silent"],
  inputCapabilities: ["text"],
  providerParameters: {
    resolution: "720p",
    aspectRatio: "9:16",
    engine: "avatar_v"
  }
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

type FakePersona = {
  id: string;
  displayName: string;
  heygenAvatarId: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  portraitImageStorageKey: string;
};

class FakePersaiInternalApiClientService {
  dailyQuotaCalls: Array<{
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number | null;
    units?: number;
  }> = [];

  // Maps "workspaceId:personaId" → FakePersona (or null to simulate not-found).
  personaMap = new Map<string, FakePersona | null>();
  personaFetchError: Error | null = null;

  // ADR-109 Slice 10d: capture enqueue calls so tests can verify the
  // talking-avatar deferred-media-job path. Set `enqueueOverride` to inject
  // a rejection outcome for the "enqueue refused" branch.
  enqueueCalls: Array<{
    assistantId: string;
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    requestMode: string | null;
    toolCode: string;
  }> = [];
  enqueueOverride: {
    accepted: false;
    code: string;
    message: string;
    guidance: string | null;
  } | null = null;
  enqueueThrow: Error | null = null;
  nextJobId = "media-job-test-1";

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

  async fetchWorkspaceVideoPersona(input: {
    workspaceId: string;
    personaId: string;
  }): Promise<FakePersona | null> {
    if (this.personaFetchError !== null) {
      throw this.personaFetchError;
    }
    return this.personaMap.get(`${input.workspaceId}:${input.personaId}`) ?? null;
  }

  async enqueueDeferredMediaJob(input: {
    assistantId: string;
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    attachments: unknown[];
    directToolExecution: {
      toolCode: string;
      request: { mode?: string };
    };
  }): Promise<
    | { accepted: true; jobId: string; kind: "image" | "video" }
    | { accepted: false; code: string; message: string; guidance: string | null }
  > {
    if (this.enqueueThrow !== null) {
      throw this.enqueueThrow;
    }
    this.enqueueCalls.push({
      assistantId: input.assistantId,
      sourceUserMessageId: input.sourceUserMessageId,
      sourceUserMessageText: input.sourceUserMessageText,
      requestMode: input.directToolExecution.request.mode ?? null,
      toolCode: input.directToolExecution.toolCode
    });
    if (this.enqueueOverride !== null) {
      return this.enqueueOverride;
    }
    return { accepted: true, jobId: this.nextJobId, kind: "video" };
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
  // ADR-109 Slice 7: HeyGen bundle for talking_avatar execution tests.
  // includeTalkingAvatarRef=true adds video_generate_talking_avatar credential so
  // Fix #3e (Slice 10c) credential gate passes for these execution tests.
  const heygenBundle = createBundle({
    providerId: "heygen",
    secretId: "tool/video_generate/heygen/api-key",
    modelKey: "heygen-photo-avatar-v3",
    videoModelParameters: HEYGEN_VIDEO_MODEL_PARAMETERS,
    videoVoiceCatalog: {
      provider: "heygen",
      fetchedAt: "2026-06-05T00:00:00.000Z",
      shortlist: [
        {
          voiceKey: "anya-warm",
          providerVoiceId: "heygen-voice-warm-001",
          displayName: "Anya Warm",
          locale: "en-US",
          gender: "female",
          description: "Warm, inviting English voice",
          styleTags: ["warm", "inviting"]
        },
        {
          voiceKey: "voice-other",
          providerVoiceId: "heygen-voice-other-002",
          displayName: "Voice Other",
          locale: "en-US",
          gender: "male",
          description: "Another voice",
          styleTags: []
        }
      ]
    },
    includeTalkingAvatarRef: true
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
  const klingVoiceToSilentRunwayFallbackBundle = createBundle({
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
          providerVoiceId: "voice-owen",
          displayName: "Owen",
          locale: "en-US",
          gender: "male",
          description: null,
          styleTags: []
        }
      ]
    },
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
    new ProviderGatewayHttpError(500, "Kling video generation request failed with status 500.")
  );
  const audioFallbackResult = await service.executeToolCall({
    bundle: klingVoiceToSilentRunwayFallbackBundle,
    toolCall: createToolCall({
      prompt: "Create a narrated product video",
      audioMode: "voice_control",
      voiceKeys: ["owen"],
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-2f-audio-fallback"
  });
  providerGatewayClientService.failuresByProvider.delete("kling");
  assert.equal(audioFallbackResult.payload.action, "generated");
  assert.equal(audioFallbackResult.payload.provider, "runway");
  assert.equal(audioFallbackResult.payload.requestedAudioMode, "silent");
  assert.match(audioFallbackResult.payload.warning ?? "", /continuing with silent video/i);
  assert.deepEqual(providerGatewayClientService.videoCalls[10], {
    input: {
      prompt: "Create a narrated product video",
      model: "kling-v3",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      referenceTailImage: null,
      voiceIds: ["voice-owen"],
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
  assert.deepEqual(providerGatewayClientService.videoCalls[11], {
    input: {
      prompt: "Create a narrated product video",
      model: "gen4.5",
      size: "1280x720",
      seconds: 4,
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
  const videoCallsBeforeAcceptedPrimaryUnconfirmed = providerGatewayClientService.videoCalls.length;
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
  assert.equal(
    providerGatewayClientService.videoCalls.length,
    videoCallsBeforeAcceptedPrimaryUnconfirmed + 1
  );
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
  const promptOnlyReferenceTextCall = providerGatewayClientService.videoCalls.at(-1);
  assert.equal(promptOnlyReferenceTextCall?.input.referenceImage, null);
  assert.equal(promptOnlyReferenceTextCall?.input.referenceTailImage, null);
  assert.equal(promptOnlyReferenceTextCall?.input.voiceIds, null);
  assert.equal(promptOnlyReferenceTextCall?.input.size, "1280x720");

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

  // ADR-109 Slice 3 (structural validation) + Slice 7 (execution) —
  // talking-avatar request fields. The runtime parses + structurally validates
  // without inspecting message bodies (invariant #15). Slice 7 adds real persona
  // resolution and dispatch. No multi-character refusal in code; that lives in
  // the LLM-facing tool description (Slice 8 territory).

  // ── Slice 7: Test 1 — Persona path happy path (voiceKey uses persona default) ──
  // Register a fake persona so fetchWorkspaceVideoPersona returns it.
  persaiInternalApiClientService.personaMap.set("workspace-1:persona-anya", {
    id: "persona-anya",
    displayName: "Anya",
    heygenAvatarId: "ava-cached-1",
    heygenVoiceId: "heygen-voice-warm-001",
    heygenVoiceLabel: "Anya Warm",
    portraitImageStorageKey: "workspaces/workspace-1/personas/persona-anya/portrait/current"
  });

  const talkingAvatarPersonaCall = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render a short narrated greeting from Anya",
      mode: "talking_avatar",
      speechText: "Hello, welcome to PersAI.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-persona"
  });
  assert.equal(talkingAvatarPersonaCall.payload.action, "generated");
  assert.equal(talkingAvatarPersonaCall.payload.requestedMode, "talking_avatar");
  assert.equal(talkingAvatarPersonaCall.payload.requestedSpeechText, "Hello, welcome to PersAI.");
  assert.equal(talkingAvatarPersonaCall.payload.requestedSpeechLanguage, "en-US");
  assert.equal(talkingAvatarPersonaCall.payload.requestedPersonaId, "persona-anya");
  assert.equal(talkingAvatarPersonaCall.payload.requestedPortraitImageAlias, null);
  assert.equal(talkingAvatarPersonaCall.payload.requestedVoiceKey, null);
  // Gateway call: cachedHeygenAvatarId from persona, voiceKey = persona.heygenVoiceId, no portrait bytes.
  const personaGatewayCall = providerGatewayClientService.videoCalls.at(-1)?.input;
  assert.equal(personaGatewayCall?.mode, "talking_avatar");
  assert.equal(personaGatewayCall?.speechText, "Hello, welcome to PersAI.");
  assert.equal(personaGatewayCall?.speechLanguage, "en-US");
  assert.equal(personaGatewayCall?.personaId, "persona-anya");
  assert.equal(personaGatewayCall?.portraitImageAlias, null);
  assert.equal(personaGatewayCall?.cachedHeygenAvatarId, "ava-cached-1");
  assert.equal(personaGatewayCall?.portraitImageBytesBase64, null);
  assert.equal(personaGatewayCall?.voiceKey, "heygen-voice-warm-001"); // persona.heygenVoiceId
  assert.deepEqual(personaGatewayCall?.providerParameters, {
    resolution: "720p",
    aspectRatio: "9:16",
    engine: "avatar_v"
  });

  // ── Slice 7: Test 2 — Persona path with explicit voiceKey override ─────────
  const talkingAvatarPersonaExplicitVoiceCall = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render Anya with a different voice",
      mode: "talking_avatar",
      speechText: "Good morning.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      voiceKey: "voice-other", // explicit override — must be in HeyGen shortlist
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-persona-explicit-voice"
  });
  assert.equal(talkingAvatarPersonaExplicitVoiceCall.payload.action, "generated");
  assert.equal(talkingAvatarPersonaExplicitVoiceCall.payload.requestedVoiceKey, "voice-other");
  const personaExplicitVoiceGatewayCall = providerGatewayClientService.videoCalls.at(-1)?.input;
  assert.equal(personaExplicitVoiceGatewayCall?.voiceKey, "heygen-voice-other-002"); // providerVoiceId

  // ── Slice 7: Test 2b — Persona path with invalid voiceKey override → voice_not_found ──
  const talkingAvatarInvalidVoiceKey = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render Anya",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      voiceKey: "no-such-voice",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-invalid-voice-key"
  });
  assert.equal(talkingAvatarInvalidVoiceKey.payload.action, "skipped");
  assert.equal(talkingAvatarInvalidVoiceKey.payload.reason, "voice_not_found");

  // ── Slice 7: Test 3 — Persona not found → persona_not_found ──────────────
  const talkingAvatarPersonaNotFound = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render unknown persona",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-does-not-exist",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-persona-not-found"
  });
  assert.equal(talkingAvatarPersonaNotFound.payload.action, "skipped");
  assert.equal(talkingAvatarPersonaNotFound.payload.reason, "persona_not_found");

  // ── Slice 7: Test 4 — Portrait alias path happy path ──────────────────────
  mediaObjectStorage.sourceObjects.set(
    "media/reference-1.png",
    Buffer.from("portrait-image-binary")
  );
  const talkingAvatarPortraitCall = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render a portrait talking video from the attached photo",
      mode: "talking_avatar",
      speechText: "Welcome aboard.",
      speechLanguage: "ru-RU",
      portraitImageAlias: "current image #1",
      voiceKey: "anya-warm", // required for portrait path
      seconds: 15,
      size: "720x1280"
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-talking-avatar-portrait"
  });
  assert.equal(talkingAvatarPortraitCall.payload.action, "generated");
  assert.equal(talkingAvatarPortraitCall.payload.requestedMode, "talking_avatar");
  assert.equal(talkingAvatarPortraitCall.payload.requestedPersonaId, null);
  assert.equal(talkingAvatarPortraitCall.payload.requestedPortraitImageAlias, "current image #1");
  assert.equal(talkingAvatarPortraitCall.payload.requestedVoiceKey, "anya-warm");
  const portraitGatewayCall = providerGatewayClientService.videoCalls.at(-1)?.input;
  assert.equal(portraitGatewayCall?.mode, "talking_avatar");
  assert.equal(portraitGatewayCall?.personaId, null);
  assert.equal(portraitGatewayCall?.cachedHeygenAvatarId, null);
  assert.ok(
    typeof portraitGatewayCall?.portraitImageBytesBase64 === "string" &&
      portraitGatewayCall.portraitImageBytesBase64.length > 0,
    "portraitImageBytesBase64 must be populated for ad-hoc portrait path"
  );
  assert.equal(portraitGatewayCall?.voiceKey, "heygen-voice-warm-001"); // providerVoiceId

  // ── Slice 7: Test 5 — Portrait alias path without voiceKey → voice_required ──
  const talkingAvatarPortraitNoVoice = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render portrait no voice",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      portraitImageAlias: "current image #1"
      // voiceKey intentionally absent
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-talking-avatar-portrait-no-voice"
  });
  assert.equal(talkingAvatarPortraitNoVoice.payload.action, "skipped");
  assert.equal(talkingAvatarPortraitNoVoice.payload.reason, "voice_required");

  // ── Slice 7: Test 6 — Portrait alias unavailable (alias not in attachments) ──
  const talkingAvatarPortraitBadAlias = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render portrait bad alias",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      portraitImageAlias: "nonexistent-alias",
      voiceKey: "anya-warm"
    }),
    availableAttachments: [createReferenceAttachment()], // has aliases but not "nonexistent-alias"
    sessionId: "session-1",
    requestId: "request-talking-avatar-portrait-bad-alias"
  });
  assert.equal(talkingAvatarPortraitBadAlias.payload.action, "skipped");
  assert.equal(talkingAvatarPortraitBadAlias.payload.reason, "portrait_alias_unavailable");

  // ── Slice 10d: Test 6b — talking_avatar bypasses cinematic audio/input
  // capability validation. HeyGen catalog only advertises audioCapabilities:
  // ["silent"]. A naive LLM may pass audioMode: "voice_control" alongside
  // mode: "talking_avatar" (since the request is conceptually "spoken video").
  // Pre-Slice-10d this hit `buildUnsupportedAudioModeMessage("voice_control")`
  // and surfaced "The selected video model does not support provider-side
  // voice control" — misleading because talking_avatar has its own audio path
  // (speechText + voiceKey / persona.heygenVoiceId). Slice 10d's
  // normalizeExecutionRequest now short-circuits the cinematic capability
  // check for talking_avatar requests; this test pins the fix.
  const talkingAvatarVoiceControlOverride = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Render Anya speaking",
      mode: "talking_avatar",
      speechText: "Hello again.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      audioMode: "voice_control", // LLM-provided cinematic field — must be ignored
      inputMode: "single_reference_image", // LLM-provided cinematic field — must be ignored
      seconds: 5,
      size: "720x1280"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-cinematic-overrides-ignored"
  });
  assert.equal(
    talkingAvatarVoiceControlOverride.payload.action,
    "generated",
    "talking_avatar must bypass cinematic audioMode/inputMode validation"
  );
  assert.equal(talkingAvatarVoiceControlOverride.payload.requestedMode, "talking_avatar");
  // Cinematic echo fields must be normalized to safe values, not the LLM-passed values.
  assert.equal(talkingAvatarVoiceControlOverride.payload.requestedAudioMode, "silent");
  assert.equal(talkingAvatarVoiceControlOverride.payload.requestedInputMode, "text");
  assert.equal(
    talkingAvatarVoiceControlOverride.payload.requestedSeconds,
    15,
    "talking_avatar ignores LLM-provided cinematic seconds; HeyGen duration follows speechText"
  );
  assert.equal(
    talkingAvatarVoiceControlOverride.payload.size,
    "1280x720",
    "talking_avatar ignores LLM-provided cinematic size; HeyGen aspect follows admin catalog"
  );
  const overrideGatewayCall = providerGatewayClientService.videoCalls.at(-1)?.input;
  assert.equal(overrideGatewayCall?.mode, "talking_avatar");

  // ── Slice 7: Test 7 — Plan toggle off → talking_avatar_plan_disabled ───────
  // Synthetic bundle with talkingVideoEnabled: false on the tool policy.
  // includeTalkingAvatarRef=true ensures the Slice 10c credential gate passes so
  // the code can reach the talkingVideoEnabled check inside executeTalkingAvatarDispatch.
  const planDisabledBundle = createBundle({
    providerId: "heygen",
    secretId: "tool/video_generate/heygen/api-key",
    modelKey: "heygen-photo-avatar-v3",
    videoModelParameters: HEYGEN_VIDEO_MODEL_PARAMETERS,
    videoVoiceCatalog: {
      provider: "heygen",
      fetchedAt: "2026-06-05T00:00:00.000Z",
      shortlist: []
    },
    includeTalkingAvatarRef: true
  });
  // Inject talkingVideoEnabled: false onto the tool policy (Slice 8 field).
  const videoPolicy = planDisabledBundle.governance.toolPolicies.find(
    (p) => p.toolCode === "video_generate"
  );
  if (videoPolicy !== undefined) {
    (videoPolicy as unknown as Record<string, unknown>).talkingVideoEnabled = false;
  }
  const planDisabledResult = await service.executeToolCall({
    bundle: planDisabledBundle,
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-plan-disabled"
  });
  assert.equal(planDisabledResult.payload.action, "skipped");
  assert.equal(planDisabledResult.payload.reason, "talking_avatar_plan_disabled");

  // ── Slice 7: Test 8 — Plan toggle field missing (Slice 8 not landed) → permissive ──
  // Normal heygenBundle has no talkingVideoEnabled → request proceeds normally.
  persaiInternalApiClientService.personaMap.set("workspace-1:persona-anya", {
    id: "persona-anya",
    displayName: "Anya",
    heygenAvatarId: "ava-cached-1",
    heygenVoiceId: "heygen-voice-warm-001",
    heygenVoiceLabel: "Anya Warm",
    portraitImageStorageKey: "workspaces/workspace-1/personas/persona-anya/portrait/current"
  });
  const planToggleMissingResult = await service.executeToolCall({
    bundle: heygenBundle, // no talkingVideoEnabled field → default permissive
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-plan-toggle-missing"
  });
  assert.equal(planToggleMissingResult.payload.action, "generated");

  // ── Slice 7: Test 9 — HeyGen credential missing (non-HeyGen provider) → talking_avatar_provider_unavailable ──
  const talkingAvatarProviderUnavailable = await service.executeToolCall({
    bundle, // OpenAI bundle — not HeyGen
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-provider-unavailable"
  });
  assert.equal(talkingAvatarProviderUnavailable.payload.action, "skipped");
  assert.equal(
    talkingAvatarProviderUnavailable.payload.reason,
    "talking_avatar_provider_unavailable"
  );

  // ── Slice 7: Test 10 — Cinematic path regression: unaffected by talking_avatar branch ──
  const cinematicIgnoresExtraFields = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate a quiet riverside scene",
      mode: "cinematic",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-cinematic-mode-ignores-extra-fields"
  });
  assert.equal(cinematicIgnoresExtraFields.payload.action, "generated");
  assert.equal(cinematicIgnoresExtraFields.payload.requestedMode, "cinematic");
  // Cinematic mode does NOT carry talking-avatar fields to the gateway: those
  // keys must remain absent so existing cinematic providers stay untouched.
  const cinematicGatewayCall = providerGatewayClientService.videoCalls.at(-1)?.input;
  assert.equal(
    Object.prototype.hasOwnProperty.call(cinematicGatewayCall ?? {}, "speechText"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(cinematicGatewayCall ?? {}, "personaId"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(cinematicGatewayCall ?? {}, "portraitImageAlias"),
    false
  );

  // ── Slice 7: Test 11 — Result echo: all requested* fields round-trip correctly ──
  persaiInternalApiClientService.personaMap.set("workspace-1:persona-echo-test", {
    id: "persona-echo-test",
    displayName: "Echo",
    heygenAvatarId: "ava-echo-123",
    heygenVoiceId: "heygen-voice-warm-001",
    heygenVoiceLabel: "Anya Warm",
    portraitImageStorageKey: "workspaces/workspace-1/personas/persona-echo-test/portrait/current"
  });
  const echoTestResult = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Echo test",
      mode: "talking_avatar",
      speechText: "Echo speech.",
      speechLanguage: "zh-CN",
      personaId: "persona-echo-test",
      voiceKey: "anya-warm",
      seconds: 30,
      size: "720x1280"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-echo"
  });
  assert.equal(echoTestResult.payload.requestedMode, "talking_avatar");
  assert.equal(echoTestResult.payload.requestedSpeechText, "Echo speech.");
  assert.equal(echoTestResult.payload.requestedSpeechLanguage, "zh-CN");
  assert.equal(echoTestResult.payload.requestedPersonaId, "persona-echo-test");
  assert.equal(echoTestResult.payload.requestedPortraitImageAlias, null);
  assert.equal(echoTestResult.payload.requestedVoiceKey, "anya-warm");

  // ── Structural validation tests (Slice 3 — unchanged by Slice 7) ─────────

  // Validation: missing speechText → invalid_arguments.
  const missingSpeechText = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechLanguage: "en-US",
      personaId: "persona-anya"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-missing-speech-text"
  });
  assert.equal(missingSpeechText.payload.action, "skipped");
  assert.equal(missingSpeechText.payload.reason, "invalid_arguments");
  assert.match(missingSpeechText.payload.warning ?? "", /speechText is required/i);

  // Validation: missing speechLanguage → invalid_arguments.
  const missingSpeechLanguage = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      personaId: "persona-anya"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-missing-speech-language"
  });
  assert.equal(missingSpeechLanguage.payload.action, "skipped");
  assert.equal(missingSpeechLanguage.payload.reason, "invalid_arguments");
  assert.match(missingSpeechLanguage.payload.warning ?? "", /speechLanguage is required/i);

  // Validation: both personaId AND portraitImageAlias → invalid_arguments.
  const bothPersonaAndPortrait = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      portraitImageAlias: "current image #1"
    }),
    availableAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-talking-avatar-both-persona-and-portrait"
  });
  assert.equal(bothPersonaAndPortrait.payload.action, "skipped");
  assert.equal(bothPersonaAndPortrait.payload.reason, "invalid_arguments");
  assert.match(
    bothPersonaAndPortrait.payload.warning ?? "",
    /Exactly one of personaId or portraitImageAlias/i
  );

  // Validation: neither personaId nor portraitImageAlias → invalid_arguments.
  const neitherPersonaNorPortrait = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Render a greeting",
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-talking-avatar-neither-persona-nor-portrait"
  });
  assert.equal(neitherPersonaNorPortrait.payload.action, "skipped");
  assert.equal(neitherPersonaNorPortrait.payload.reason, "invalid_arguments");
  assert.match(
    neitherPersonaNorPortrait.payload.warning ?? "",
    /Exactly one of personaId or portraitImageAlias/i
  );

  // ── ADR-109 Slice 10c Fix #2: prompt validation order ─────────────────────
  // Prompt is now OPTIONAL for talking_avatar. A structural placeholder is
  // synthesized at the parse boundary so downstream code always sees a string.
  // Cinematic mode (absent or "cinematic") still requires a non-empty prompt.

  // Fix #2 Test 1: talking_avatar WITHOUT prompt → validation passes; placeholder synthesized.
  const taNoPromptResult = await service.executeToolCall({
    bundle, // credentials irrelevant; we check payload.prompt before credential gate
    toolCall: createToolCall({
      mode: "talking_avatar",
      speechText: "Hello.",
      speechLanguage: "en-US",
      personaId: "persona-anya"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-no-prompt"
  });
  // The credential gate fires first (no video_generate_talking_avatar on plain bundle)
  // but the prompt is echoed in the payload — confirm placeholder was synthesized.
  assert.notEqual(taNoPromptResult.payload.action, "invalid_arguments" as never);
  assert.equal(
    taNoPromptResult.payload.prompt,
    "Talking-avatar render",
    "Fix #2: talking_avatar without prompt must yield placeholder 'Talking-avatar render'"
  );

  // Fix #2 Test 2: talking_avatar WITH explicit prompt → user-provided prompt preserved.
  const taWithPromptResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "User scene context",
      mode: "talking_avatar",
      speechText: "Hi.",
      speechLanguage: "en-US",
      personaId: "persona-anya"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-with-prompt"
  });
  assert.equal(
    taWithPromptResult.payload.prompt,
    "User scene context",
    "Fix #2: talking_avatar with explicit prompt must preserve user value"
  );

  // Fix #2 Test 3: cinematic (mode absent) without prompt → still invalid_arguments.
  const cinematicNoPrompt = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-cinematic-no-prompt"
  });
  assert.equal(
    cinematicNoPrompt.payload.action,
    "skipped",
    "Fix #2: cinematic without prompt must be skipped"
  );
  assert.equal(
    cinematicNoPrompt.payload.reason,
    "invalid_arguments",
    "Fix #2: cinematic without prompt must yield invalid_arguments"
  );
  assert.match(
    cinematicNoPrompt.payload.warning ?? "",
    /prompt must be a non-empty string/i,
    "Fix #2: cinematic without prompt must mention 'prompt must be a non-empty string'"
  );

  // Fix #2 Test 4: cinematic with empty-string prompt → still invalid_arguments.
  const cinematicEmptyPrompt = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "   ",
      seconds: 4,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-cinematic-empty-prompt"
  });
  assert.equal(
    cinematicEmptyPrompt.payload.action,
    "skipped",
    "Fix #2: cinematic with whitespace-only prompt must be skipped"
  );
  assert.equal(
    cinematicEmptyPrompt.payload.reason,
    "invalid_arguments",
    "Fix #2: cinematic with whitespace-only prompt must yield invalid_arguments"
  );

  // ── ADR-109 Slice 10c Fix #3e: credential routing for talking_avatar mode ──
  // talking_avatar MUST use toolCredentialRefs["video_generate_talking_avatar"].
  // Absence of that key → talking_avatar_provider_unavailable (no silent fallback).

  // Fix #3e Test 1: talking_avatar WITH the dedicated credential → proceeds (not provider_unavailable).
  persaiInternalApiClientService.personaMap.set("workspace-1:persona-routing-test", {
    id: "persona-routing-test",
    displayName: "Routing Test",
    heygenAvatarId: "ava-routing-001",
    heygenVoiceId: "heygen-voice-warm-001",
    heygenVoiceLabel: "Test Voice",
    portraitImageStorageKey: "workspaces/workspace-1/personas/persona-routing-test/portrait/current"
  });
  const talkingAvatarWithCredential = await service.executeToolCall({
    bundle: heygenBundle, // has video_generate_talking_avatar via includeTalkingAvatarRef=true
    toolCall: createToolCall({
      prompt: "Routing credential present",
      mode: "talking_avatar",
      speechText: "Test.",
      speechLanguage: "en-US",
      personaId: "persona-routing-test",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-credential-routing-present"
  });
  assert.notEqual(
    talkingAvatarWithCredential.payload.reason,
    "talking_avatar_provider_unavailable",
    "Fix #3e: bundle with video_generate_talking_avatar credential must NOT return provider_unavailable"
  );

  // Fix #3e Test 2: talking_avatar WITHOUT the dedicated credential → talking_avatar_provider_unavailable.
  const talkingAvatarWithoutCredential = await service.executeToolCall({
    bundle, // plain openai bundle — no video_generate_talking_avatar key
    toolCall: createToolCall({
      prompt: "Routing credential absent",
      mode: "talking_avatar",
      speechText: "Test.",
      speechLanguage: "en-US",
      personaId: "persona-routing-test",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-credential-routing-absent"
  });
  assert.equal(talkingAvatarWithoutCredential.payload.action, "skipped");
  assert.equal(
    talkingAvatarWithoutCredential.payload.reason,
    "talking_avatar_provider_unavailable",
    "Fix #3e: bundle WITHOUT video_generate_talking_avatar must return talking_avatar_provider_unavailable"
  );
  assert.match(
    talkingAvatarWithoutCredential.payload.warning ?? "",
    /Configure 'Talking Avatar Model' in the plan editor/i,
    "Fix #3e: warning must mention plan editor configuration"
  );

  // ── ADR-109 Slice 10d Fix #5: talking_avatar must respect deferToAsyncMediaJob ──
  // When the LLM turn loop calls executeToolCall with deferToAsyncMediaJob set
  // (the normal chat path, not the worker re-entry), the talking_avatar branch
  // MUST enqueue an async media job and return action="pending_delivery" with
  // a real jobId — exactly like the cinematic branch. Pre-Slice-10d this path
  // ignored the defer flag and synchronously polled HeyGen inline, blocking
  // the LLM turn for the full render time (~2 min) and never creating the
  // assistant_media_jobs row the chat-input chip needs.
  persaiInternalApiClientService.enqueueCalls.length = 0;
  persaiInternalApiClientService.nextJobId = "media-job-talking-avatar-defer-1";
  persaiInternalApiClientService.personaMap.set("workspace-1:persona-defer-test", {
    id: "persona-defer-test",
    displayName: "Defer Test",
    heygenAvatarId: "ava-defer-001",
    heygenVoiceId: "heygen-voice-warm-001",
    heygenVoiceLabel: "Defer Voice",
    portraitImageStorageKey: "workspaces/workspace-1/personas/persona-defer-test/portrait/current"
  });
  const talkingAvatarDeferAccepted = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Defer path",
      mode: "talking_avatar",
      speechText: "Hello deferred.",
      speechLanguage: "en-US",
      personaId: "persona-defer-test",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-defer-accepted",
    deferToAsyncMediaJob: {
      sourceUserMessageId: "user-msg-defer-1",
      sourceUserMessageText: "Hello deferred."
    }
  });
  assert.equal(
    talkingAvatarDeferAccepted.payload.action,
    "pending_delivery",
    "Slice 10d Fix #5: talking_avatar with deferToAsyncMediaJob must return pending_delivery"
  );
  assert.equal(
    talkingAvatarDeferAccepted.payload.jobId,
    "media-job-talking-avatar-defer-1",
    "Slice 10d Fix #5: pending_delivery payload must carry the enqueue jobId"
  );
  assert.equal(
    talkingAvatarDeferAccepted.payload.canSendFileNow,
    false,
    "Slice 10d Fix #5: canSendFileNow=false signals async delivery"
  );
  assert.equal(
    persaiInternalApiClientService.enqueueCalls.length,
    1,
    "Slice 10d Fix #5: enqueueDeferredMediaJob must be called exactly once"
  );
  assert.equal(
    persaiInternalApiClientService.enqueueCalls[0]?.requestMode,
    "talking_avatar",
    "Slice 10d Fix #5: enqueued request must preserve mode='talking_avatar' (drives chip displayKind)"
  );
  assert.equal(
    persaiInternalApiClientService.enqueueCalls[0]?.sourceUserMessageId,
    "user-msg-defer-1",
    "Slice 10d Fix #5: source user message id must round-trip"
  );

  // Slice 10d Fix #5 negative: when enqueue rejects (quota / concurrency), the
  // tool must surface skipped with the rejection code, NOT silently fall
  // through to synchronous dispatch.
  persaiInternalApiClientService.enqueueCalls.length = 0;
  persaiInternalApiClientService.enqueueOverride = {
    accepted: false,
    code: "media_job_concurrency_limit",
    message: "Too many concurrent media jobs.",
    guidance: "Wait for an open job to finish."
  };
  const talkingAvatarDeferRefused = await service.executeToolCall({
    bundle: heygenBundle,
    toolCall: createToolCall({
      prompt: "Defer refused",
      mode: "talking_avatar",
      speechText: "Limit hit.",
      speechLanguage: "en-US",
      personaId: "persona-defer-test",
      seconds: 15,
      size: "1280x720"
    }),
    availableAttachments: [],
    sessionId: "session-1",
    requestId: "request-ta-defer-refused",
    deferToAsyncMediaJob: {
      sourceUserMessageId: "user-msg-defer-2",
      sourceUserMessageText: "Limit hit."
    }
  });
  assert.equal(talkingAvatarDeferRefused.payload.action, "skipped");
  assert.equal(
    talkingAvatarDeferRefused.payload.reason,
    "media_job_concurrency_limit",
    "Slice 10d Fix #5: enqueue rejection code must surface as payload.reason"
  );
  assert.equal(
    talkingAvatarDeferRefused.payload.jobId,
    null,
    "Slice 10d Fix #5: refused enqueue must NOT carry a jobId"
  );
  persaiInternalApiClientService.enqueueOverride = null;
}
