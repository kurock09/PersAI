import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeAttachmentRef,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { RuntimeVideoGenerateToolService } from "../src/modules/turns/runtime-video-generate-tool.service";
import type {
  ConsumeToolDailyLimitOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import type { PersaiMediaObjectStorageService } from "../src/modules/turns/persai-media-object-storage.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

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
      timeoutMs: 300000,
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

function createBundle(options?: { configured?: boolean }) {
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
      optimizationPolicy: null,
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
        suggestByMessageCount: false,
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
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: options?.configured ?? true,
          providerId: "openai"
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
      bootstrap: ""
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-1",
    name: "video_generate",
    arguments: argumentsObject
  };
}

function createReferenceAttachment(): RuntimeAttachmentRef {
  return {
    attachmentId: "attachment-1",
    kind: "image",
    objectKey: "media/reference-1.png",
    mimeType: "image/png",
    filename: "forest.png",
    sizeBytes: 10
  };
}

class FakeProviderGatewayClientService {
  videoCalls: Array<{
    input: ProviderGatewayVideoGenerateRequest;
    options?: { timeoutMs?: number };
  }> = [];

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.videoCalls.push(options === undefined ? { input } : { input, options });
    return {
      provider: "openai",
      model: "sora-2",
      prompt: input.prompt,
      size: input.size,
      seconds: input.seconds,
      video: {
        bytesBase64: Buffer.from("video-binary").toString("base64"),
        mimeType: "video/mp4"
      },
      respondedAt: "2026-04-14T12:00:00.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "sora-2",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null
      },
      warning: null
    };
  }
}

class FakePersaiInternalApiClientService {
  quotaCalls: Array<{ assistantId: string; toolCode: string; dailyCallLimit: number }> = [];

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    this.quotaCalls.push(input);
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

export async function runRuntimeVideoGenerateToolServiceTest(): Promise<void> {
  const providerGatewayClientService = new FakeProviderGatewayClientService();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const mediaObjectStorage = new FakePersaiMediaObjectStorageService();
  const service = new RuntimeVideoGenerateToolService(
    providerGatewayClientService as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as unknown as PersaiMediaObjectStorageService
  );

  const bundle = createBundle();
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

  const promptOnlyResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate a calm paper-cut forest at sunrise",
      seconds: 4,
      size: "1280x720"
    }),
    currentAttachments: [],
    sessionId: "session-1",
    requestId: "request-1"
  });
  assert.equal(promptOnlyResult.payload.action, "generated");
  assert.equal(promptOnlyResult.payload.provider, "openai");
  assert.equal(promptOnlyResult.payload.referenceImageIndex, null);
  assert.equal(promptOnlyResult.payload.artifact?.kind, "video");
  assert.equal(promptOnlyResult.artifacts.length, 1);
  assert.deepEqual(providerGatewayClientService.videoCalls[0], {
    input: {
      prompt: "Animate a calm paper-cut forest at sunrise",
      size: "1280x720",
      seconds: 4,
      referenceImage: null,
      credential: {
        toolCode: "video_generate",
        secretId: "tool/image_generate/api-key",
        providerId: "openai"
      }
    },
    options: {
      timeoutMs: 300000
    }
  });

  mediaObjectStorage.sourceObjects.set(
    "media/reference-1.png",
    Buffer.from("reference-image-binary")
  );
  const referenceResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate the attached image into a calm sunrise clip",
      referenceImageIndex: 1,
      seconds: 8
    }),
    currentAttachments: [createReferenceAttachment()],
    sessionId: "session-1",
    requestId: "request-2"
  });
  assert.equal(referenceResult.payload.action, "generated");
  assert.equal(referenceResult.payload.referenceImageIndex, 1);
  assert.equal(referenceResult.payload.referenceFilename, "forest.png");
  assert.equal(referenceResult.payload.artifact?.filename, "forest-video.mp4");
  assert.equal(
    providerGatewayClientService.videoCalls[1]?.input.referenceImage?.mimeType,
    "image/png"
  );
  assert.equal(
    providerGatewayClientService.videoCalls[1]?.input.referenceImage?.bytesBase64,
    Buffer.from("reference-image-binary").toString("base64")
  );
  assert.deepEqual(persaiInternalApiClientService.quotaCalls, [
    {
      assistantId: "assistant-1",
      toolCode: "video_generate",
      dailyCallLimit: 5
    },
    {
      assistantId: "assistant-1",
      toolCode: "video_generate",
      dailyCallLimit: 5
    }
  ]);

  const invalid = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      prompt: "Animate this",
      seconds: 6
    }),
    currentAttachments: [],
    sessionId: "session-1",
    requestId: "request-3"
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);
}
