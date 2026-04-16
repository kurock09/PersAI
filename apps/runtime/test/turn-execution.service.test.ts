import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeKnowledgeAccessConfig,
  RuntimeBrowserConfig,
  RuntimeCompactionResult,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent,
  ProviderGatewayWebSearchRequest,
  ProviderGatewayWebSearchResult,
  ProviderGatewayWebFetchRequest,
  ProviderGatewayWebFetchResult,
  RuntimeCompactionRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import type { RuntimeBundleCacheEntry } from "../src/modules/bundles/bundle.types";
import type { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import type { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";
import type {
  AcceptedRuntimeTurn,
  ReplayedRuntimeTurn,
  TurnAcceptanceResult,
  TurnAcceptanceService
} from "../src/modules/turns/turn-acceptance.service";
import type {
  ConsumeToolDailyLimitOutcome,
  InternalQuotaStatusOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeBrowserToolService } from "../src/modules/turns/runtime-browser-tool.service";
import { RuntimeImageEditToolService } from "../src/modules/turns/runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "../src/modules/turns/runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "../src/modules/turns/runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "../src/modules/turns/runtime-memory-write-tool.service";
import { RuntimeQuotaStatusToolService } from "../src/modules/turns/runtime-quota-status-tool.service";
import { RuntimeScheduledActionToolService } from "../src/modules/turns/runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "../src/modules/turns/runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "../src/modules/turns/runtime-video-generate-tool.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import type {
  FinalizedRuntimeTurn,
  TurnFinalizationService
} from "../src/modules/turns/turn-finalization.service";

const KNOWLEDGE_ACCESS_CONFIG = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: [
    {
      source: "web",
      searchAliasToolCode: "web_search",
      fetchAliasToolCode: "web_fetch",
      searchCredentialToolCode: "web_search",
      fetchCredentialToolCode: "web_fetch"
    },
    {
      source: "memory",
      searchAliasToolCode: "memory_search",
      fetchAliasToolCode: "memory_get",
      searchCredentialToolCode: "memory_search",
      fetchCredentialToolCode: null
    },
    {
      source: "chat",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "preset",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "subscription",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "global",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: [
    {
      toolCode: "browser",
      family: "browser_interaction",
      outcomeKind: "structured_output",
      timeoutMs: 120000,
      confirmationRule: "required_for_mutations",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    },
    {
      toolCode: "image_edit",
      family: "media_generation",
      outcomeKind: "artifact_refs",
      timeoutMs: 180000,
      confirmationRule: "none",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    },
    {
      toolCode: "image_generate",
      family: "media_generation",
      outcomeKind: "artifact_refs",
      timeoutMs: 180000,
      confirmationRule: "none",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    },
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

function createRuntimeTurnRequest(): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "turn-1",
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "bundle-hash-placeholder",
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "hello runtime",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-11T12:00:00.000Z"
    }
  };
}

function createBundleEntry(): RuntimeBundleCacheEntry {
  const artifact = compileAssistantRuntimeBundle({
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
        defaultLocale: "ru-RU",
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
      locale: "en",
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true
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
        browser: {
          refKey: "persai:persai-runtime:tool/browser/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/browser/api-key"
          },
          configured: false,
          providerId: "browserless"
        },
        image_generate: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: false,
          providerId: "openai"
        },
        image_edit: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: false,
          providerId: "openai"
        },
        video_generate: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: false,
          providerId: "openai"
        }
      },
      toolPolicies: [
        {
          toolCode: "summarize_context",
          displayName: "Summarize Context",
          description: "Create a concise shared-context summary for the current session.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "compact_context",
          displayName: "Compact Context",
          description: "Compress earlier session context into durable shared compaction state.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "memory_write",
          displayName: "Memory Write",
          description: "Write one concise durable memory for the current assistant-user pair.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "browser",
          displayName: "Browser",
          description: "Navigate and interact with web pages.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "image_generate",
          displayName: "Image Generate",
          description: "Generate images from text prompts.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "image_edit",
          displayName: "Image Edit",
          description:
            "Edit the current-turn source image from a text prompt with an optional reference image.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "video_generate",
          displayName: "Video Generate",
          description:
            "Generate a short video clip from text with an optional current-turn reference image.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "web_search",
          displayName: "Web Search",
          description: "Search the web.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "web_fetch",
          displayName: "Web Fetch",
          description: "Fetch web pages.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "memory_search",
          displayName: "Memory Search",
          description: "Search memory.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "memory_get",
          displayName: "Memory Fetch",
          description: "Fetch memory entries.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "knowledge_search",
          displayName: "Knowledge Search",
          description:
            "Search assistant-owned or PersAI-owned knowledge and return lightweight references with snippets.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "knowledge_fetch",
          displayName: "Knowledge Fetch",
          description:
            "Fetch one bounded excerpt or transcript window from assistant-owned or PersAI-owned knowledge by referenceId.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "persai_workspace_attach",
          displayName: "Workspace Attach",
          description: "Attach an existing workspace file.",
          kind: "system",
          executionMode: "inline",
          usageRule: "forbidden",
          enabled: false,
          visibleToModel: false,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        },
        {
          toolCode: "quota_status",
          displayName: "Quota Status",
          description: "Read live quota usage.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
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
      soul: "# SOUL\nStay on mission.",
      user: "# USER\nBe mindful of user context.",
      identity: "# IDENTITY\nYou are PersAI.",
      tools: "# TOOLS.md\n- web_search\n- memory_search\n- quota_status",
      agents: "",
      heartbeat: "",
      bootstrap: ""
    },
    promptConstructor: {
      ordinary: {
        sections: {
          assistantIdentity: "Assistant display name: PersAI",
          userIdentity: "User display name: Alex",
          locale: "User locale: en",
          timezone: "User timezone: UTC",
          personaInstructions: "Answer as a concise assistant.",
          soul: "# COMPILED SECTION\nOnly trust compiled prompt constructor output.",
          user: "# USER\nBe mindful of user context.",
          identity: "# IDENTITY\nYou are PersAI.",
          tools:
            "# TOOL RUNTIME\nsummarize_context\ncompact_context\nquota_status\nknowledge_search\nknowledge_fetch",
          agents: "",
          heartbeat: ""
        },
        systemPrompt: [
          "Assistant display name: PersAI",
          "User display name: Alex",
          "User locale: en",
          "User timezone: UTC",
          "Answer as a concise assistant.",
          "# COMPILED SECTION\nOnly trust compiled prompt constructor output.",
          "# TOOL RUNTIME\nsummarize_context\ncompact_context\nquota_status\nknowledge_search\nknowledge_fetch"
        ].join("\n\n")
      },
      onboarding: {
        firstTurnPrompt: "Introduce yourself naturally."
      }
    }
  });

  return {
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: artifact.hash,
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    bundleDocument: artifact.document,
    parsedBundle: artifact.bundle,
    warmedAt: "2026-04-11T12:01:00.000Z"
  };
}

function createAcceptedTurn(): AcceptedRuntimeTurn {
  return {
    outcome: "accepted",
    conversationKey: "conversation-key-1",
    session: {
      sessionId: "session-1",
      conversation: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "web",
        externalThreadKey: "thread-1",
        externalUserKey: "user-1",
        mode: "direct"
      },
      currentTokens: null,
      totalTokensFresh: true,
      compactionCount: 0,
      compactionHintTokens: null,
      providerKey: null,
      modelKey: null,
      updatedAt: "2026-04-11T12:00:00.000Z"
    },
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "accepted",
      bundleHash: "bundle-hash-placeholder",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    },
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    }
  };
}

class FakeRuntimeBundleRegistryService {
  entry: RuntimeBundleCacheEntry | null = createBundleEntry();

  getBundle(): RuntimeBundleCacheEntry | null {
    return this.entry;
  }
}

class FakeProviderGatewayClientService {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  streamCalls: ProviderGatewayTextGenerateRequest[] = [];
  imageEditCalls: ProviderGatewayImageEditRequest[] = [];
  imageGenerateCalls: ProviderGatewayImageGenerateRequest[] = [];
  videoGenerateCalls: Array<{
    input: ProviderGatewayVideoGenerateRequest;
    options?: { timeoutMs?: number };
  }> = [];
  webSearchCalls: ProviderGatewayWebSearchRequest[] = [];
  webFetchCalls: ProviderGatewayWebFetchRequest[] = [];
  browserActionCalls: Array<{
    input: ProviderGatewayBrowserActionRequest;
    options?: { timeoutMs?: number };
  }> = [];
  result: ProviderGatewayTextGenerateResult = {
    provider: "openai",
    model: "gpt-5.4",
    text: "runtime reply",
    respondedAt: "2026-04-11T12:00:02.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    },
    stopReason: "completed",
    toolCalls: []
  };
  resultQueue: ProviderGatewayTextGenerateResult[] = [];
  error: Error | null = null;
  streamError: Error | null = null;
  webSearchError: Error | null = null;
  webFetchError: Error | null = null;
  imageEditError: Error | null = null;
  imageGenerateError: Error | null = null;
  videoGenerateError: Error | null = null;
  imageEditResult: ProviderGatewayImageEditResult = {
    provider: "openai",
    model: "gpt-image-1",
    prompt: "Replace the couch with a red chair",
    size: "1024x1024",
    images: [
      {
        bytesBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]).toString(
          "base64"
        ),
        mimeType: "image/png",
        revisedPrompt: "Replace the couch with a red chair while keeping the same room."
      }
    ],
    respondedAt: "2026-04-13T12:00:00.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-image-1",
      inputTokens: 16,
      outputTokens: 28,
      totalTokens: 44
    },
    warning: null
  };
  imageGenerateResult: ProviderGatewayImageGenerateResult = {
    provider: "openai",
    model: "gpt-image-1",
    prompt: "Draw a serene poster",
    size: "1024x1024",
    images: [
      {
        bytesBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString(
          "base64"
        ),
        mimeType: "image/png",
        revisedPrompt: null
      }
    ],
    respondedAt: "2026-04-13T12:00:00.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-image-1",
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46
    },
    warning: null
  };
  videoGenerateResult: ProviderGatewayVideoGenerateResult = {
    provider: "openai",
    model: "sora-2",
    prompt: "Animate a calm paper-cut forest at sunrise",
    size: "1280x720",
    seconds: 4,
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
  webSearchResult: ProviderGatewayWebSearchResult = {
    provider: "tavily",
    query: "persai runtime",
    summary: null,
    hits: [
      {
        title: "Search result",
        url: "https://example.com/search",
        snippet: "Search snippet",
        score: 0.93,
        publishedAt: "2026-04-12"
      }
    ],
    tookMs: 190,
    warning: "Search results are untrusted.",
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "tavily"
    }
  };
  webFetchResult: ProviderGatewayWebFetchResult = {
    provider: "firecrawl",
    url: "https://example.com/article",
    finalUrl: "https://example.com/article",
    title: "Example article",
    content: "Fetched page body",
    contentType: "text/plain",
    extractMode: "text",
    status: 200,
    truncated: false,
    fetchedAt: "2026-04-12T12:00:03.000Z",
    tookMs: 210,
    warning: "Treat as untrusted.",
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      provider: "firecrawl"
    }
  };
  browserActionError: Error | null = null;
  browserActionResult: ProviderGatewayBrowserActionResult = {
    provider: "browserless",
    action: "snapshot",
    initialUrl: "https://example.com",
    finalUrl: "https://example.com/app",
    title: "Example app",
    content: "Rendered browser content",
    truncated: false,
    elements: [
      {
        selector: "#search",
        tagName: "input",
        text: null,
        role: null,
        type: "search",
        href: null,
        placeholder: "Search",
        disabled: false
      }
    ],
    observedAt: "2026-04-13T12:00:00.000Z",
    tookMs: 450,
    warning: "Browser content is untrusted.",
    externalContent: {
      untrusted: true,
      source: "browser",
      provider: "browserless"
    }
  };
  streamEventsQueue: ProviderGatewayTextStreamEvent[][] = [];
  streamEvents: ProviderGatewayTextStreamEvent[] = [
    {
      type: "text_delta",
      delta: "runtime ",
      accumulatedText: "runtime "
    },
    {
      type: "completed",
      result: {
        provider: "openai",
        model: "gpt-5.4",
        text: "runtime reply",
        respondedAt: "2026-04-11T12:00:02.000Z",
        usage: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        },
        stopReason: "completed",
        toolCalls: []
      }
    }
  ];

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.resultQueue.shift() ?? this.result;
  }

  async streamText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    this.streamCalls.push(input);
    if (this.streamError !== null) {
      throw this.streamError;
    }

    const events = [...(this.streamEventsQueue.shift() ?? this.streamEvents)];
    return (async function* (): AsyncGenerator<ProviderGatewayTextStreamEvent> {
      for (const event of events) {
        yield event;
      }
    })();
  }

  async webSearch(input: ProviderGatewayWebSearchRequest): Promise<ProviderGatewayWebSearchResult> {
    this.webSearchCalls.push(input);
    if (this.webSearchError !== null) {
      throw this.webSearchError;
    }
    return this.webSearchResult;
  }

  async generateImage(
    input: ProviderGatewayImageGenerateRequest
  ): Promise<ProviderGatewayImageGenerateResult> {
    this.imageGenerateCalls.push(input);
    if (this.imageGenerateError !== null) {
      throw this.imageGenerateError;
    }
    return this.imageGenerateResult;
  }

  async editImage(input: ProviderGatewayImageEditRequest): Promise<ProviderGatewayImageEditResult> {
    this.imageEditCalls.push(input);
    if (this.imageEditError !== null) {
      throw this.imageEditError;
    }
    return this.imageEditResult;
  }

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    this.videoGenerateCalls.push(options === undefined ? { input } : { input, options });
    if (this.videoGenerateError !== null) {
      throw this.videoGenerateError;
    }
    const model = input.model ?? this.videoGenerateResult.model;
    return {
      ...this.videoGenerateResult,
      model,
      usage:
        this.videoGenerateResult.usage === null
          ? null
          : {
              ...this.videoGenerateResult.usage,
              modelKey: model
            }
    };
  }

  async webFetch(input: ProviderGatewayWebFetchRequest): Promise<ProviderGatewayWebFetchResult> {
    this.webFetchCalls.push(input);
    if (this.webFetchError !== null) {
      throw this.webFetchError;
    }
    return this.webFetchResult;
  }

  async browserAction(
    input: ProviderGatewayBrowserActionRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayBrowserActionResult> {
    this.browserActionCalls.push(options === undefined ? { input } : { input, options });
    if (this.browserActionError !== null) {
      throw this.browserActionError;
    }
    return this.browserActionResult;
  }
}

class FakeTurnAcceptanceService {
  result: TurnAcceptanceResult = createAcceptedTurn();

  async acceptTurn(): Promise<TurnAcceptanceResult> {
    return this.result;
  }
}

class FakeTurnContextHydrationService {
  messages: ProviderGatewayTextGenerateRequest["messages"] = [
    {
      role: "user",
      content: "hello runtime"
    }
  ];

  async buildMessages(
    ..._args: unknown[]
  ): Promise<ProviderGatewayTextGenerateRequest["messages"]> {
    void _args.length;
    return this.messages;
  }
}

class FakeTurnFinalizationService {
  completed: Array<{ acceptedTurn: AcceptedRuntimeTurn; result: RuntimeTurnResult }> = [];
  failed: Array<{ acceptedTurn: AcceptedRuntimeTurn; code: string; message: string }> = [];

  async completeAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    result: RuntimeTurnResult
  ): Promise<FinalizedRuntimeTurn> {
    this.completed.push({ acceptedTurn, result });
    return {
      receiptStatus: "completed",
      session: acceptedTurn.session,
      leaseReleased: true
    };
  }

  async failAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    event: { code: string; message: string }
  ): Promise<FinalizedRuntimeTurn> {
    this.failed.push({ acceptedTurn, code: event.code, message: event.message });
    return {
      receiptStatus: "failed",
      session: acceptedTurn.session,
      leaseReleased: true
    };
  }
}

class FakePersaiInternalApiClientService {
  consumeCalls: Array<{ assistantId: string; toolCode: string; dailyCallLimit: number }> = [];
  quotaStatusCalls: Array<Record<string, unknown>> = [];
  reminderTaskListCalls: string[] = [];
  reminderTaskControlCalls: Array<Record<string, unknown>> = [];
  memoryWriteCalls: Array<Record<string, unknown>> = [];
  consumeOutcome: ConsumeToolDailyLimitOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 10
  };
  error: Error | null = null;
  reminderTaskListError: Error | null = null;
  reminderTaskControlError: Error | null = null;
  memoryWriteError: Error | null = null;
  reminderTaskItems: Array<{
    id: string;
    title: string;
    audience: "user" | "assistant";
    actionType: string | null;
    controlStatus: "active" | "disabled";
    nextRunAt: string | null;
    externalRef: string | null;
  }> = [];
  reminderTaskControlResult: unknown = {
    ok: true,
    created: true,
    task: {
      id: "task-1",
      title: "Sample reminder",
      audience: "user",
      actionType: null,
      controlStatus: "active",
      nextRunAt: "2026-04-13T12:05:00.000Z"
    }
  };
  memoryWriteOutcome = {
    written: true,
    code: null,
    message: null,
    item: {
      id: "memory-1",
      summary: "User prefers concise answers.",
      kind: "preference" as const,
      sourceLabel: "Memory write: preference",
      createdAt: "2026-04-14T18:45:00.000Z",
      chatId: null
    }
  };
  quotaStatusOutcome: InternalQuotaStatusOutcome = {
    planCode: "paid",
    tools: [
      {
        toolCode: "web_search",
        activationStatus: "active",
        dailyCallLimit: 10,
        currentCount: 1,
        allowed: true
      }
    ],
    buckets: [
      {
        bucketCode: "token_budget",
        displayName: "Token budget",
        unit: "tokens",
        used: 1200,
        limit: 5000,
        percent: 24,
        usageAvailable: true,
        status: "ok"
      }
    ]
  };
  quotaStatusError: Error | null = null;

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    this.consumeCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.consumeOutcome;
  }

  async readQuotaStatus(input: Record<string, unknown>) {
    this.quotaStatusCalls.push(input);
    if (this.quotaStatusError !== null) {
      throw this.quotaStatusError;
    }
    return this.quotaStatusOutcome;
  }

  async listScheduledActions(assistantId: string) {
    this.reminderTaskListCalls.push(assistantId);
    if (this.reminderTaskListError !== null) {
      throw this.reminderTaskListError;
    }
    return this.reminderTaskItems;
  }

  async controlScheduledAction(input: Record<string, unknown>) {
    this.reminderTaskControlCalls.push(input);
    if (this.reminderTaskControlError !== null) {
      throw this.reminderTaskControlError;
    }
    return this.reminderTaskControlResult;
  }

  async writeMemory(input: Record<string, unknown>) {
    this.memoryWriteCalls.push(input);
    if (this.memoryWriteError !== null) {
      throw this.memoryWriteError;
    }
    return this.memoryWriteOutcome;
  }
}

class FakePersaiMediaObjectStorageService {
  saveCalls: Array<{ objectKey: string; mimeType: string; buffer: Buffer }> = [];
  sourceObjects = new Map<string, Buffer>();

  buildRuntimeOutputObjectKey(input: {
    assistantId: string;
    sessionId: string;
    requestId: string;
    artifactId?: string;
    extension: string | null;
  }): string {
    const extension = input.extension ?? "bin";
    return `assistant-media/assistants/${input.assistantId}/runtime-output/sessions/${input.sessionId}/requests/${input.requestId}/${input.artifactId ?? "artifact"}.${extension}`;
  }

  async saveObject(input: {
    objectKey: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ objectKey: string; sizeBytes: number; mimeType: string }> {
    this.saveCalls.push(input);
    return {
      objectKey: input.objectKey,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType
    };
  }

  async downloadObject(objectKey: string): Promise<Buffer | null> {
    return this.sourceObjects.get(objectKey) ?? null;
  }
}

const TEMPORARY_SUMMARY_TEXT = "Stable facts:\n- Temporary summary text";

const TEMPORARY_SUMMARY_PAYLOAD = {
  schema: "persai.runtimeSessionCompaction.v2",
  toolCode: "summarize_context",
  sections: {
    stableFacts: ["Temporary summary text"],
    userPreferences: [],
    assistantCommitments: [],
    openThreads: [],
    importantReferences: []
  },
  summarizedMessageCount: 6,
  preservedRecentMessageCount: 4
};

type RecordedCompactionRequest = RuntimeCompactionRequest & {
  heldLease?: {
    sessionId: string;
    ownerToken: string;
  };
  trigger?: "manual_compaction" | "auto_compaction";
  runtimeRequestId?: string | null;
};

class FakeSessionCompactionService {
  calls: RecordedCompactionRequest[] = [];
  summarizeCalls: RecordedCompactionRequest[] = [];
  onCompact: (() => void) | null = null;
  compactResult: RuntimeCompactionResult = {
    compacted: false,
    reason: "threshold_not_reached",
    tokensBefore: 30,
    tokensAfter: null,
    session: null,
    toolResult: {
      toolCode: "compact_context" as const,
      action: "skipped" as const,
      reason: "threshold_not_reached",
      sessionId: null,
      compactionRecordId: null,
      before: null,
      after: null,
      preservedRecentTurns: 4,
      summaryText: null,
      summaryPayload: null,
      reusableInLaterTurns: false
    }
  };
  summarizeResult: RuntimeCompactionResult = {
    compacted: false,
    reason: "summarized",
    tokensBefore: 30,
    tokensAfter: null,
    session: null,
    toolResult: {
      toolCode: "summarize_context" as const,
      action: "summarized" as const,
      reason: "summarized",
      sessionId: "session-1",
      compactionRecordId: null,
      before: {
        sessionId: "session-1",
        currentTokens: 30,
        compactionCount: 0,
        summarizedMessageCount: 6,
        preservedRecentMessageCount: 4
      },
      after: {
        sessionId: "session-1",
        currentTokens: 30,
        compactionCount: 0,
        summarizedMessageCount: 6,
        preservedRecentMessageCount: 4
      },
      preservedRecentTurns: 4,
      summaryText: TEMPORARY_SUMMARY_TEXT,
      summaryPayload: TEMPORARY_SUMMARY_PAYLOAD,
      reusableInLaterTurns: false
    }
  };

  async compactSession(input: RecordedCompactionRequest) {
    this.calls.push(input);
    this.onCompact?.();
    return this.compactResult;
  }

  async summarizeContext(input: RecordedCompactionRequest) {
    this.summarizeCalls.push(input);
    return this.summarizeResult;
  }
}

async function collectStreamEvents(
  generator: AsyncGenerator<RuntimeTurnStreamEvent>
): Promise<RuntimeTurnStreamEvent[]> {
  const events: RuntimeTurnStreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function flushTaskQueue(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function enableScheduledActionTool(entry: RuntimeBundleCacheEntry | null): void {
  if (entry === null) {
    return;
  }
  if (
    !entry.parsedBundle.runtime.workerTools.tools.some(
      (tool) => tool.toolCode === "scheduled_action"
    )
  ) {
    entry.parsedBundle.runtime.workerTools.tools.push({
      toolCode: "scheduled_action",
      family: "scheduled_action",
      outcomeKind: "state_mutation",
      timeoutMs: 30000,
      confirmationRule: "required_for_mutations",
      supportsProviderRouting: false,
      failureBehavior: "retry_then_surface_error"
    });
  }
  if (
    !entry.parsedBundle.governance.toolPolicies.some((tool) => tool.toolCode === "scheduled_action")
  ) {
    entry.parsedBundle.governance.toolPolicies.push({
      toolCode: "scheduled_action",
      displayName: "Scheduled Action",
      description:
        "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
      kind: "plan",
      executionMode: "worker",
      usageRule: "allowed",
      enabled: true,
      visibleToModel: true,
      visibleInPlanEditor: true,
      dailyCallLimit: null
    });
  }
}

export async function runTurnExecutionServiceTest(): Promise<void> {
  const bundleRegistry = new FakeRuntimeBundleRegistryService();
  const providerGatewayClient = new FakeProviderGatewayClientService();
  const turnContextHydrationService = new FakeTurnContextHydrationService();
  const turnAcceptanceService = new FakeTurnAcceptanceService();
  const turnFinalizationService = new FakeTurnFinalizationService();
  const sessionCompactionService = new FakeSessionCompactionService();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const mediaObjectStorage = new FakePersaiMediaObjectStorageService();
  const runtimeBrowserToolService = new RuntimeBrowserToolService(
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const runtimeImageEditToolService = new RuntimeImageEditToolService(
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as never
  );
  const runtimeImageGenerateToolService = new RuntimeImageGenerateToolService(
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as never
  );
  const runtimeKnowledgeToolService = new RuntimeKnowledgeToolService(
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const runtimeMemoryWriteToolService = new RuntimeMemoryWriteToolService(
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const runtimeQuotaStatusToolService = new RuntimeQuotaStatusToolService(
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const runtimeVideoGenerateToolService = new RuntimeVideoGenerateToolService(
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as never
  );
  const runtimeScheduledActionToolService = new RuntimeScheduledActionToolService(
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );
  const runtimeTtsToolService = new RuntimeTtsToolService(
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as never
  );
  const service = new TurnExecutionService(
    bundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    turnContextHydrationService as unknown as TurnContextHydrationService,
    turnAcceptanceService as unknown as TurnAcceptanceService,
    turnFinalizationService as unknown as TurnFinalizationService,
    sessionCompactionService as never,
    runtimeBrowserToolService,
    runtimeImageEditToolService,
    runtimeImageGenerateToolService,
    runtimeKnowledgeToolService,
    runtimeMemoryWriteToolService,
    runtimeQuotaStatusToolService,
    runtimeScheduledActionToolService,
    runtimeTtsToolService,
    runtimeVideoGenerateToolService
  );

  const request = createRuntimeTurnRequest();
  request.bundle.bundleHash = bundleRegistry.entry?.bundle.bundleHash ?? request.bundle.bundleHash;
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;

  const completed = await service.createTurn(request);
  assert.equal(completed.assistantText, "runtime reply");
  assert.equal(providerGatewayClient.calls.length, 1);
  assert.equal(providerGatewayClient.calls[0]?.provider, "openai");
  assert.equal(providerGatewayClient.calls[0]?.model, "gpt-5.4");
  assert.deepEqual(providerGatewayClient.calls[0]?.messages, turnContextHydrationService.messages);
  assert.deepEqual(providerGatewayClient.calls[0]?.requestMetadata, {
    classification: "main_turn",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 0,
    compactionToolCode: null
  });
  assert.deepEqual(
    providerGatewayClient.calls[0]?.tools?.map((tool) => tool.name),
    [
      "summarize_context",
      "compact_context",
      "memory_write",
      "quota_status",
      "knowledge_search",
      "knowledge_fetch"
    ]
  );
  assert.equal(providerGatewayClient.calls[0]?.toolChoice, "auto");
  assert.match(
    providerGatewayClient.calls[0]?.systemPrompt ?? "",
    /Only trust compiled prompt constructor output/
  );
  assert.match(providerGatewayClient.calls[0]?.systemPrompt ?? "", /summarize_context/);
  assert.match(providerGatewayClient.calls[0]?.systemPrompt ?? "", /compact_context/);
  assert.match(providerGatewayClient.calls[0]?.systemPrompt ?? "", /quota_status/);
  assert.match(providerGatewayClient.calls[0]?.systemPrompt ?? "", /knowledge_search/);
  assert.match(providerGatewayClient.calls[0]?.systemPrompt ?? "", /knowledge_fetch/);
  assert.doesNotMatch(
    providerGatewayClient.calls[0]?.systemPrompt ?? "",
    /web_search|memory_search|browser|persai_workspace_attach|persai_tool_quota_status/
  );
  assert.equal(turnFinalizationService.completed.length, 1);
  assert.equal(turnFinalizationService.failed.length, 0);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  const memoryWriteRequest = createRuntimeTurnRequest();
  memoryWriteRequest.bundle.bundleHash = request.bundle.bundleHash;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:02.500Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-memory-write-1",
          name: "memory_write",
          arguments: {
            kind: "preference",
            memory: "User prefers concise answers."
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after memory write",
      respondedAt: "2026-04-11T12:00:02.900Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const memoryWriteCompleted = await service.createTurn(memoryWriteRequest);
  assert.equal(memoryWriteCompleted.assistantText, "reply after memory write");
  assert.deepEqual(persaiInternalApiClientService.memoryWriteCalls.at(-1), {
    assistantId: "assistant-1",
    kind: "preference",
    summary: "User prefers concise answers.",
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-1"
  });
  const memoryWriteToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    requestedKind?: string;
  };
  assert.equal(memoryWriteToolHistory.action, "remembered");
  assert.equal(memoryWriteToolHistory.requestedKind, "preference");
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  const quotaStatusRequest = createRuntimeTurnRequest();
  quotaStatusRequest.bundle.bundleHash = request.bundle.bundleHash;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:03.100Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-quota-status-1",
          name: "quota_status",
          arguments: {
            toolCode: "web_search"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after quota status",
      respondedAt: "2026-04-11T12:00:03.400Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const quotaStatusCompleted = await service.createTurn(quotaStatusRequest);
  assert.equal(quotaStatusCompleted.assistantText, "reply after quota status");
  assert.deepEqual(persaiInternalApiClientService.quotaStatusCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "web_search"
  });
  const quotaStatusToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    requestedToolCode?: string | null;
    tools?: Array<{ toolCode?: string }>;
    buckets?: Array<{ bucketCode?: string; status?: string }>;
  };
  assert.equal(quotaStatusToolHistory.action, "reported");
  assert.equal(quotaStatusToolHistory.requestedToolCode, "web_search");
  assert.equal(quotaStatusToolHistory.tools?.[0]?.toolCode, "web_search");
  assert.equal(quotaStatusToolHistory.buckets?.[0]?.bucketCode, "token_budget");
  assert.equal(quotaStatusToolHistory.buckets?.length, 1);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  const overrideRequest = createRuntimeTurnRequest();
  overrideRequest.bundle.bundleHash = request.bundle.bundleHash;
  overrideRequest.providerOverride = "anthropic";
  overrideRequest.modelOverride = "claude-sonnet-4-5";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    text: "override reply",
    respondedAt: "2026-04-11T12:00:03.000Z",
    usage: {
      providerKey: "anthropic",
      modelKey: "claude-sonnet-4-5",
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33
    },
    stopReason: "completed",
    toolCalls: []
  };
  const providerCallsBeforeOverride = providerGatewayClient.calls.length;
  const overrideCompleted = await service.createTurn(overrideRequest);
  assert.equal(overrideCompleted.assistantText, "override reply");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeOverride + 1);
  assert.equal(providerGatewayClient.calls.at(-1)?.provider, "anthropic");
  assert.equal(providerGatewayClient.calls.at(-1)?.model, "claude-sonnet-4-5");
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.contextHydration.autoCompactionWeb = true;
  }
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const webAutoCompactionCompleted = await service.createTurn(request);
  assert.equal(webAutoCompactionCompleted.assistantText, "override reply");
  assert.deepEqual(sessionCompactionService.calls.at(-1), {
    runtimeTier: "paid_shared_restricted",
    conversation: request.conversation,
    instructions: null,
    trigger: "auto_compaction",
    runtimeRequestId: "request-1"
  });
  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.contextHydration.autoCompactionWeb = false;
  }

  const telegramRequest = createRuntimeTurnRequest();
  telegramRequest.bundle.bundleHash = request.bundle.bundleHash;
  telegramRequest.conversation = {
    ...telegramRequest.conversation,
    channel: "telegram",
    externalThreadKey: "telegram-thread-1",
    externalUserKey: null,
    mode: "group"
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  (turnAcceptanceService.result as AcceptedRuntimeTurn).session.conversation = {
    ...telegramRequest.conversation
  };
  const telegramCompleted = await service.createTurn(telegramRequest);
  assert.equal(telegramCompleted.assistantText, "override reply");
  await flushTaskQueue();
  assert.deepEqual(sessionCompactionService.calls.at(-1), {
    runtimeTier: "paid_shared_restricted",
    conversation: telegramRequest.conversation,
    instructions: null,
    trigger: "auto_compaction",
    runtimeRequestId: "request-1"
  });

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.contextHydration.autoCompactionTelegram = false;
  }
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  (turnAcceptanceService.result as AcceptedRuntimeTurn).session.conversation = {
    ...telegramRequest.conversation
  };
  await service.createTurn(telegramRequest);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 2);
  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.contextHydration.autoCompactionTelegram = true;
  }

  const providerCallsBeforeManualDurableCompaction = providerGatewayClient.calls.length;
  const compactionCallsBeforeManualDurableCompaction = sessionCompactionService.calls.length;
  const refreshedMessagesAfterCompaction: ProviderGatewayTextGenerateRequest["messages"] = [
    {
      role: "assistant",
      content:
        "[Earlier conversation summary retained by shared compaction]\nStable facts:\n- Durable compacted context."
    },
    {
      role: "user",
      content: "hello runtime"
    }
  ];
  sessionCompactionService.compactResult = {
    compacted: true,
    reason: "compacted",
    tokensBefore: 120,
    tokensAfter: null,
    session: null,
    toolResult: {
      toolCode: "compact_context",
      action: "compacted",
      reason: "compacted",
      sessionId: "session-1",
      compactionRecordId: "compaction-1",
      before: {
        sessionId: "session-1",
        currentTokens: 120,
        compactionCount: 0,
        summarizedMessageCount: 6,
        preservedRecentMessageCount: 2
      },
      after: {
        sessionId: "session-1",
        currentTokens: null,
        compactionCount: 1,
        summarizedMessageCount: 6,
        preservedRecentMessageCount: 2
      },
      preservedRecentTurns: 4,
      summaryText: "Stable facts:\n- Durable compacted context.",
      summaryPayload: {
        schema: "persai.runtimeSessionCompaction.v2",
        toolCode: "compact_context",
        sections: {
          stableFacts: ["Durable compacted context."],
          userPreferences: [],
          assistantCommitments: [],
          openThreads: [],
          importantReferences: []
        },
        summarizedMessageCount: 6,
        preservedRecentMessageCount: 2
      },
      reusableInLaterTurns: true
    }
  };
  sessionCompactionService.onCompact = () => {
    turnContextHydrationService.messages = refreshedMessagesAfterCompaction;
  };
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-11T12:00:04.500Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 40,
        outputTokens: 0,
        totalTokens: 40
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-compact-1",
          name: "compact_context",
          arguments: {}
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "post-compaction reply",
      respondedAt: "2026-04-11T12:00:05.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "pre-compaction full history"
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  (turnAcceptanceService.result as AcceptedRuntimeTurn).session.conversation = {
    ...telegramRequest.conversation
  };
  const manualDurableCompactionTurn = await service.createTurn(telegramRequest);
  assert.equal(manualDurableCompactionTurn.assistantText, "post-compaction reply");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeManualDurableCompaction + 2);
  assert.deepEqual(providerGatewayClient.calls.at(-1)?.messages, refreshedMessagesAfterCompaction);
  assert.deepEqual(providerGatewayClient.calls.at(-1)?.requestMetadata, {
    classification: "tool_loop_followup",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 1,
    compactionToolCode: null
  });
  assert.deepEqual(sessionCompactionService.calls.at(-1), {
    runtimeTier: "paid_shared_restricted",
    conversation: telegramRequest.conversation,
    instructions: null,
    heldLease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    },
    trigger: "manual_compaction",
    runtimeRequestId: "request-1"
  });
  await flushTaskQueue();
  assert.equal(
    sessionCompactionService.calls.length,
    compactionCallsBeforeManualDurableCompaction + 1
  );
  sessionCompactionService.onCompact = null;
  sessionCompactionService.compactResult = {
    compacted: false,
    reason: "threshold_not_reached",
    tokensBefore: 30,
    tokensAfter: null,
    session: null,
    toolResult: {
      toolCode: "compact_context",
      action: "skipped",
      reason: "threshold_not_reached",
      sessionId: null,
      compactionRecordId: null,
      before: null,
      after: null,
      preservedRecentTurns: 4,
      summaryText: null,
      summaryPayload: null,
      reusableInLaterTurns: false
    }
  };
  providerGatewayClient.resultQueue = [];
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "hello runtime"
    }
  ];

  const replayedResult = {
    ...completed,
    assistantText: "cached reply"
  };
  const replayedTurn: ReplayedRuntimeTurn = {
    outcome: "replayed",
    conversationKey: "conversation-key-1",
    session: createAcceptedTurn().session,
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "completed",
      bundleHash: request.bundle.bundleHash,
      resultPayload: replayedResult,
      errorCode: null,
      errorMessage: null,
      completedAt: "2026-04-11T12:00:02.000Z"
    }
  };
  const providerCallsBeforeReplay = providerGatewayClient.calls.length;
  turnAcceptanceService.result = replayedTurn;
  const replayed = await service.createTurn(request);
  assert.equal(replayed.assistantText, "cached reply");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeReplay);

  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.error = new ServiceUnavailableException("gateway down");
  await assert.rejects(() => service.createTurn(request), /gateway down/);
  assert.equal(turnFinalizationService.failed.length, 1);
  assert.equal(turnFinalizationService.failed[0]?.code, "turn_execution_failed");

  providerGatewayClient.error = new BadRequestException(
    "Current-turn file payload is too large for direct model input."
  );
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  await assert.rejects(
    () => service.createTurn(request),
    /Current-turn file payload is too large for direct model input/
  );
  assert.equal(turnFinalizationService.failed.length, 2);
  assert.equal(turnFinalizationService.failed[1]?.code, "native_runtime_request_invalid");

  providerGatewayClient.error = null;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "earlier user"
    },
    {
      role: "assistant",
      content: "earlier assistant"
    },
    {
      role: "user",
      content: "hello runtime"
    }
  ];
  const completedBeforeStream = turnFinalizationService.completed.length;
  const stream = await service.streamTurn(request);
  const streamEvents = await collectStreamEvents(stream);
  assert.deepEqual(
    streamEvents.map((event) => event.type),
    ["started", "text_delta", "completed"]
  );
  assert.equal(providerGatewayClient.streamCalls.length, 1);
  assert.deepEqual(
    providerGatewayClient.streamCalls[0]?.messages,
    turnContextHydrationService.messages
  );
  assert.deepEqual(providerGatewayClient.streamCalls[0]?.requestMetadata, {
    classification: "main_turn",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 0,
    compactionToolCode: null
  });
  assert.deepEqual(
    providerGatewayClient.streamCalls[0]?.tools?.map((tool) => tool.name),
    [
      "summarize_context",
      "compact_context",
      "memory_write",
      "quota_status",
      "knowledge_search",
      "knowledge_fetch"
    ]
  );
  assert.match(
    providerGatewayClient.streamCalls[0]?.systemPrompt ?? "",
    /Only trust compiled prompt constructor output/
  );
  assert.match(providerGatewayClient.streamCalls[0]?.systemPrompt ?? "", /summarize_context/);
  assert.match(providerGatewayClient.streamCalls[0]?.systemPrompt ?? "", /compact_context/);
  assert.match(providerGatewayClient.streamCalls[0]?.systemPrompt ?? "", /quota_status/);
  assert.equal(turnFinalizationService.completed.length, completedBeforeStream + 1);
  const completedEvent = streamEvents[2];
  assert.equal(completedEvent?.type, "completed");
  if (completedEvent?.type === "completed") {
    assert.equal(completedEvent.result.assistantText, "runtime reply");
  }

  providerGatewayClient.streamEventsQueue = [
    [
      {
        type: "text_delta",
        delta: "reply after ",
        accumulatedText: "reply after "
      },
      {
        type: "tool_calls",
        result: {
          provider: "openai",
          model: "gpt-5.4",
          text: "reply after ",
          respondedAt: "2026-04-11T12:00:04.000Z",
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5.4",
            inputTokens: 12,
            outputTokens: 0,
            totalTokens: 12
          },
          stopReason: "tool_calls",
          toolCalls: [
            {
              id: "tool-stream-1",
              name: "summarize_context",
              arguments: {
                instructions: "Preserve open questions."
              }
            }
          ]
        }
      }
    ],
    [
      {
        type: "text_delta",
        delta: "summary",
        accumulatedText: "summary"
      },
      {
        type: "completed",
        result: {
          provider: "openai",
          model: "gpt-5.4",
          text: "summary",
          respondedAt: "2026-04-11T12:00:05.000Z",
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5.4",
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30
          },
          stopReason: "completed",
          toolCalls: []
        }
      }
    ]
  ];
  const summarizeCallsBeforeStreamToolLoop = sessionCompactionService.summarizeCalls.length;
  const streamCallCountBeforeToolLoop = providerGatewayClient.streamCalls.length;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const toolLoopStream = await service.streamTurn(request);
  const toolLoopStreamEvents = await collectStreamEvents(toolLoopStream);
  assert.deepEqual(
    toolLoopStreamEvents.map((event) => event.type),
    ["started", "text_delta", "tool_started", "tool_finished", "text_delta", "completed"]
  );
  assert.equal(providerGatewayClient.streamCalls.length, streamCallCountBeforeToolLoop + 2);
  assert.deepEqual(
    providerGatewayClient.streamCalls.at(-2)?.tools?.map((tool) => tool.name),
    [
      "summarize_context",
      "compact_context",
      "memory_write",
      "quota_status",
      "knowledge_search",
      "knowledge_fetch"
    ]
  );
  assert.equal(providerGatewayClient.streamCalls.at(-1)?.toolHistory?.length, 1);
  assert.deepEqual(providerGatewayClient.streamCalls.at(-1)?.requestMetadata, {
    classification: "tool_loop_followup",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 1,
    compactionToolCode: null
  });
  assert.equal(providerGatewayClient.streamCalls.at(-1)?.messages.at(-1)?.role, "assistant");
  assert.equal(providerGatewayClient.streamCalls.at(-1)?.messages.at(-1)?.content, "reply after");
  assert.equal(
    sessionCompactionService.summarizeCalls.length,
    summarizeCallsBeforeStreamToolLoop + 1
  );
  assert.deepEqual(sessionCompactionService.summarizeCalls.at(-1), {
    runtimeTier: "paid_shared_restricted",
    conversation: createAcceptedTurn().session.conversation,
    instructions: "Preserve open questions.",
    heldLease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    },
    trigger: "manual_compaction",
    runtimeRequestId: "request-1"
  });
  const toolFinishedEvent = toolLoopStreamEvents[3];
  assert.equal(toolFinishedEvent?.type, "tool_finished");
  if (toolFinishedEvent?.type === "tool_finished") {
    assert.equal(toolFinishedEvent.isError, false);
  }
  const streamToolLoopCompletedEvent = toolLoopStreamEvents.at(-1);
  assert.equal(streamToolLoopCompletedEvent?.type, "completed");
  if (streamToolLoopCompletedEvent?.type === "completed") {
    assert.equal(streamToolLoopCompletedEvent.result.assistantText, "reply after summary");
  }

  providerGatewayClient.streamEventsQueue = [
    [
      {
        type: "tool_calls",
        result: {
          provider: "openai",
          model: "gpt-5.4",
          text: "reply before tool ",
          respondedAt: "2026-04-11T12:00:06.000Z",
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5.4",
            inputTokens: 16,
            outputTokens: 0,
            totalTokens: 16
          },
          stopReason: "tool_calls",
          toolCalls: [
            {
              id: "tool-stream-hidden-prefix-1",
              name: "summarize_context",
              arguments: {
                instructions: "Keep the running answer intact."
              }
            }
          ]
        }
      }
    ],
    [
      {
        type: "text_delta",
        delta: "summary",
        accumulatedText: "summary"
      },
      {
        type: "completed",
        result: {
          provider: "openai",
          model: "gpt-5.4",
          text: "summary",
          respondedAt: "2026-04-11T12:00:07.000Z",
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5.4",
            inputTokens: 22,
            outputTokens: 11,
            totalTokens: 33
          },
          stopReason: "completed",
          toolCalls: []
        }
      }
    ]
  ];
  const summarizeCallsBeforeHiddenPrefixToolLoop = sessionCompactionService.summarizeCalls.length;
  const streamCallCountBeforeHiddenPrefixToolLoop = providerGatewayClient.streamCalls.length;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const hiddenPrefixStream = await service.streamTurn(request);
  const hiddenPrefixStreamEvents = await collectStreamEvents(hiddenPrefixStream);
  assert.deepEqual(
    hiddenPrefixStreamEvents.map((event) => event.type),
    ["started", "text_delta", "tool_started", "tool_finished", "text_delta", "completed"]
  );
  assert.equal(
    providerGatewayClient.streamCalls.length,
    streamCallCountBeforeHiddenPrefixToolLoop + 2
  );
  const hiddenPrefixDeltaEvent = hiddenPrefixStreamEvents[1];
  assert.equal(hiddenPrefixDeltaEvent?.type, "text_delta");
  if (hiddenPrefixDeltaEvent?.type === "text_delta") {
    assert.equal(hiddenPrefixDeltaEvent.delta, "reply before tool ");
    assert.equal(hiddenPrefixDeltaEvent.accumulatedText, "reply before tool ");
    assert.equal(hiddenPrefixDeltaEvent.source, "provider_tool_calls_result_text");
  }
  assert.equal(
    providerGatewayClient.streamCalls.at(-1)?.messages.at(-1)?.content,
    "reply before tool"
  );
  assert.equal(
    sessionCompactionService.summarizeCalls.length,
    summarizeCallsBeforeHiddenPrefixToolLoop + 1
  );
  const hiddenPrefixCompletedEvent = hiddenPrefixStreamEvents.at(-1);
  assert.equal(hiddenPrefixCompletedEvent?.type, "completed");
  if (hiddenPrefixCompletedEvent?.type === "completed") {
    assert.equal(hiddenPrefixCompletedEvent.result.assistantText, "reply before tool summary");
  }

  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-11T12:00:04.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 12,
        outputTokens: 0,
        totalTokens: 12
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-1",
          name: "summarize_context",
          arguments: {
            instructions: "Preserve open questions."
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after summary",
      respondedAt: "2026-04-11T12:00:05.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const summarizeCallsBeforeSyncToolLoop = sessionCompactionService.summarizeCalls.length;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const toolLoopCompleted = await service.createTurn(request);
  assert.equal(toolLoopCompleted.assistantText, "reply after summary");
  assert.equal(
    sessionCompactionService.summarizeCalls.length,
    summarizeCallsBeforeSyncToolLoop + 1
  );
  assert.deepEqual(sessionCompactionService.summarizeCalls.at(-1), {
    runtimeTier: "paid_shared_restricted",
    conversation: createAcceptedTurn().session.conversation,
    instructions: "Preserve open questions.",
    heldLease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    },
    trigger: "manual_compaction",
    runtimeRequestId: "request-1"
  });
  assert.equal(providerGatewayClient.calls.at(-1)?.toolHistory?.length, 1);
  assert.deepEqual(providerGatewayClient.calls.at(-1)?.requestMetadata, {
    classification: "tool_loop_followup",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 1,
    compactionToolCode: null
  });
  assert.match(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "",
    /Temporary summary text/
  );

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.web_fetch = {
      refKey: "tool_web_fetch",
      configured: true,
      providerId: "firecrawl",
      secretRef: {
        source: "assistant",
        provider: "tool_web_fetch",
        id: "tool/web_fetch/api-key"
      }
    };
  }
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:04.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-web-fetch-1",
          name: "web_fetch",
          arguments: {
            url: "https://example.com/article",
            extractMode: "text",
            maxChars: 5000
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after fetch",
      respondedAt: "2026-04-12T12:00:05.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 28,
        outputTokens: 12,
        totalTokens: 40
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 10
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const webFetchCompleted = await service.createTurn(request);
  assert.equal(webFetchCompleted.assistantText, "reply after fetch");
  assert.deepEqual(
    providerGatewayClient.calls.at(-2)?.tools?.map((tool) => tool.name),
    [
      "summarize_context",
      "compact_context",
      "memory_write",
      "quota_status",
      "knowledge_search",
      "knowledge_fetch",
      "web_fetch"
    ]
  );
  assert.deepEqual(providerGatewayClient.webFetchCalls.at(-1), {
    url: "https://example.com/article",
    extractMode: "text",
    maxChars: 5000,
    credential: {
      toolCode: "web_fetch",
      secretId: "tool/web_fetch/api-key",
      providerId: "firecrawl"
    }
  });
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "web_fetch",
    dailyCallLimit: 10
  });
  const webFetchToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    reason?: string | null;
    warning?: string | null;
    document?: {
      title?: string | null;
      content?: string | null;
      externalContent?: {
        untrusted?: boolean;
      };
    } | null;
  };
  assert.equal(webFetchToolHistory.action, "fetched");
  assert.equal(webFetchToolHistory.reason, null);
  assert.equal(webFetchToolHistory.warning, "Treat as untrusted.");
  assert.equal(webFetchToolHistory.document?.title, "Example article");
  assert.equal(webFetchToolHistory.document?.content, "Fetched page body");
  assert.equal(webFetchToolHistory.document?.externalContent?.untrusted, true);

  const webFetchCallsBeforeQuotaRejection = providerGatewayClient.webFetchCalls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:06.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-web-fetch-2",
          name: "web_fetch",
          arguments: {
            url: "https://example.com/article"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply without fetch",
      respondedAt: "2026-04-12T12:00:07.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 22,
        outputTokens: 8,
        totalTokens: 30
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: false,
    code: "tool_daily_limit_reached",
    message: "Web fetch daily limit reached."
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const quotaRejectedCompleted = await service.createTurn(request);
  assert.equal(quotaRejectedCompleted.assistantText, "reply without fetch");
  assert.equal(providerGatewayClient.webFetchCalls.length, webFetchCallsBeforeQuotaRejection);
  const quotaRejectedToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    reason?: string | null;
    warning?: string | null;
    document?: unknown;
  };
  assert.equal(quotaRejectedToolHistory.action, "skipped");
  assert.equal(quotaRejectedToolHistory.reason, "tool_daily_limit_reached");
  assert.equal(quotaRejectedToolHistory.warning, "Web fetch daily limit reached.");
  assert.equal(quotaRejectedToolHistory.document ?? null, null);

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.web_search = {
      refKey: "tool_web_search",
      configured: true,
      providerId: "tavily",
      secretRef: {
        source: "assistant",
        provider: "tool_web_search",
        id: "tool/web_search/api-key"
      }
    };
  }
  const providerCallsBeforeWebSearch = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:08.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-web-search-1",
          name: "web_search",
          arguments: {
            query: "persai runtime",
            count: 5
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after search",
      respondedAt: "2026-04-12T12:00:09.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 24,
        outputTokens: 9,
        totalTokens: 33
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 10
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const webSearchCompleted = await service.createTurn(request);
  assert.equal(webSearchCompleted.assistantText, "reply after search");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeWebSearch + 2);
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeWebSearch]?.tools?.some(
      (tool) => tool.name === "web_search"
    ),
    true
  );
  assert.deepEqual(providerGatewayClient.webSearchCalls.at(-1), {
    query: "persai runtime",
    count: 5,
    credential: {
      toolCode: "web_search",
      secretId: "tool/web_search/api-key",
      providerId: "tavily"
    }
  });
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "web_search",
    dailyCallLimit: 10
  });
  const webSearchToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    provider?: string | null;
    query?: string;
    summary?: string | null;
    warning?: string | null;
    hits?: Array<{
      title?: string | null;
      url?: string;
    }>;
    externalContent?: {
      untrusted?: boolean;
      provider?: string;
    } | null;
  };
  assert.equal(webSearchToolHistory.action, "results");
  assert.equal(webSearchToolHistory.provider, "tavily");
  assert.equal(webSearchToolHistory.query, "persai runtime");
  assert.equal(webSearchToolHistory.summary, null);
  assert.equal(webSearchToolHistory.warning, "Search results are untrusted.");
  assert.equal(webSearchToolHistory.hits?.[0]?.title, "Search result");
  assert.equal(webSearchToolHistory.hits?.[0]?.url, "https://example.com/search");
  assert.equal(webSearchToolHistory.externalContent?.untrusted, true);
  assert.equal(webSearchToolHistory.externalContent?.provider, "tavily");

  const webSearchCallsBeforeQuotaRejection = providerGatewayClient.webSearchCalls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:10.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-web-search-2",
          name: "web_search",
          arguments: {
            query: "persai runtime"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply without search",
      respondedAt: "2026-04-12T12:00:11.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 21,
        outputTokens: 7,
        totalTokens: 28
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: false,
    code: "tool_daily_limit_reached",
    message: "Web search daily limit reached."
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const webSearchQuotaRejectedCompleted = await service.createTurn(request);
  assert.equal(webSearchQuotaRejectedCompleted.assistantText, "reply without search");
  assert.equal(providerGatewayClient.webSearchCalls.length, webSearchCallsBeforeQuotaRejection);
  const webSearchQuotaRejectedToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    reason?: string | null;
    warning?: string | null;
    hits?: unknown[];
  };
  assert.equal(webSearchQuotaRejectedToolHistory.action, "skipped");
  assert.equal(webSearchQuotaRejectedToolHistory.reason, "tool_daily_limit_reached");
  assert.equal(webSearchQuotaRejectedToolHistory.warning, "Web search daily limit reached.");
  assert.deepEqual(webSearchQuotaRejectedToolHistory.hits ?? [], []);

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.web_search = {
      refKey: "tool_web_search",
      configured: true,
      providerId: "brave",
      secretRef: {
        source: "assistant",
        provider: "tool_web_search",
        id: "tool/web_search/api-key"
      }
    };
  }
  providerGatewayClient.webSearchResult = {
    ...providerGatewayClient.webSearchResult,
    provider: "brave",
    query: "persai brave",
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "brave"
    }
  };
  const providerCallsBeforeBraveSearch = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:12.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 17,
        outputTokens: 0,
        totalTokens: 17
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-web-search-3",
          name: "web_search",
          arguments: {
            query: "persai brave"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after brave search",
      respondedAt: "2026-04-12T12:00:13.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 24,
        outputTokens: 8,
        totalTokens: 32
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 10
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const braveProviderCompleted = await service.createTurn(request);
  assert.equal(braveProviderCompleted.assistantText, "reply after brave search");
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeBraveSearch]?.tools?.some(
      (tool) => tool.name === "web_search"
    ),
    true
  );
  assert.equal(providerGatewayClient.webSearchCalls.at(-1)?.credential.providerId, "brave");
  const braveProviderToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    provider?: string | null;
    externalContent?: {
      provider?: string;
    } | null;
  };
  assert.equal(braveProviderToolHistory.provider, "brave");
  assert.equal(braveProviderToolHistory.externalContent?.provider, "brave");

  enableScheduledActionTool(bundleRegistry.entry);
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:01.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 14,
        outputTokens: 0,
        totalTokens: 14
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-reminder-create-1",
          name: "scheduled_action",
          arguments: {
            action: "create",
            audience: "user",
            title: "Pay rent",
            delayMs: 300000,
            contextMessages: 2
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after reminder create",
      respondedAt: "2026-04-13T12:00:02.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 19,
        outputTokens: 9,
        totalTokens: 28
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.reminderTaskControlResult = {
    ok: true,
    created: true,
    task: {
      id: "task-reminder-1",
      title: "Pay rent",
      audience: "user",
      actionType: null,
      controlStatus: "active",
      nextRunAt: "2026-04-13T12:05:00.000Z"
    }
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const reminderCreateCompleted = await service.createTurn(request);
  assert.equal(reminderCreateCompleted.assistantText, "reply after reminder create");
  assert.equal(
    providerGatewayClient.calls.at(-2)?.tools?.some((tool) => tool.name === "scheduled_action"),
    true
  );
  assert.deepEqual(persaiInternalApiClientService.reminderTaskControlCalls.at(-1), {
    assistantId: "assistant-1",
    action: "create",
    audience: "user",
    title: "Pay rent",
    reminderText: "Pay rent",
    delayMs: 300000,
    contextMessages: 2,
    conversationContext: {
      channel: "web",
      externalThreadKey: "thread-1"
    }
  });
  const reminderCreateToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    task?: {
      id?: string | null;
      title?: string;
      controlStatus?: string;
      nextRunAt?: string | null;
    } | null;
  };
  assert.equal(reminderCreateToolHistory.action, "created");
  assert.equal(reminderCreateToolHistory.task?.id, "task-reminder-1");
  assert.equal(reminderCreateToolHistory.task?.title, "Pay rent");
  assert.equal(reminderCreateToolHistory.task?.controlStatus, "active");
  assert.equal(reminderCreateToolHistory.task?.nextRunAt, "2026-04-13T12:05:00.000Z");

  persaiInternalApiClientService.reminderTaskItems = [
    {
      id: "task-reminder-1",
      title: "Pay rent",
      audience: "user",
      actionType: null,
      controlStatus: "active",
      nextRunAt: "2026-04-13T12:05:00.000Z",
      externalRef: "job-reminder-1"
    },
    {
      id: "task-reminder-2",
      title: "Stretch break",
      audience: "user",
      actionType: null,
      controlStatus: "disabled",
      nextRunAt: "2026-04-13T13:00:00.000Z",
      externalRef: "job-reminder-2"
    }
  ];
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:03.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 12,
        outputTokens: 0,
        totalTokens: 12
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-reminder-list-1",
          name: "scheduled_action",
          arguments: {
            action: "list"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after reminder list",
      respondedAt: "2026-04-13T12:00:04.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 8,
        totalTokens: 26
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const reminderListCompleted = await service.createTurn(request);
  assert.equal(reminderListCompleted.assistantText, "reply after reminder list");
  assert.equal(persaiInternalApiClientService.reminderTaskListCalls.at(-1), "assistant-1");
  const reminderListToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    items?: Array<{
      id?: string | null;
      title?: string;
      controlStatus?: string;
    }>;
  };
  assert.equal(reminderListToolHistory.action, "listed");
  assert.equal(reminderListToolHistory.items?.length, 2);
  assert.equal(reminderListToolHistory.items?.[0]?.id, "task-reminder-1");
  assert.equal(reminderListToolHistory.items?.[1]?.controlStatus, "disabled");

  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:05.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 12,
        outputTokens: 0,
        totalTokens: 12
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-reminder-pause-1",
          name: "scheduled_action",
          arguments: {
            action: "pause",
            titleMatch: "rent"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after reminder pause",
      respondedAt: "2026-04-13T12:00:06.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 16,
        outputTokens: 7,
        totalTokens: 23
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.reminderTaskControlResult = {
    ok: true,
    paused: true,
    taskId: "task-reminder-1",
    title: "Pay rent"
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const reminderPauseCompleted = await service.createTurn(request);
  assert.equal(reminderPauseCompleted.assistantText, "reply after reminder pause");
  assert.deepEqual(persaiInternalApiClientService.reminderTaskControlCalls.at(-1), {
    assistantId: "assistant-1",
    action: "pause",
    taskId: "task-reminder-1"
  });
  const reminderPauseToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    task?: {
      id?: string | null;
      title?: string;
      controlStatus?: string;
      nextRunAt?: string | null;
    } | null;
  };
  assert.equal(reminderPauseToolHistory.action, "paused");
  assert.equal(reminderPauseToolHistory.task?.id, "task-reminder-1");
  assert.equal(reminderPauseToolHistory.task?.title, "Pay rent");
  assert.equal(reminderPauseToolHistory.task?.controlStatus, "disabled");
  assert.equal(reminderPauseToolHistory.task?.nextRunAt, "2026-04-13T12:05:00.000Z");

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.image_generate = {
      refKey: "persai:persai-runtime:tool/image_generate/api-key",
      configured: true,
      providerId: "openai",
      secretRef: {
        source: "persai",
        provider: "persai-runtime",
        id: "tool/image_generate/api-key"
      }
    };
    const imageGeneratePolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "image_generate"
    );
    if (imageGeneratePolicy) {
      imageGeneratePolicy.dailyCallLimit = 3;
    }
  }
  providerGatewayClient.imageGenerateResult = {
    ...providerGatewayClient.imageGenerateResult,
    prompt: "Draw a serene poster",
    size: "1024x1024"
  };
  const providerCallsBeforeImageGenerate = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:00.500Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 22,
        outputTokens: 0,
        totalTokens: 22
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-image-1",
          name: "image_generate",
          arguments: {
            prompt: "Draw a serene poster",
            count: 1,
            filename: "poster.png",
            size: "1024x1024"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after image",
      respondedAt: "2026-04-13T12:00:01.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 40,
        outputTokens: 14,
        totalTokens: 54
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 3
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const imageGenerateCompleted = await service.createTurn(request);
  assert.equal(imageGenerateCompleted.assistantText, "reply after image");
  assert.equal(imageGenerateCompleted.artifacts.length, 1);
  assert.equal(imageGenerateCompleted.artifacts[0]?.kind, "image");
  assert.equal(
    imageGenerateCompleted.artifacts[0]?.objectKey.includes(
      "/runtime-output/sessions/session-1/requests/request-1/"
    ),
    true
  );
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeImageGenerate + 2);
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeImageGenerate]?.tools?.some(
      (tool) => tool.name === "image_generate"
    ),
    true
  );
  assert.deepEqual(providerGatewayClient.imageGenerateCalls.at(-1), {
    prompt: "Draw a serene poster",
    count: 1,
    size: "1024x1024",
    credential: {
      toolCode: "image_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  });
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "image_generate",
    dailyCallLimit: 3
  });
  assert.equal(mediaObjectStorage.saveCalls.length > 0, true);
  assert.equal(mediaObjectStorage.saveCalls.at(-1)?.mimeType, "image/png");
  const imageGenerateToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    provider?: string | null;
    model?: string | null;
    prompt?: string | null;
    artifacts?: Array<{
      kind?: string;
      filename?: string | null;
    }>;
  };
  assert.equal(imageGenerateToolHistory.action, "generated");
  assert.equal(imageGenerateToolHistory.provider, "openai");
  assert.equal(imageGenerateToolHistory.model, "gpt-image-1");
  assert.equal(imageGenerateToolHistory.prompt, "Draw a serene poster");
  assert.equal(imageGenerateToolHistory.artifacts?.[0]?.kind, "image");
  assert.equal(imageGenerateToolHistory.artifacts?.[0]?.filename, "poster.png");

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.video_generate = {
      refKey: "persai:persai-runtime:tool/image_generate/api-key",
      configured: true,
      providerId: "openai",
      modelKey: "sora-2-pro",
      secretRef: {
        source: "persai",
        provider: "persai-runtime",
        id: "tool/image_generate/api-key"
      }
    };
    const videoGeneratePolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "video_generate"
    );
    if (videoGeneratePolicy) {
      videoGeneratePolicy.dailyCallLimit = 2;
    }
  }
  const videoReferenceBuffer = Buffer.from("video-reference-image");
  request.message.attachments = [
    {
      attachmentId: "attachment-video-reference-1",
      kind: "image",
      objectKey: "assistant-media/uploads/video-reference.png",
      mimeType: "image/png",
      filename: "video-reference.png",
      sizeBytes: videoReferenceBuffer.length
    }
  ];
  mediaObjectStorage.sourceObjects.set(
    "assistant-media/uploads/video-reference.png",
    videoReferenceBuffer
  );
  const providerCallsBeforeVideoGenerate = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-14T12:00:00.500Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-video-1",
          name: "video_generate",
          arguments: {
            prompt: "Animate the attached image into a calm sunrise clip",
            referenceImageIndex: 1,
            filename: "sunrise-clip.mp4",
            size: "1280x720",
            seconds: 4
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after video",
      respondedAt: "2026-04-14T12:00:01.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 36,
        outputTokens: 12,
        totalTokens: 48
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 2
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const videoGenerateCompleted = await service.createTurn(request);
  assert.equal(videoGenerateCompleted.assistantText, "reply after video");
  assert.equal(videoGenerateCompleted.artifacts.length, 1);
  assert.equal(videoGenerateCompleted.artifacts[0]?.kind, "video");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeVideoGenerate + 2);
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeVideoGenerate]?.tools?.some(
      (tool) => tool.name === "video_generate"
    ),
    true
  );
  assert.deepEqual(providerGatewayClient.videoGenerateCalls.at(-1), {
    input: {
      prompt: "Animate the attached image into a calm sunrise clip",
      model: "sora-2-pro",
      size: "1280x720",
      seconds: 4,
      referenceImage: {
        bytesBase64: Buffer.from("video-reference-image").toString("base64"),
        mimeType: "image/png",
        filename: "video-reference.png"
      },
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
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "video_generate",
    dailyCallLimit: 2
  });
  assert.equal(mediaObjectStorage.saveCalls.at(-1)?.mimeType, "video/mp4");
  const videoGenerateToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    provider?: string | null;
    model?: string | null;
    prompt?: string | null;
    referenceImageIndex?: number | null;
    artifact?: {
      kind?: string;
      filename?: string | null;
    } | null;
  };
  assert.equal(videoGenerateToolHistory.action, "generated");
  assert.equal(videoGenerateToolHistory.provider, "openai");
  assert.equal(videoGenerateToolHistory.model, "sora-2-pro");
  assert.equal(
    videoGenerateToolHistory.prompt,
    "Animate the attached image into a calm sunrise clip"
  );
  assert.equal(videoGenerateToolHistory.referenceImageIndex, 1);
  assert.equal(videoGenerateToolHistory.artifact?.kind, "video");
  assert.equal(videoGenerateToolHistory.artifact?.filename, "sunrise-clip.mp4");

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.image_edit = {
      refKey: "persai:persai-runtime:tool/image_generate/api-key",
      configured: true,
      providerId: "openai",
      secretRef: {
        source: "persai",
        provider: "persai-runtime",
        id: "tool/image_generate/api-key"
      }
    };
    const imageEditPolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "image_edit"
    );
    if (imageEditPolicy) {
      imageEditPolicy.dailyCallLimit = 2;
    }
  }
  const referenceImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
  request.message.attachments = [
    {
      attachmentId: "attachment-image-1",
      kind: "image",
      objectKey: "assistant-media/uploads/reference-image.png",
      mimeType: "image/png",
      filename: "living-room.png",
      sizeBytes: referenceImageBuffer.length
    }
  ];
  mediaObjectStorage.sourceObjects.set(
    "assistant-media/uploads/reference-image.png",
    referenceImageBuffer
  );
  const providerCallsBeforeImageEdit = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:00.600Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 20,
        outputTokens: 0,
        totalTokens: 20
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-image-edit-1",
          name: "image_edit",
          arguments: {
            prompt: "Replace the couch with a red chair",
            filename: "living-room-edit.png",
            size: "1024x1024"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after image edit",
      respondedAt: "2026-04-13T12:00:01.100Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 36,
        outputTokens: 15,
        totalTokens: 51
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const imageEditCompleted = await service.createTurn(request);
  assert.equal(imageEditCompleted.assistantText, "reply after image edit");
  assert.equal(imageEditCompleted.artifacts.length, 1);
  assert.equal(imageEditCompleted.artifacts[0]?.kind, "image");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeImageEdit + 2);
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeImageEdit]?.tools?.some(
      (tool) => tool.name === "image_edit"
    ),
    true
  );
  assert.deepEqual(providerGatewayClient.imageEditCalls.at(-1), {
    prompt: "Replace the couch with a red chair",
    size: "1024x1024",
    sourceImage: {
      bytesBase64: referenceImageBuffer.toString("base64"),
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImage: null,
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  });
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "image_edit",
    dailyCallLimit: 2
  });
  const imageEditToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    provider?: string | null;
    model?: string | null;
    prompt?: string | null;
    sourceImageIndex?: number | null;
    referenceImageIndex?: number | null;
    sourceFilename?: string | null;
    referenceFilename?: string | null;
    artifacts?: Array<{
      kind?: string;
      filename?: string | null;
    }>;
  };
  assert.equal(imageEditToolHistory.action, "generated");
  assert.equal(imageEditToolHistory.provider, "openai");
  assert.equal(imageEditToolHistory.model, "gpt-image-1");
  assert.equal(imageEditToolHistory.prompt, "Replace the couch with a red chair");
  assert.equal(imageEditToolHistory.sourceImageIndex, 1);
  assert.equal(imageEditToolHistory.referenceImageIndex, null);
  assert.equal(imageEditToolHistory.sourceFilename, "living-room.png");
  assert.equal(imageEditToolHistory.referenceFilename, null);
  assert.equal(imageEditToolHistory.artifacts?.[0]?.kind, "image");
  assert.equal(imageEditToolHistory.artifacts?.[0]?.filename, "living-room-edit.png");

  const yardImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03]);
  const carImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x04]);
  request.message.attachments = [
    {
      attachmentId: "attachment-image-yard",
      kind: "image",
      objectKey: "assistant-media/uploads/yard-image.png",
      mimeType: "image/png",
      filename: "yard.png",
      sizeBytes: yardImageBuffer.length
    },
    {
      attachmentId: "attachment-image-car",
      kind: "image",
      objectKey: "assistant-media/uploads/car-image.png",
      mimeType: "image/png",
      filename: "car.png",
      sizeBytes: carImageBuffer.length
    }
  ];
  mediaObjectStorage.sourceObjects.set("assistant-media/uploads/yard-image.png", yardImageBuffer);
  mediaObjectStorage.sourceObjects.set("assistant-media/uploads/car-image.png", carImageBuffer);
  providerGatewayClient.imageEditResult = {
    ...providerGatewayClient.imageEditResult,
    prompt: "Place the car from image #2 into the yard in image #1",
    warning: null
  };
  const providerCallsBeforeReferencedImageEdit = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:01.200Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 24,
        outputTokens: 0,
        totalTokens: 24
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-image-edit-2",
          name: "image_edit",
          arguments: {
            prompt: "Place the car from image #2 into the yard in image #1",
            sourceImageIndex: 1,
            referenceImageIndex: 2,
            filename: "yard-with-car.png"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after referenced image edit",
      respondedAt: "2026-04-13T12:00:01.700Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 40,
        outputTokens: 16,
        totalTokens: 56
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const referencedImageEditCompleted = await service.createTurn(request);
  assert.equal(referencedImageEditCompleted.assistantText, "reply after referenced image edit");
  assert.equal(referencedImageEditCompleted.artifacts.length, 1);
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeReferencedImageEdit + 2);
  assert.deepEqual(providerGatewayClient.imageEditCalls.at(-1), {
    prompt: "Place the car from image #2 into the yard in image #1",
    size: null,
    sourceImage: {
      bytesBase64: yardImageBuffer.toString("base64"),
      mimeType: "image/png",
      filename: "yard.png"
    },
    referenceImage: {
      bytesBase64: carImageBuffer.toString("base64"),
      mimeType: "image/png",
      filename: "car.png"
    },
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  });
  const referencedImageEditToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    sourceImageIndex?: number | null;
    referenceImageIndex?: number | null;
    sourceFilename?: string | null;
    referenceFilename?: string | null;
  };
  assert.equal(referencedImageEditToolHistory.action, "generated");
  assert.equal(referencedImageEditToolHistory.sourceImageIndex, 1);
  assert.equal(referencedImageEditToolHistory.referenceImageIndex, 2);
  assert.equal(referencedImageEditToolHistory.sourceFilename, "yard.png");
  assert.equal(referencedImageEditToolHistory.referenceFilename, "car.png");

  providerGatewayClient.imageEditResult = {
    ...providerGatewayClient.imageEditResult,
    prompt: "Restyle image #1 like the second photo",
    warning: null
  };
  const providerCallsBeforeInferredReferenceImageEdit = providerGatewayClient.calls.length;
  const providerImageEditsBeforeInferredReference = providerGatewayClient.imageEditCalls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:01.750Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 26,
        outputTokens: 0,
        totalTokens: 26
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-image-edit-2b",
          name: "image_edit",
          arguments: {
            prompt: "Restyle image #1 like the second photo",
            filename: "yard-restyled.png"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after inferred reference image edit",
      respondedAt: "2026-04-13T12:00:01.780Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 36,
        outputTokens: 14,
        totalTokens: 50
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const inferredReferenceImageEditCompleted = await service.createTurn(request);
  assert.equal(
    inferredReferenceImageEditCompleted.assistantText,
    "reply after inferred reference image edit"
  );
  assert.equal(
    providerGatewayClient.calls.length,
    providerCallsBeforeInferredReferenceImageEdit + 2
  );
  assert.equal(
    providerGatewayClient.imageEditCalls.length,
    providerImageEditsBeforeInferredReference + 1
  );
  assert.deepEqual(providerGatewayClient.imageEditCalls.at(-1), {
    prompt: "Restyle image #1 like the second photo",
    size: null,
    sourceImage: {
      bytesBase64: yardImageBuffer.toString("base64"),
      mimeType: "image/png",
      filename: "yard.png"
    },
    referenceImage: {
      bytesBase64: carImageBuffer.toString("base64"),
      mimeType: "image/png",
      filename: "car.png"
    },
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  });
  const inferredReferenceImageEditToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    sourceImageIndex?: number | null;
    referenceImageIndex?: number | null;
  };
  assert.equal(inferredReferenceImageEditToolHistory.action, "generated");
  assert.equal(inferredReferenceImageEditToolHistory.sourceImageIndex, 1);
  assert.equal(inferredReferenceImageEditToolHistory.referenceImageIndex, 2);

  const providerCallsBeforeAmbiguousImageEdit = providerGatewayClient.calls.length;
  const providerImageEditsBeforeAmbiguous = providerGatewayClient.imageEditCalls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-13T12:00:01.800Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 22,
        outputTokens: 0,
        totalTokens: 22
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-image-edit-3",
          name: "image_edit",
          arguments: {
            prompt: "Place the car into the yard"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "Which image should I edit, image #1 or image #2?",
      respondedAt: "2026-04-13T12:00:02.100Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 34,
        outputTokens: 13,
        totalTokens: 47
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const ambiguousImageEditCompleted = await service.createTurn(request);
  assert.equal(
    ambiguousImageEditCompleted.assistantText,
    "Which image should I edit, image #1 or image #2?"
  );
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeAmbiguousImageEdit + 2);
  assert.equal(providerGatewayClient.imageEditCalls.length, providerImageEditsBeforeAmbiguous);
  const ambiguousImageEditToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    reason?: string | null;
    sourceImageIndex?: number | null;
    referenceImageIndex?: number | null;
  };
  assert.equal(ambiguousImageEditToolHistory.action, "skipped");
  assert.equal(ambiguousImageEditToolHistory.reason, "source_image_selection_required");
  assert.equal(ambiguousImageEditToolHistory.sourceImageIndex, null);
  assert.equal(ambiguousImageEditToolHistory.referenceImageIndex, null);
  request.message.attachments = [];

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.browser = {
      refKey: "persai:persai-runtime:tool/browser/api-key",
      configured: true,
      providerId: "browserless",
      secretRef: {
        source: "persai",
        provider: "persai-runtime",
        id: "tool/browser/api-key"
      }
    };
    const browserPolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "browser"
    );
    if (browserPolicy) {
      browserPolicy.dailyCallLimit = 5;
    }
  }
  providerGatewayClient.browserActionResult = {
    ...providerGatewayClient.browserActionResult,
    action: "act",
    content: "Rendered browser content after click",
    finalUrl: "https://example.com/app/results"
  };
  const providerCallsBeforeBrowser = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: null,
      respondedAt: "2026-04-12T12:00:14.500Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 18,
        outputTokens: 0,
        totalTokens: 18
      },
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-browser-1",
          name: "browser",
          arguments: {
            action: "act",
            url: "https://example.com/app",
            maxChars: 5000,
            operations: [
              {
                kind: "click",
                selector: "#search-button"
              },
              {
                kind: "wait_for_timeout",
                timeoutMs: 250
              }
            ]
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after browser",
      respondedAt: "2026-04-12T12:00:15.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 30,
        outputTokens: 12,
        totalTokens: 42
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 5
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const browserCompleted = await service.createTurn(request);
  assert.equal(browserCompleted.assistantText, "reply after browser");
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeBrowser + 2);
  assert.equal(
    providerGatewayClient.calls[providerCallsBeforeBrowser]?.tools?.some(
      (tool) => tool.name === "browser"
    ),
    true
  );
  assert.deepEqual(providerGatewayClient.browserActionCalls.at(-1), {
    input: {
      action: "act",
      url: "https://example.com/app",
      maxChars: 5000,
      operations: [
        {
          kind: "click",
          selector: "#search-button"
        },
        {
          kind: "wait_for_timeout",
          timeoutMs: 250
        }
      ],
      timeoutMs: 120000,
      credential: {
        toolCode: "browser",
        secretId: "tool/browser/api-key",
        providerId: "browserless"
      }
    },
    options: {
      timeoutMs: 120000
    }
  });
  assert.deepEqual(persaiInternalApiClientService.consumeCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "browser",
    dailyCallLimit: 5
  });
  const browserToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    requestedAction?: string;
    provider?: string | null;
    reason?: string | null;
    warning?: string | null;
    page?: {
      finalUrl?: string;
      content?: string;
      externalContent?: {
        untrusted?: boolean;
        provider?: string;
      };
      elements?: Array<{
        selector?: string;
      }>;
    } | null;
  };
  assert.equal(browserToolHistory.action, "acted");
  assert.equal(browserToolHistory.requestedAction, "act");
  assert.equal(browserToolHistory.provider, "browserless");
  assert.equal(browserToolHistory.reason, null);
  assert.equal(browserToolHistory.warning, "Browser content is untrusted.");
  assert.equal(browserToolHistory.page?.finalUrl, "https://example.com/app/results");
  assert.equal(browserToolHistory.page?.content, "Rendered browser content after click");
  assert.equal(browserToolHistory.page?.elements?.[0]?.selector, "#search");
  assert.equal(browserToolHistory.page?.externalContent?.untrusted, true);
  assert.equal(browserToolHistory.page?.externalContent?.provider, "browserless");

  if (bundleRegistry.entry !== null) {
    const browserPolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "browser"
    );
    if (browserPolicy) {
      browserPolicy.enabled = false;
      browserPolicy.visibleToModel = false;
      browserPolicy.usageRule = "forbidden";
      browserPolicy.dailyCallLimit = null;
    }
  }
  const browserCallsBeforeDisabledPolicy = providerGatewayClient.browserActionCalls.length;
  const providerCallsBeforeDisabledBrowser = providerGatewayClient.calls.length;
  providerGatewayClient.resultQueue = [];
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "runtime reply without projected browser",
    respondedAt: "2026-04-12T12:00:15.500Z",
    usage: null,
    stopReason: "completed",
    toolCalls: []
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const disabledBrowserCompleted = await service.createTurn(request);
  assert.equal(disabledBrowserCompleted.assistantText, "runtime reply without projected browser");
  assert.equal(
    providerGatewayClient.calls.at(-1)?.tools?.some((tool) => tool.name === "browser"),
    false
  );
  assert.equal(providerGatewayClient.browserActionCalls.length, browserCallsBeforeDisabledPolicy);
  assert.equal(providerGatewayClient.calls.length, providerCallsBeforeDisabledBrowser + 1);

  if (bundleRegistry.entry !== null) {
    const browserPolicy = bundleRegistry.entry.parsedBundle.governance.toolPolicies.find(
      (tool) => tool.toolCode === "browser"
    );
    if (browserPolicy) {
      browserPolicy.enabled = true;
      browserPolicy.visibleToModel = true;
      browserPolicy.usageRule = "allowed";
    }
    const browserCredentialRef =
      bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.browser;
    if (browserCredentialRef) {
      browserCredentialRef.configured = false;
    }
  }

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.web_search = {
      refKey: "tool_web_search",
      configured: true,
      providerId: "xai",
      secretRef: {
        source: "assistant",
        provider: "tool_web_search",
        id: "tool/web_search/api-key"
      }
    };
  }
  providerGatewayClient.resultQueue = [];
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "runtime reply without projected web search",
    respondedAt: "2026-04-12T12:00:14.000Z",
    usage: null,
    stopReason: "completed",
    toolCalls: []
  };
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const unsupportedProviderCompleted = await service.createTurn(request);
  assert.equal(
    unsupportedProviderCompleted.assistantText,
    "runtime reply without projected web search"
  );
  assert.equal(
    providerGatewayClient.calls.at(-1)?.tools?.some((tool) => tool.name === "web_search"),
    false
  );
}
