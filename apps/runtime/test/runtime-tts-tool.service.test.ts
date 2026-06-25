import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeTtsProviderId,
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult,
  ProviderGatewayToolCall,
  RuntimeKnowledgeAccessConfig,
  RuntimeBrowserConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { RuntimeTtsToolService } from "../src/modules/turns/runtime-tts-tool.service";
import { createFakeSandboxClientForOutboundWrite } from "./helpers/runtime-outbound-test-doubles";
import type {
  ConsumeToolDailyLimitOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
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
      toolCode: "tts",
      family: "media_generation",
      outcomeKind: "artifact_refs",
      timeoutMs: 180000,
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
  primaryConfigured?: boolean;
  fallbackConfigured?: boolean;
  primaryProviderId?: PersaiRuntimeTtsProviderId;
  fallbackProviderId?: PersaiRuntimeTtsProviderId;
  openAiModelKey?: string;
}) {
  const primaryProviderId = options?.primaryProviderId ?? "elevenlabs";
  const fallbackProviderId: PersaiRuntimeTtsProviderId =
    options?.fallbackProviderId ?? (primaryProviderId === "openai" ? "yandex" : "openai");
  return compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      assistantHandle: "a-test",
      siblingAssistantHandles: [],
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Answer as a concise assistant.",
      traits: {
        warmth: 80,
        formality: 45,
        playfulness: 30
      },
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: "female",
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: "voice-eleven"
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
      locale: "ru-RU",
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
        tts: {
          refKey: `persai:persai-runtime:tool/tts/${primaryProviderId}`,
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: `tool/tts/${primaryProviderId}`
          },
          configured: options?.primaryConfigured ?? true,
          providerId: primaryProviderId,
          ...(primaryProviderId === "openai"
            ? { modelKey: options?.openAiModelKey ?? "gpt-4o-mini-tts" }
            : {}),
          fallbacks: [
            {
              refKey: `persai:persai-runtime:tool/tts/${fallbackProviderId}`,
              secretRef: {
                source: "persai",
                provider: "persai-runtime",
                id: `tool/tts/${fallbackProviderId}`
              },
              configured: options?.fallbackConfigured ?? true,
              providerId: fallbackProviderId,
              ...(fallbackProviderId === "openai"
                ? { modelKey: options?.openAiModelKey ?? "gpt-4o-mini-tts" }
                : {})
            }
          ]
        }
      },
      toolPolicies: [
        {
          toolCode: "tts",
          displayName: "TTS",
          description: "Generate spoken audio.",
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
        sharedQuotaBytes: 1024,
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

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-1",
    name: "tts",
    arguments: argumentsObject
  };
}

class FakeProviderGatewayClientService {
  speechCalls: ProviderGatewaySpeechGenerateRequest[] = [];

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    this.speechCalls.push(input);
    if (input.credential.providerId === "elevenlabs") {
      throw new Error("Saved ElevenLabs voice is unavailable.");
    }
    if (input.credential.providerId === null) {
      throw new Error("TTS providerId must be resolved before the runtime test client runs.");
    }
    const provider = input.credential.providerId;
    return {
      provider,
      model:
        provider === "yandex"
          ? "yandex-speechkit"
          : provider === "openai"
            ? "gpt-4o-mini-tts"
            : "tts-model",
      deliveryKind: input.deliveryKind,
      bytesBase64: Buffer.from("voice-note-binary").toString("base64"),
      mimeType: "audio/ogg",
      respondedAt: "2026-04-13T12:00:00.000Z",
      usage: {
        providerKey: provider,
        modelKey:
          provider === "yandex"
            ? "yandex-speechkit"
            : provider === "openai"
              ? "gpt-4o-mini-tts"
              : "tts-model",
        inputTokens: 20,
        outputTokens: 40,
        totalTokens: 60
      },
      warning: null
    };
  }
}

class FakePersaiInternalApiClientService {
  quotaCalls: Array<{
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
    this.quotaCalls.push(input);
    return {
      allowed: true,
      currentCount: 1,
      limit: input.dailyCallLimit
    };
  }
}

export async function runRuntimeTtsToolServiceTest(): Promise<void> {
  const providerGatewayClientService = new FakeProviderGatewayClientService();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const sandboxClient = createFakeSandboxClientForOutboundWrite(
    "/workspace/outbound/self/speech-openai.mp3"
  );
  const service = new RuntimeTtsToolService(
    providerGatewayClientService as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    sandboxClient as never
  );

  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  assert.equal(
    projection.tools.some((tool) => tool.name === "tts"),
    true
  );

  const fallbackOnlyProjection = projectRuntimeNativeTools(
    createBundle({
      primaryConfigured: false,
      fallbackConfigured: true,
      fallbackProviderId: "yandex"
    })
  );
  assert.equal(
    fallbackOnlyProjection.tools.some((tool) => tool.name === "tts"),
    true
  );

  const hiddenProjection = projectRuntimeNativeTools(
    createBundle({ primaryConfigured: false, fallbackConfigured: false })
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "tts"),
    false
  );

  const openAiPrimaryBundle = createBundle({ primaryProviderId: "openai" });
  const result = await service.executeToolCall({
    bundle: openAiPrimaryBundle,
    toolCall: createToolCall({
      text: "Привет, записываю тебе короткий голосовой ответ.",
      delivery: "warm",
      emotion: "happy"
    }),
    sessionId: "session-1",
    requestId: "request-1"
  });
  assert.equal(result.payload.action, "generated");
  assert.equal(result.payload.provider, "openai");
  assert.deepEqual(result.payload.attemptedProviders, ["openai"]);
  assert.equal(result.payload.delivery?.delivery, "warm");
  assert.equal(result.payload.delivery?.emotion, "happy");
  // delivery=warm + emotion=happy derives the legacy cheerful tone for OpenAI.
  assert.equal(providerGatewayClientService.speechCalls[0]?.toneTag, "cheerful");
  assert.equal(providerGatewayClientService.speechCalls[0]?.delivery?.delivery, "warm");
  assert.equal(result.payload.artifact?.voiceNote, true);
  assert.equal(result.payload.artifact?.mimeType, "audio/ogg");
  assert.equal(result.payload.artifact?.sourceToolCode, "tts");
  assert.equal(result.artifacts[0]?.sourceToolCode, "tts");
  assert.equal(result.artifacts.length, 1);
  assert.equal(providerGatewayClientService.speechCalls.length, 1);
  assert.equal(providerGatewayClientService.speechCalls[0]?.credential.providerId, "openai");
  assert.equal(providerGatewayClientService.speechCalls[0]?.credential.modelKey, "gpt-4o-mini-tts");
  assert.equal(result.artifacts[0]?.storagePath, "/workspace/outbound/self/speech-openai.mp3");
  assert.equal(result.artifacts[0]?.mimeType, "audio/ogg");
  assert.deepEqual(persaiInternalApiClientService.quotaCalls, [
    {
      assistantId: "assistant-1",
      toolCode: "tts",
      dailyCallLimit: 5
    }
  ]);

  const yandexFallbackBundle = createBundle({
    primaryProviderId: "elevenlabs",
    fallbackProviderId: "yandex"
  });
  const fallbackResult = await service.executeToolCall({
    bundle: yandexFallbackBundle,
    toolCall: createToolCall({
      text: "Привет, это должен быть стабильный fallback через Yandex.",
      delivery: "warm"
    }),
    sessionId: "session-1",
    requestId: "request-1b"
  });
  assert.equal(fallbackResult.payload.action, "generated");
  assert.equal(fallbackResult.payload.provider, "yandex");
  assert.deepEqual(fallbackResult.payload.attemptedProviders, ["elevenlabs", "yandex"]);
  assert.match(fallbackResult.payload.warning ?? "", /fallback provider "yandex"/);
  assert.equal(providerGatewayClientService.speechCalls.length, 3);
  assert.equal(providerGatewayClientService.speechCalls[1]?.credential.providerId, "elevenlabs");
  assert.equal(providerGatewayClientService.speechCalls[2]?.credential.providerId, "yandex");
  assert.equal(providerGatewayClientService.speechCalls[2]?.credential.modelKey ?? null, null);

  const customOpenAiModelBundle = createBundle({
    primaryProviderId: "openai",
    openAiModelKey: "gpt-4o-tts"
  });
  await service.executeToolCall({
    bundle: customOpenAiModelBundle,
    toolCall: createToolCall({
      text: "Проверь, что runtime forwards catalog-owned OpenAI TTS model.",
      delivery: "warm"
    }),
    sessionId: "session-1",
    requestId: "request-1c"
  });
  assert.equal(providerGatewayClientService.speechCalls[3]?.credential.providerId, "openai");
  assert.equal(providerGatewayClientService.speechCalls[3]?.credential.modelKey, "gpt-4o-tts");

  const invalid = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      text: "",
      delivery: "warm"
    }),
    sessionId: "session-1",
    requestId: "request-2"
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);

  const unknownArg = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      text: "Старый аргумент toneTag больше не принимается.",
      toneTag: "warm"
    }),
    sessionId: "session-1",
    requestId: "request-3"
  });
  assert.equal(unknownArg.payload.action, "skipped");
  assert.equal(unknownArg.payload.reason, "invalid_arguments");
  assert.match(unknownArg.payload.warning ?? "", /Unexpected arguments: toneTag/);
}
