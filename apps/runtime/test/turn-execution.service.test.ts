import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
  buildAssistantRuntimePromptStablePrefix,
  compileAssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
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
  RuntimeOutputArtifact,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import type { RuntimeBundleCacheEntry } from "../src/modules/bundles/bundle.types";
import type { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import { TurnRoutingService } from "../src/modules/turns/turn-routing.service";
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
import type { RuntimeBundleAutoRefreshService } from "../src/modules/turns/runtime-bundle-auto-refresh.service";
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
        modelSlots: {
          normalReply: {
            providerKey: "openai",
            modelKey: "gpt-5.4"
          },
          premiumReply: {
            providerKey: "openai",
            modelKey: "gpt-5.4"
          },
          reasoning: {
            providerKey: "openai",
            modelKey: "gpt-5.4"
          },
          systemTool: {
            providerKey: "openai",
            modelKey: "gpt-4.1"
          },
          retrieval: {
            providerKey: "openai",
            modelKey: "gpt-4.1-mini"
          }
        },
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
      preview: "",
      welcome: ""
    },
    promptConstructor: {
      ordinary: {
        stablePrefix: buildAssistantRuntimePromptStablePrefix(
          [
            "Assistant display name: PersAI",
            "User display name: Alex",
            "User locale: en",
            "User timezone: UTC",
            "Answer as a concise assistant.",
            "# COMPILED SECTION\nOnly trust compiled prompt constructor output.",
            "# TOOL RUNTIME\nsummarize_context\ncompact_context\nquota_status\nknowledge_search\nknowledge_fetch"
          ].join("\n\n")
        ),
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
        previewTurnPrompt: "Show your tone naturally.",
        welcomeTurnPrompt: "Introduce yourself naturally.",
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
  fallbackEntry: RuntimeBundleCacheEntry | null = null;

  getBundle(bundleId: string): RuntimeBundleCacheEntry | null {
    if (this.entry?.bundle.bundleId === bundleId) {
      return this.entry;
    }
    if (this.fallbackEntry?.bundle.bundleId === bundleId) {
      return this.fallbackEntry;
    }
    return null;
  }

  findBundleByAssistantVersion(params: {
    assistantId: string;
    publishedVersionId: string | null;
    bundleHash?: string | null;
  }): RuntimeBundleCacheEntry | null {
    const matches = (entry: RuntimeBundleCacheEntry | null): entry is RuntimeBundleCacheEntry => {
      if (entry === null || params.publishedVersionId === null) {
        return false;
      }
      if (entry.bundle.assistantId !== params.assistantId) {
        return false;
      }
      if (entry.bundle.publishedVersionId !== params.publishedVersionId) {
        return false;
      }
      if (params.bundleHash !== undefined && params.bundleHash !== null) {
        return entry.bundle.bundleHash === params.bundleHash;
      }
      return true;
    };

    return matches(this.entry)
      ? this.entry
      : matches(this.fallbackEntry)
        ? this.fallbackEntry
        : null;
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

  isConfigured(): boolean {
    return true;
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ProviderGatewayTextGenerateResult> {
    void options;
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

  // ADR-074 Slice T1: TurnExecutionService now asks the hydration service
  // to compute the per-turn `presence` developer-tail block. Tests can
  // override this string to assert the developer-tail order
  // (routingGuidance → presence → heartbeat); default is `null` which
  // mirrors a bundle without a presence template (the legacy path).
  presenceBlock: string | null = null;

  async buildMessages(
    ..._args: unknown[]
  ): Promise<ProviderGatewayTextGenerateRequest["messages"]> {
    void _args.length;
    return this.messages;
  }

  async computePresenceBlock(..._args: unknown[]): Promise<string | null> {
    void _args.length;
    return this.presenceBlock;
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
  consumeCalls: Array<{
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number | null;
    units?: number;
  }> = [];
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
    dailyCallLimit: number | null;
    units?: number;
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

  enqueueBackgroundCompactionCalls: Array<Record<string, unknown>> = [];

  async enqueueBackgroundCompaction(input: Record<string, unknown>): Promise<void> {
    this.enqueueBackgroundCompactionCalls.push(input);
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
      reusableInLaterTurns: false,
      usage: null
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
      reusableInLaterTurns: false,
      usage: null
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

class FakeRuntimeSandboxToolService {
  calls: Array<{
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentFileRefs: Array<{ fileRef: string }>;
  }> = [];

  async executeToolCall(input: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentFileRefs: Array<{ fileRef: string }>;
  }) {
    this.calls.push({
      ...input,
      currentFileRefs: [...input.currentFileRefs]
    });
    return {
      payload: {
        toolCode: input.toolCall.name,
        executionMode: "sandbox" as const,
        action: "completed" as const,
        reason: null,
        warning: null,
        fileRefs: ["file-ref-1"],
        job: {
          jobId: "sandbox-job-1",
          status: "completed" as const,
          toolCode: input.toolCall.name,
          reason: null,
          warning: null,
          violationCode: null,
          violationMessage: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null,
          files: [
            {
              relativePath: "outputs/report.txt",
              displayName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 64,
              logicalSizeBytes: 64,
              fileRef: {
                fileRef: "file-ref-1",
                origin: "sandbox_output" as const,
                sourceToolCode: input.toolCall.name,
                objectKey: "assistant-media/sandbox/jobs/sandbox-job-1/report.txt",
                relativePath: "outputs/report.txt",
                displayName: "report.txt",
                mimeType: "text/plain",
                sizeBytes: 64,
                logicalSizeBytes: 64
              }
            }
          ]
        }
      },
      isError: false
    };
  }
}

class FakeRuntimeFilesToolService {
  calls: Array<{
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentArtifacts: RuntimeOutputArtifact[];
    currentFileRefs: Array<{ fileRef: string }>;
    channel: "web" | "telegram" | "max_ru";
  }> = [];

  async executeToolCall(input: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentArtifacts: RuntimeOutputArtifact[];
    currentFileRefs: Array<{ fileRef: string }>;
    channel: "web" | "telegram" | "max_ru";
  }) {
    this.calls.push({
      ...input,
      currentArtifacts: [...input.currentArtifacts],
      currentFileRefs: [...input.currentFileRefs]
    });
    const action = input.toolCall.arguments.action;
    if (action === "write_and_send") {
      return {
        payload: {
          toolCode: "files" as const,
          executionMode: "inline" as const,
          requestedAction: "write_and_send" as const,
          action: "written_and_queued" as const,
          reason: null,
          warning: null,
          content: null,
          item: {
            fileRef: "file-ref-1",
            origin: "sandbox_output" as const,
            sourceToolCode: "files",
            relativePath: "outputs/report.txt",
            displayName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: 64,
            logicalSizeBytes: 64
          },
          items: [
            {
              fileRef: "file-ref-1",
              origin: "sandbox_output" as const,
              sourceToolCode: "files",
              relativePath: "outputs/report.txt",
              displayName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 64,
              logicalSizeBytes: 64
            }
          ],
          job: {
            jobId: "sandbox-job-1",
            status: "completed" as const,
            toolCode: "files",
            reason: null,
            warning: null,
            violationCode: null,
            violationMessage: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null,
            files: [
              {
                relativePath: "outputs/report.txt",
                displayName: "report.txt",
                mimeType: "text/plain",
                sizeBytes: 64,
                logicalSizeBytes: 64,
                fileRef: {
                  fileRef: "file-ref-1",
                  origin: "sandbox_output" as const,
                  sourceToolCode: "files",
                  objectKey: "assistant-media/sandbox/jobs/sandbox-job-1/report.txt",
                  relativePath: "outputs/report.txt",
                  displayName: "report.txt",
                  mimeType: "text/plain",
                  sizeBytes: 64,
                  logicalSizeBytes: 64
                }
              }
            ]
          },
          fileRefs: ["file-ref-1"],
          artifactIds: [],
          queuedArtifacts: 1
        },
        artifacts: [
          {
            artifactId: "artifact-sent-1",
            kind: "file" as const,
            objectKey: "assistant-media/sandbox/jobs/sandbox-job-1/report.txt",
            mimeType: "text/plain",
            filename: "report.txt",
            sizeBytes: 64,
            voiceNote: false,
            caption: "Here is your file"
          }
        ],
        isError: false
      };
    }
    if (action === "send") {
      return {
        payload: {
          toolCode: "files" as const,
          executionMode: "inline" as const,
          requestedAction: "send" as const,
          action: "queued" as const,
          reason: null,
          warning: null,
          item: null,
          items: [],
          content: null,
          job: null,
          fileRefs: ["file-ref-1"],
          artifactIds: [],
          queuedArtifacts: 1
        },
        artifacts: [
          {
            artifactId: "artifact-sent-1",
            kind: "file" as const,
            objectKey: "assistant-media/sandbox/jobs/sandbox-job-1/report.txt",
            mimeType: "text/plain",
            filename: "report.txt",
            sizeBytes: 64,
            voiceNote: false,
            caption: "Here is your file"
          }
        ],
        isError: false
      };
    }
    return {
      payload: {
        toolCode: "files" as const,
        executionMode: "inline" as const,
        requestedAction: "write" as const,
        action: "written" as const,
        reason: null,
        warning: null,
        content: null,
        item: {
          fileRef: "file-ref-1",
          origin: "sandbox_output" as const,
          sourceToolCode: "files",
          relativePath: "outputs/report.txt",
          displayName: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 64,
          logicalSizeBytes: 64
        },
        items: [
          {
            fileRef: "file-ref-1",
            origin: "sandbox_output" as const,
            sourceToolCode: "files",
            relativePath: "outputs/report.txt",
            displayName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: 64,
            logicalSizeBytes: 64
          }
        ],
        fileRefs: ["file-ref-1"],
        artifactIds: [],
        queuedArtifacts: 0,
        job: {
          jobId: "sandbox-job-1",
          status: "completed" as const,
          toolCode: "files",
          reason: null,
          warning: null,
          violationCode: null,
          violationMessage: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          content: null,
          files: [
            {
              relativePath: "outputs/report.txt",
              displayName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 64,
              logicalSizeBytes: 64,
              fileRef: {
                fileRef: "file-ref-1",
                origin: "sandbox_output" as const,
                sourceToolCode: "files",
                objectKey: "assistant-media/sandbox/jobs/sandbox-job-1/report.txt",
                relativePath: "outputs/report.txt",
                displayName: "report.txt",
                mimeType: "text/plain",
                sizeBytes: 64,
                logicalSizeBytes: 64
              }
            }
          ]
        }
      },
      artifacts: [],
      isError: false
    };
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

function computeHydratedStableBlockTokens(
  messages: ProviderGatewayTextGenerateRequest["messages"]
): string[] {
  const tokens: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content !== "string") {
      break;
    }
    const normalized = message.content.trim();
    if (normalized.startsWith("[Durable user context retained across conversations]")) {
      tokens.push(
        `durable_memory_core.v1.${createHash("sha256").update(normalized).digest("hex")}`
      );
      continue;
    }
    if (
      normalized.startsWith(
        "[Rolling session synopsis — what we have established so far in this conversation]"
      )
    ) {
      tokens.push(
        `shared_compaction_summary.v1.${createHash("sha256").update(normalized).digest("hex")}`
      );
      continue;
    }
    if (normalized.startsWith("[Relevant memories retrieved for this turn")) {
      // Contextual durable memory is intentionally excluded from the stable
      // prefix cache key family even when it appears in the prefix walk.
      continue;
    }
    break;
  }
  return tokens;
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

function enableSandboxAndSendMediaTools(entry: RuntimeBundleCacheEntry | null): void {
  if (entry === null) {
    return;
  }
  entry.parsedBundle.runtime.sandbox = {
    enabled: true,
    maxSingleFileWriteBytes: 10 * 1024 * 1024,
    maxWorkspaceBytesPerJob: 25 * 1024 * 1024,
    maxPersistedArtifactsPerJob: 8,
    maxFileCountPerJob: 32,
    maxDirectoryCountPerJob: 16,
    maxProcessRuntimeMs: 15_000,
    maxCpuMsPerJob: 15_000,
    maxMemoryBytesPerJob: 256 * 1024 * 1024,
    maxConcurrentProcesses: 4,
    maxStdoutBytes: 128 * 1024,
    maxStderrBytes: 128 * 1024,
    networkAccessEnabled: false,
    artifactMimeAllowlist: ["text/plain", "image/png"],
    webMaxOutboundBytes: 25 * 1024 * 1024,
    telegramMaxOutboundBytes: 50 * 1024 * 1024,
    sandboxJobsPerDay: null,
    maxArtifactSendCountPerTurn: 4
  };
  for (const tool of [
    {
      toolCode: "files",
      displayName: "Files",
      description: "Search, inspect, read, write, edit, or send assistant-managed files.",
      executionMode: "inline" as const
    },
    {
      toolCode: "shell",
      displayName: "Shell",
      description: "Run a bounded shell command inside the sandbox workspace.",
      executionMode: "sandbox" as const
    }
  ]) {
    if (
      !entry.parsedBundle.governance.toolPolicies.some((item) => item.toolCode === tool.toolCode)
    ) {
      entry.parsedBundle.governance.toolPolicies.push({
        toolCode: tool.toolCode,
        displayName: tool.displayName,
        description: tool.description,
        kind: "plan",
        executionMode: tool.executionMode,
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        visibleInPlanEditor: true,
        dailyCallLimit: null
      });
    }
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
  const runtimeFilesToolService = new FakeRuntimeFilesToolService();
  const runtimeSandboxToolService = new FakeRuntimeSandboxToolService();
  const turnRoutingService = new TurnRoutingService(
    providerGatewayClient as unknown as ProviderGatewayClientService
  );
  const service = new TurnExecutionService(
    bundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    {
      async ensureRequestedBundle() {
        return false;
      }
    } as Pick<
      RuntimeBundleAutoRefreshService,
      "ensureRequestedBundle"
    > as RuntimeBundleAutoRefreshService,
    turnContextHydrationService as unknown as TurnContextHydrationService,
    turnAcceptanceService as unknown as TurnAcceptanceService,
    turnRoutingService,
    turnFinalizationService as unknown as TurnFinalizationService,
    sessionCompactionService as never,
    runtimeBrowserToolService,
    runtimeFilesToolService as never,
    runtimeImageEditToolService,
    runtimeImageGenerateToolService,
    runtimeKnowledgeToolService,
    runtimeMemoryWriteToolService,
    runtimeQuotaStatusToolService,
    runtimeSandboxToolService as never,
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
  assert.equal(completed.usageAccounting?.inputTokens, 10);
  assert.equal(completed.usageAccounting?.outputTokens, 20);
  assert.equal(completed.usageAccounting?.totalTokens, 30);
  assert.equal(completed.usageAccounting?.entries.length, 1);
  assert.equal(completed.usageAccounting?.entries[0]?.stepType, "main_turn");
  assert.equal(completed.usageAccounting?.entries[0]?.modelRole, "normal_reply");
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
  assert.equal(providerGatewayClient.calls[0]?.promptCache?.retention, "in_memory");
  assert.match(
    providerGatewayClient.calls[0]?.promptCache?.key ?? "",
    /^ps1:oc:[a-f0-9]{32}:b\d{2}$/
  );
  assert.ok((providerGatewayClient.calls[0]?.promptCache?.key?.length ?? 0) <= 64);
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

  const compatibleBundleRegistry = new FakeRuntimeBundleRegistryService();
  compatibleBundleRegistry.entry = null;
  const compatibleRefreshCalls: Array<{ bundleId: string; bundleHash: string }> = [];
  const compatibleFallbackService = new TurnExecutionService(
    compatibleBundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    {
      async ensureRequestedBundle(input) {
        compatibleRefreshCalls.push({
          bundleId: input.bundle.bundleId,
          bundleHash: input.bundle.bundleHash
        });
        const refreshedEntry = createBundleEntry();
        refreshedEntry.bundle = {
          ...refreshedEntry.bundle,
          bundleId: "bundle-rematerialized",
          bundleHash: input.bundle.bundleHash,
          publishedVersionId: input.bundle.publishedVersionId
        };
        compatibleBundleRegistry.fallbackEntry = refreshedEntry;
        return true;
      }
    } as Pick<
      RuntimeBundleAutoRefreshService,
      "ensureRequestedBundle"
    > as RuntimeBundleAutoRefreshService,
    turnContextHydrationService as unknown as TurnContextHydrationService,
    turnAcceptanceService as unknown as TurnAcceptanceService,
    turnRoutingService,
    turnFinalizationService as unknown as TurnFinalizationService,
    sessionCompactionService as never,
    runtimeBrowserToolService,
    runtimeFilesToolService as never,
    runtimeImageEditToolService,
    runtimeImageGenerateToolService,
    runtimeKnowledgeToolService,
    runtimeMemoryWriteToolService,
    runtimeQuotaStatusToolService,
    runtimeSandboxToolService as never,
    runtimeScheduledActionToolService,
    runtimeTtsToolService,
    runtimeVideoGenerateToolService
  );
  providerGatewayClient.calls = [];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const compatibleFallbackCompleted = await compatibleFallbackService.createTurn(request);
  assert.equal(compatibleFallbackCompleted.assistantText, "runtime reply");
  assert.deepEqual(compatibleRefreshCalls, [
    {
      bundleId: request.bundle.bundleId,
      bundleHash: request.bundle.bundleHash
    }
  ]);
  assert.equal(compatibleBundleRegistry.fallbackEntry?.bundle.bundleId, "bundle-rematerialized");
  assert.equal(providerGatewayClient.calls.length, 1);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  const staleExactBundleRegistry = new FakeRuntimeBundleRegistryService();
  if (staleExactBundleRegistry.entry !== null) {
    staleExactBundleRegistry.entry.bundle = {
      ...staleExactBundleRegistry.entry.bundle,
      bundleId: request.bundle.bundleId,
      bundleHash: "bundle-hash-stale",
      publishedVersionId: request.bundle.publishedVersionId
    };
  }
  const staleExactRefreshCalls: Array<{ bundleId: string; bundleHash: string }> = [];
  const staleExactFallbackService = new TurnExecutionService(
    staleExactBundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGatewayClient as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    {
      async ensureRequestedBundle(input) {
        staleExactRefreshCalls.push({
          bundleId: input.bundle.bundleId,
          bundleHash: input.bundle.bundleHash
        });
        const refreshedEntry = createBundleEntry();
        refreshedEntry.bundle = {
          ...refreshedEntry.bundle,
          bundleId: "bundle-rematerialized-after-stale-hit",
          bundleHash: input.bundle.bundleHash,
          publishedVersionId: input.bundle.publishedVersionId
        };
        staleExactBundleRegistry.fallbackEntry = refreshedEntry;
        return true;
      }
    } as Pick<
      RuntimeBundleAutoRefreshService,
      "ensureRequestedBundle"
    > as RuntimeBundleAutoRefreshService,
    turnContextHydrationService as unknown as TurnContextHydrationService,
    turnAcceptanceService as unknown as TurnAcceptanceService,
    turnRoutingService,
    turnFinalizationService as unknown as TurnFinalizationService,
    sessionCompactionService as never,
    runtimeBrowserToolService,
    runtimeFilesToolService as never,
    runtimeImageEditToolService,
    runtimeImageGenerateToolService,
    runtimeKnowledgeToolService,
    runtimeMemoryWriteToolService,
    runtimeQuotaStatusToolService,
    runtimeSandboxToolService as never,
    runtimeScheduledActionToolService,
    runtimeTtsToolService,
    runtimeVideoGenerateToolService
  );
  providerGatewayClient.calls = [];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const staleExactFallbackCompleted = await staleExactFallbackService.createTurn(request);
  assert.equal(staleExactFallbackCompleted.assistantText, "runtime reply");
  assert.deepEqual(staleExactRefreshCalls, [
    {
      bundleId: request.bundle.bundleId,
      bundleHash: request.bundle.bundleHash
    }
  ]);
  assert.equal(
    staleExactBundleRegistry.fallbackEntry?.bundle.bundleId,
    "bundle-rematerialized-after-stale-hit"
  );
  assert.equal(providerGatewayClient.calls.length, 1);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  if (bundleRegistry.entry !== null) {
    const runtimeProviderRouting = bundleRegistry.entry.parsedBundle.runtime
      .runtimeProviderRouting as Record<string, unknown>;
    bundleRegistry.entry.parsedBundle.runtime.runtimeProviderRouting = {
      ...runtimeProviderRouting,
      modelSlots: {
        normalReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4"
        },
        premiumReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4-pro"
        },
        reasoning: {
          providerKey: "openai",
          modelKey: "gpt-5.4-thinking"
        },
        systemTool: {
          providerKey: "openai",
          modelKey: "gpt-4.1"
        },
        retrieval: {
          providerKey: "openai",
          modelKey: "gpt-4.1-mini"
        }
      }
    };
  }

  const premiumRequest = createRuntimeTurnRequest();
  premiumRequest.bundle.bundleHash = request.bundle.bundleHash;
  premiumRequest.modelRoleOverride = "premium_reply";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4-pro",
    text: "premium reply",
    respondedAt: "2026-04-11T12:00:02.800Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4-pro",
      inputTokens: 14,
      outputTokens: 26,
      totalTokens: 40
    },
    stopReason: "completed",
    toolCalls: []
  };
  const premiumCompleted = await service.createTurn(premiumRequest);
  assert.equal(premiumCompleted.assistantText, "premium reply");
  assert.equal(providerGatewayClient.calls.at(-1)?.model, "gpt-5.4-pro");
  assert.equal(premiumCompleted.usageAccounting?.entries.at(-1)?.modelRole, "premium_reply");
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.routerPolicy = {
      enabled: true,
      mode: "active",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      precheckRuleOverrides: null
    };
    bundleRegistry.entry.parsedBundle.runtime.routingFastModelKey = "gpt-4.1";
    bundleRegistry.entry.parsedBundle.promptDocuments.routerClassifier =
      "You are the hidden PersAI early router.";
  }
  const chooserRequest = createRuntimeTurnRequest();
  chooserRequest.bundle.bundleHash = request.bundle.bundleHash;
  chooserRequest.message.text =
    "I need help choosing between two rollout options for next month because each changes team coordination, customer communication, and delivery timing, and I have not organized the background clearly enough for a quick default choice yet.";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-4.1",
      text: JSON.stringify({
        executionMode: "reasoning",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: "normal",
        reasonCode: "reasoning_request"
      }),
      respondedAt: "2026-04-11T12:00:02.900Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-4.1",
        inputTokens: 3,
        cachedInputTokens: 1,
        outputTokens: 2,
        totalTokens: 5
      },
      stopReason: "completed",
      toolCalls: []
    },
    {
      provider: "openai",
      model: "gpt-5.4-thinking",
      text: "reasoned reply",
      respondedAt: "2026-04-11T12:00:03.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4-thinking",
        inputTokens: 14,
        outputTokens: 26,
        totalTokens: 40
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const chooserCallOffset = providerGatewayClient.calls.length;
  const chooserCompleted = await service.createTurn(chooserRequest);
  assert.equal(chooserCompleted.assistantText, "reasoned reply");
  assert.equal(
    providerGatewayClient.calls[chooserCallOffset]?.requestMetadata?.classification,
    "turn_routing"
  );
  assert.equal(providerGatewayClient.calls[chooserCallOffset]?.model, "gpt-4.1");
  assert.doesNotMatch(
    String(providerGatewayClient.calls[chooserCallOffset]?.messages[0]?.content ?? ""),
    /Recent conversation tail/
  );
  assert.equal(providerGatewayClient.calls[chooserCallOffset + 1]?.model, "gpt-5.4-thinking");
  // ADR-074 P1: routing guidance lives in `developerInstructions` (out of the cached system prefix).
  assert.match(
    providerGatewayClient.calls[chooserCallOffset + 1]?.developerInstructions ?? "",
    /Selected execution mode: reasoning\./
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[chooserCallOffset + 1]?.systemPrompt ?? "",
    /Selected execution mode: reasoning\./,
    "execution-mode hint must not leak into the cached system prefix"
  );
  assert.equal(
    providerGatewayClient.calls[chooserCallOffset + 1]?.tools?.some(
      (tool) => tool.name === "route_control"
    ),
    false
  );
  assert.equal(chooserCompleted.usageAccounting?.inputTokens, 17);
  assert.equal(chooserCompleted.usageAccounting?.cachedInputTokens, 1);
  assert.equal(chooserCompleted.usageAccounting?.outputTokens, 28);
  assert.equal(chooserCompleted.usageAccounting?.totalTokens, 45);
  assert.equal(
    chooserCompleted.usageAccounting?.entries.some((entry) => entry.stepType === "turn_routing"),
    true
  );
  assert.equal(
    chooserCompleted.usageAccounting?.entries.some((entry) => entry.modelRole === "reasoning"),
    true
  );
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  if (bundleRegistry.entry !== null) {
    const runtimeProviderRouting = bundleRegistry.entry.parsedBundle.runtime
      .runtimeProviderRouting as Record<string, unknown>;
    bundleRegistry.entry.parsedBundle.runtime.runtimeProviderRouting = {
      ...runtimeProviderRouting,
      modelSlots: {
        normalReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4"
        },
        premiumReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4-pro"
        },
        reasoning: {
          providerKey: "openai",
          modelKey: "gpt-5.4-thinking"
        },
        systemTool: {
          providerKey: "openai",
          modelKey: "gpt-4.1"
        },
        retrieval: {
          providerKey: "openai",
          modelKey: "gpt-4.1-mini"
        }
      }
    };
  }
  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.routerPolicy = {
      enabled: true,
      mode: "shadow",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      precheckRuleOverrides: null
    };
  }
  turnContextHydrationService.messages = [
    {
      role: "user",
      content:
        "I need help choosing between two upcoming rollout options because each changes team coordination, customer communication, and delivery timing, and the background is still messy."
    }
  ];
  const deepModeChooserRequest = createRuntimeTurnRequest();
  deepModeChooserRequest.bundle.bundleHash = request.bundle.bundleHash;
  deepModeChooserRequest.deepMode = true;
  deepModeChooserRequest.message.text =
    "I need help choosing between two upcoming rollout options because each changes team coordination, customer communication, and delivery timing, and the background is still messy.";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-4.1",
      text: JSON.stringify({
        executionMode: "reasoning",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: "premium",
        reasonCode: "reasoning_request"
      }),
      respondedAt: "2026-04-11T12:00:03.050Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-4.1",
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6
      },
      stopReason: "completed",
      toolCalls: []
    },
    {
      provider: "openai",
      model: "gpt-5.4-pro",
      text: "deep mode stayed premium",
      respondedAt: "2026-04-11T12:00:03.100Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4-pro",
        inputTokens: 12,
        outputTokens: 18,
        totalTokens: 30
      },
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const deepModeChooserOffset = providerGatewayClient.calls.length;
  const deepModeChooserCompleted = await service.createTurn(deepModeChooserRequest);
  assert.equal(deepModeChooserCompleted.assistantText, "deep mode stayed premium");
  assert.equal(
    providerGatewayClient.calls[deepModeChooserOffset]?.requestMetadata?.classification,
    "turn_routing"
  );
  assert.equal(providerGatewayClient.calls[deepModeChooserOffset + 1]?.model, "gpt-5.4-pro");
  // ADR-074 P1: routing guidance is never injected into the cached system prefix; in deep mode
  // with this fixture the routing block is also expected to be absent from `developerInstructions`.
  assert.doesNotMatch(
    providerGatewayClient.calls[deepModeChooserOffset + 1]?.systemPrompt ?? "",
    /## Early Routing Hints/
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[deepModeChooserOffset + 1]?.developerInstructions ?? "",
    /## Early Routing Hints/
  );
  assert.equal(
    deepModeChooserCompleted.usageAccounting?.entries.some(
      (entry) => entry.stepType === "turn_routing"
    ),
    true
  );
  assert.equal(
    deepModeChooserCompleted.usageAccounting?.entries.some(
      (entry) => entry.modelRole === "premium_reply"
    ),
    true
  );
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  turnContextHydrationService.messages = [
    {
      role: "assistant",
      content: "We are comparing architecture trade-offs and need a careful migration plan."
    },
    {
      role: "user",
      content: "yes"
    }
  ];
  const shortFollowupRequest = createRuntimeTurnRequest();
  shortFollowupRequest.bundle.bundleHash = request.bundle.bundleHash;
  shortFollowupRequest.message.text = "yes";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "short follow-up reply",
    respondedAt: "2026-04-11T12:00:03.100Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 18,
      outputTokens: 30,
      totalTokens: 48
    },
    stopReason: "completed",
    toolCalls: []
  };
  const shortFollowupChooserOffset = providerGatewayClient.calls.length;
  const shortFollowupCompleted = await service.createTurn(shortFollowupRequest);
  assert.equal(shortFollowupCompleted.assistantText, "short follow-up reply");
  assert.equal(providerGatewayClient.calls[shortFollowupChooserOffset]?.model, "gpt-5.4");
  assert.equal(
    providerGatewayClient.calls[shortFollowupChooserOffset]?.requestMetadata?.classification,
    "main_turn"
  );
  assert.equal(providerGatewayClient.calls.length, shortFollowupChooserOffset + 1);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "hello runtime"
    }
  ];

  if (bundleRegistry.entry !== null) {
    const runtimeProviderRouting = bundleRegistry.entry.parsedBundle.runtime
      .runtimeProviderRouting as Record<string, unknown>;
    bundleRegistry.entry.parsedBundle.runtime.runtimeProviderRouting = {
      ...runtimeProviderRouting,
      modelSlots: {
        normalReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4"
        },
        premiumReply: {
          providerKey: "openai",
          modelKey: "gpt-5.4"
        },
        reasoning: {
          providerKey: "openai",
          modelKey: "gpt-5.4"
        },
        systemTool: {
          providerKey: "openai",
          modelKey: "gpt-4.1"
        },
        retrieval: {
          providerKey: "openai",
          modelKey: "gpt-4.1-mini"
        }
      }
    };
    bundleRegistry.entry.parsedBundle.runtime.routerPolicy = {
      enabled: true,
      mode: "active",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      precheckRuleOverrides: null
    };
  }

  const retrievalHintRequest = createRuntimeTurnRequest();
  retrievalHintRequest.bundle.bundleHash = request.bundle.bundleHash;
  retrievalHintRequest.message.text =
    "look in memory and tell me what I asked you to remember about my sleep yesterday.";
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "look in memory and tell me what I asked you to remember about my sleep yesterday."
    }
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "retrieval-aware reply",
    respondedAt: "2026-04-11T12:00:03.250Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 16,
      outputTokens: 24,
      totalTokens: 40
    },
    stopReason: "completed",
    toolCalls: []
  };
  const retrievalHintPlannerOffset = providerGatewayClient.calls.length;
  const retrievalHintCompleted = await service.createTurn(retrievalHintRequest);
  assert.equal(retrievalHintCompleted.assistantText, "retrieval-aware reply");
  assert.equal(providerGatewayClient.calls[retrievalHintPlannerOffset]?.model, "gpt-5.4");
  const retrievalHintToolNames =
    providerGatewayClient.calls[retrievalHintPlannerOffset]?.tools?.map((tool) => tool.name) ?? [];
  assert.equal(retrievalHintToolNames.includes("knowledge_search"), true);
  assert.equal(retrievalHintToolNames.includes("knowledge_fetch"), true);
  // ADR-074 P1: retrieval routing hint travels via `developerInstructions`, not the cached prefix.
  assert.match(
    providerGatewayClient.calls[retrievalHintPlannerOffset]?.developerInstructions ?? "",
    /Assistant knowledge retrieval is likely needed before answering/
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[retrievalHintPlannerOffset]?.systemPrompt ?? "",
    /Assistant knowledge retrieval is likely needed before answering/
  );
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

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
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "what's the current weather in Berlin today?"
    }
  ];
  const liveWebRequest = createRuntimeTurnRequest();
  liveWebRequest.bundle.bundleHash = request.bundle.bundleHash;
  liveWebRequest.message.text = "what's the current weather in Berlin today?";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "live-web-aware reply",
    respondedAt: "2026-04-11T12:00:03.400Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 18,
      outputTokens: 20,
      totalTokens: 38
    },
    stopReason: "completed",
    toolCalls: []
  };
  const liveWebPlannerOffset = providerGatewayClient.calls.length;
  const liveWebCompleted = await service.createTurn(liveWebRequest);
  assert.equal(liveWebCompleted.assistantText, "live-web-aware reply");
  assert.equal(providerGatewayClient.calls[liveWebPlannerOffset]?.model, "gpt-5.4");
  assert.equal(
    providerGatewayClient.calls[liveWebPlannerOffset]?.tools?.some(
      (tool) => tool.name === "web_search"
    ),
    true
  );
  assert.equal(
    providerGatewayClient.calls[liveWebPlannerOffset]?.tools?.some(
      (tool) => tool.name === "knowledge_search"
    ),
    true
  );
  // ADR-074 P1: web tool routing hint also lives in `developerInstructions`.
  assert.match(
    providerGatewayClient.calls[liveWebPlannerOffset]?.developerInstructions ?? "",
    /Fresh external information is likely needed/
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[liveWebPlannerOffset]?.systemPrompt ?? "",
    /Fresh external information is likely needed/
  );
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  if (bundleRegistry.entry !== null) {
    const webSearchCredentialRef =
      bundleRegistry.entry.parsedBundle.governance.toolCredentialRefs.web_search;
    if (webSearchCredentialRef) {
      webSearchCredentialRef.configured = false;
    }
  }
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "what's the current weather in Berlin today?"
    }
  ];
  const unavailableLiveWebRequest = createRuntimeTurnRequest();
  unavailableLiveWebRequest.bundle.bundleHash = request.bundle.bundleHash;
  unavailableLiveWebRequest.message.text = "what's the current weather in Berlin today?";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "openai",
    model: "gpt-5.4",
    text: "weather guidance without web tool",
    respondedAt: "2026-04-11T12:00:03.500Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 14,
      outputTokens: 12,
      totalTokens: 26
    },
    stopReason: "completed",
    toolCalls: []
  };
  const unavailableLiveWebPlannerOffset = providerGatewayClient.calls.length;
  const unavailableLiveWebCompleted = await service.createTurn(unavailableLiveWebRequest);
  assert.equal(unavailableLiveWebCompleted.assistantText, "weather guidance without web tool");
  assert.equal(providerGatewayClient.calls[unavailableLiveWebPlannerOffset]?.model, "gpt-5.4");
  assert.equal(
    providerGatewayClient.calls[unavailableLiveWebPlannerOffset]?.tools?.some(
      (tool) => tool.name === "web_search"
    ),
    false
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[unavailableLiveWebPlannerOffset]?.systemPrompt ?? "",
    /Fresh external information is likely needed/
  );
  assert.doesNotMatch(
    providerGatewayClient.calls[unavailableLiveWebPlannerOffset]?.developerInstructions ?? "",
    /Fresh external information is likely needed/
  );
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "hello runtime"
    }
  ];

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

  enableSandboxAndSendMediaTools(bundleRegistry.entry);
  const sandboxDeliveryRequest = createRuntimeTurnRequest();
  sandboxDeliveryRequest.bundle.bundleHash = request.bundle.bundleHash;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:03.500Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-write-file-1",
          name: "files",
          arguments: {
            action: "write",
            path: "outputs/report.txt",
            content: "sandbox output"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:03.700Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-send-media-1",
          name: "files",
          arguments: {
            action: "send",
            fileRefs: ["file-ref-1"],
            caption: "Here is your file"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after sandbox delivery",
      respondedAt: "2026-04-11T12:00:03.900Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const sandboxDeliveryCompleted = await service.createTurn(sandboxDeliveryRequest);
  assert.equal(sandboxDeliveryCompleted.assistantText, "reply after sandbox delivery");
  assert.equal(runtimeFilesToolService.calls.at(-2)?.toolCall.name, "files");
  assert.equal(runtimeFilesToolService.calls.at(-2)?.toolCall.arguments.action, "write");
  assert.deepEqual(runtimeFilesToolService.calls.at(-2)?.currentFileRefs, []);
  assert.equal(runtimeFilesToolService.calls.at(-1)?.toolCall.name, "files");
  assert.equal(runtimeFilesToolService.calls.at(-1)?.toolCall.arguments.action, "send");
  assert.deepEqual(runtimeFilesToolService.calls.at(-1)?.currentArtifacts, []);
  assert.equal(runtimeFilesToolService.calls.at(-1)?.channel, "web");
  assert.equal(sandboxDeliveryCompleted.artifacts.length, 1);
  assert.equal(sandboxDeliveryCompleted.artifacts[0]?.artifactId, "artifact-sent-1");
  const sandboxToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    job?: { files?: Array<{ fileRef?: { fileRef?: string } }> };
    requestedAction?: string;
  };
  assert.equal(sandboxToolHistory.action, "written");
  assert.equal(sandboxToolHistory.requestedAction, "write");
  assert.equal(sandboxToolHistory.job?.files?.[0]?.fileRef?.fileRef, "file-ref-1");
  const sendMediaToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[1]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    fileRefs?: string[];
    queuedArtifacts?: number;
    requestedAction?: string;
  };
  assert.equal(sendMediaToolHistory.action, "queued");
  assert.equal(sendMediaToolHistory.requestedAction, "send");
  assert.equal(sendMediaToolHistory.fileRefs?.[0], "file-ref-1");
  assert.equal(sendMediaToolHistory.queuedArtifacts, 1);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);

  const atomicSandboxDeliveryRequest = createRuntimeTurnRequest();
  atomicSandboxDeliveryRequest.bundle.bundleHash = request.bundle.bundleHash;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:03.950Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-write-and-send-1",
          name: "files",
          arguments: {
            action: "write_and_send",
            path: "outputs/report.txt",
            content: "sandbox output",
            caption: "Here is your file"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "reply after atomic sandbox delivery",
      respondedAt: "2026-04-11T12:00:04.000Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const atomicSandboxDeliveryCompleted = await service.createTurn(atomicSandboxDeliveryRequest);
  assert.equal(atomicSandboxDeliveryCompleted.assistantText, "reply after atomic sandbox delivery");
  assert.equal(runtimeFilesToolService.calls.at(-1)?.toolCall.name, "files");
  assert.equal(runtimeFilesToolService.calls.at(-1)?.toolCall.arguments.action, "write_and_send");
  assert.deepEqual(runtimeFilesToolService.calls.at(-1)?.currentArtifacts, []);
  assert.equal(atomicSandboxDeliveryCompleted.artifacts.length, 1);
  assert.equal(atomicSandboxDeliveryCompleted.artifacts[0]?.artifactId, "artifact-sent-1");
  const atomicWriteAndSendToolHistory = JSON.parse(
    providerGatewayClient.calls.at(-1)?.toolHistory?.[0]?.toolResult.content ?? "{}"
  ) as {
    action?: string;
    fileRefs?: string[];
    queuedArtifacts?: number;
    requestedAction?: string;
  };
  assert.equal(atomicWriteAndSendToolHistory.action, "written_and_queued");
  assert.equal(atomicWriteAndSendToolHistory.requestedAction, "write_and_send");
  assert.equal(atomicWriteAndSendToolHistory.fileRefs?.[0], "file-ref-1");
  assert.equal(atomicWriteAndSendToolHistory.queuedArtifacts, 1);

  const undeliveredClaimRequest = createRuntimeTurnRequest();
  undeliveredClaimRequest.bundle.bundleHash = request.bundle.bundleHash;
  undeliveredClaimRequest.message.locale = "ru";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "Файл отправлен.",
      respondedAt: "2026-04-11T12:00:04.050Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const undeliveredClaimCompleted = await service.createTurn(undeliveredClaimRequest);
  assert.match(undeliveredClaimCompleted.assistantText, /Файл отправлен\./);
  assert.match(
    undeliveredClaimCompleted.assistantText,
    /Поправка: файл не был реально доставлен в этот чат в рамках этого ответа\./
  );
  assert.equal(undeliveredClaimCompleted.artifacts.length, 0);

  const sandboxWorkspaceContinuityRequest = createRuntimeTurnRequest();
  sandboxWorkspaceContinuityRequest.bundle.bundleHash = request.bundle.bundleHash;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.resultQueue = [
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:04.000Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-write-file-2",
          name: "files",
          arguments: {
            action: "write",
            path: "outputs/report.txt",
            content: "sandbox output"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "",
      respondedAt: "2026-04-11T12:00:04.200Z",
      usage: null,
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "tool-call-shell-1",
          name: "shell",
          arguments: {
            command: "ls outputs"
          }
        }
      ]
    },
    {
      provider: "openai",
      model: "gpt-5.4",
      text: "workspace continuity reply",
      respondedAt: "2026-04-11T12:00:04.400Z",
      usage: null,
      stopReason: "completed",
      toolCalls: []
    }
  ];
  const sandboxWorkspaceContinuityCompleted = await service.createTurn(
    sandboxWorkspaceContinuityRequest
  );
  assert.equal(sandboxWorkspaceContinuityCompleted.assistantText, "workspace continuity reply");
  assert.equal(runtimeFilesToolService.calls.at(-1)?.toolCall.arguments.action, "write");
  assert.equal(runtimeSandboxToolService.calls.at(-1)?.toolCall.name, "shell");
  assert.equal(runtimeSandboxToolService.calls.at(-1)?.currentFileRefs[0]?.fileRef, "file-ref-1");

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
  await flushTaskQueue();
  // ADR-074 M2 — auto-compaction is now enqueued off-band against the
  // API-side scheduler instead of running inline. The runtime never calls
  // `SessionCompactionService` from the post-turn path; it fires
  // `enqueueBackgroundCompaction` and returns immediately.
  assert.equal(sessionCompactionService.calls.length, 0);
  assert.deepEqual(persaiInternalApiClientService.enqueueBackgroundCompactionCalls.at(-1), {
    assistantId: request.conversation.assistantId,
    workspaceId: request.conversation.workspaceId,
    channel: "web",
    externalThreadKey: request.conversation.externalThreadKey,
    externalUserKey: request.conversation.externalUserKey,
    runtimeTier: "paid_shared_restricted",
    trigger: "post_turn",
    enqueuedRequestId: "request-1"
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
  assert.equal(sessionCompactionService.calls.length, 0);
  assert.deepEqual(persaiInternalApiClientService.enqueueBackgroundCompactionCalls.at(-1), {
    assistantId: telegramRequest.conversation.assistantId,
    workspaceId: telegramRequest.conversation.workspaceId,
    channel: "telegram",
    externalThreadKey: telegramRequest.conversation.externalThreadKey,
    externalUserKey: telegramRequest.conversation.externalUserKey,
    runtimeTier: "paid_shared_restricted",
    trigger: "post_turn",
    enqueuedRequestId: "request-1"
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
  const enqueueCallsBeforeTelegramOff =
    persaiInternalApiClientService.enqueueBackgroundCompactionCalls.length;
  await service.createTurn(telegramRequest);
  await flushTaskQueue();
  assert.equal(sessionCompactionService.calls.length, 0);
  assert.equal(
    persaiInternalApiClientService.enqueueBackgroundCompactionCalls.length,
    enqueueCallsBeforeTelegramOff
  );
  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.contextHydration.autoCompactionTelegram = true;
  }

  const providerCallsBeforeManualDurableCompaction = providerGatewayClient.calls.length;
  const compactionCallsBeforeManualDurableCompaction = sessionCompactionService.calls.length;
  const refreshedMessagesAfterCompaction: ProviderGatewayTextGenerateRequest["messages"] = [
    {
      role: "assistant",
      content:
        "[Durable user context retained across conversations]\n- User prefers concise status updates."
    },
    {
      role: "assistant",
      content:
        "[Rolling session synopsis — what we have established so far in this conversation]\nStable facts:\n- Durable compacted context."
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
      reusableInLaterTurns: true,
      usage: null
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
  const hydratedStableBlockTokens = computeHydratedStableBlockTokens(
    refreshedMessagesAfterCompaction
  );
  assert.equal(hydratedStableBlockTokens.length, 2);
  assert.match(
    providerGatewayClient.calls.at(-1)?.promptCache?.key ?? "",
    /^ps1:oc:[a-f0-9]{32}:b\d{2}$/
  );
  assert.ok((providerGatewayClient.calls.at(-1)?.promptCache?.key?.length ?? 0) <= 64);
  assert.notEqual(
    providerGatewayClient.calls.at(-1)?.promptCache?.key,
    providerGatewayClient.calls.at(-2)?.promptCache?.key
  );
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
      reusableInLaterTurns: false,
      usage: null
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
  assert.equal(providerGatewayClient.streamCalls[0]?.promptCache?.retention, "in_memory");
  assert.match(
    providerGatewayClient.streamCalls[0]?.promptCache?.key ?? "",
    /^ps1:oc:[a-f0-9]{32}:b\d{2}$/
  );
  assert.ok((providerGatewayClient.streamCalls[0]?.promptCache?.key?.length ?? 0) <= 64);
  assert.deepEqual(
    providerGatewayClient.streamCalls[0]?.tools?.map((tool) => tool.name),
    [
      "summarize_context",
      "compact_context",
      "memory_write",
      "quota_status",
      "knowledge_search",
      "knowledge_fetch",
      "files",
      "shell"
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
    assert.equal(completedEvent.result.trace?.scope, "stream_turn");
    assert.equal(completedEvent.result.trace?.status, "ok");
    assert.ok(
      completedEvent.result.trace?.stages.some((stage) =>
        stage.key.includes("prepare.provider_request_built")
      )
    );
    assert.ok(
      completedEvent.result.trace?.stages.some((stage) => stage.key.includes("first_text_delta"))
    );
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
      "knowledge_fetch",
      "files",
      "shell"
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
      "web_fetch",
      "files",
      "shell"
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
            kind: "user_reminder",
            title: "Pay rent",
            reminderText: "Pay rent",
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
    kind: "user_reminder",
    title: "Pay rent",
    reminderText: "Pay rent",
    contextSessionKey: "thread-1",
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
    dailyCallLimit: 3,
    // ADR-074 L1.1: image_generate now sends `units = count` so the
    // daily counter advances per produced artifact, not per call.
    units: 1
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

  // ── ADR-074 Slice L1 — adaptive tool loop limits per execution mode ──
  // These three integration scenarios assert the runtime wiring of
  // `ToolBudgetPolicy`. The policy itself is unit-tested separately in
  // `tool-budget-policy.test.ts`; these tests pin the *pipeline* end-to-end
  // (provider tool call → budget reservation → synthesized
  // `tool_budget_exhausted` outcome → next-iteration model wrap-up).
  // Failure messages name the L1 bug class so a future regression points
  // straight at the right slice.

  // Re-seed credentials so web_fetch is projected and executable, since the
  // earlier web_search test stripped surrounding state.
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

  const buildWebFetchToolCallsResult = (
    callIds: readonly string[],
    respondedAt: string
  ): ProviderGatewayTextGenerateResult => ({
    provider: "openai",
    model: "gpt-5.4",
    text: null,
    respondedAt,
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 18,
      outputTokens: 0,
      totalTokens: 18
    },
    stopReason: "tool_calls",
    toolCalls: callIds.map<ProviderGatewayToolCall>((callId) => ({
      id: callId,
      name: "web_fetch",
      arguments: {
        url: "https://example.com/article",
        extractMode: "text",
        maxChars: 5000
      }
    }))
  });
  const buildCompletionResult = (
    text: string,
    respondedAt: string
  ): ProviderGatewayTextGenerateResult => ({
    provider: "openai",
    model: "gpt-5.4",
    text,
    respondedAt,
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 22,
      outputTokens: 8,
      totalTokens: 30
    },
    stopReason: "completed",
    toolCalls: []
  });

  // ── L1 Test 1 — normal mode loop limit (loopLimit=3, ADR-074 F4) ──
  // Model emits one web_fetch per iteration. In normal mode the loop
  // budget allows iterations 0..2 to actually execute the tool; the
  // 4th iteration must be rejected with `tool_budget_exhausted` /
  // `loop_limit` and the model must get a wrap-up iteration to reply
  // honestly. Pre-L1 this would have either kept executing up to 4
  // iterations (universal MAX_NATIVE_TOOL_LOOP_ITERATIONS) or failed
  // the whole turn with `native_tool_loop_exhausted`. F4 raised normal
  // from 2 → 3 to give one self-repair iteration after invalid_arguments.
  persaiInternalApiClientService.consumeOutcome = {
    allowed: true,
    currentCount: 1,
    limit: 10
  };
  const webFetchCallsBeforeNormalLoop = providerGatewayClient.webFetchCalls.length;
  providerGatewayClient.resultQueue = [
    buildWebFetchToolCallsResult(["l1-loop-1"], "2026-04-13T12:00:00.000Z"),
    buildWebFetchToolCallsResult(["l1-loop-2"], "2026-04-13T12:00:01.000Z"),
    buildWebFetchToolCallsResult(["l1-loop-3"], "2026-04-13T12:00:02.000Z"),
    buildWebFetchToolCallsResult(["l1-loop-4"], "2026-04-13T12:00:03.000Z"),
    buildCompletionResult("normal-mode wrap-up reply", "2026-04-13T12:00:04.000Z")
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const normalLoopLimitCompleted = await service.createTurn(request);
  assert.equal(
    normalLoopLimitCompleted.assistantText,
    "normal-mode wrap-up reply",
    "ADR-074 F4 regression: after the loop budget is exhausted in normal mode the model must still get a wrap-up iteration and reply honestly (got no completion text)."
  );
  assert.equal(
    providerGatewayClient.webFetchCalls.length - webFetchCallsBeforeNormalLoop,
    3,
    "ADR-074 F4 regression: normal-mode loopLimit=3 must allow exactly 3 real web_fetch executions (got a different count — either the limit regressed or the budget policy did not skip the 4th call)."
  );
  const normalLoopExhaustedHistory = providerGatewayClient.calls.at(-1)?.toolHistory ?? [];
  const normalLoopExhaustedEntry = normalLoopExhaustedHistory.find((entry) =>
    entry.toolResult.content.includes('"reason":"tool_budget_exhausted"')
  );
  assert.ok(
    normalLoopExhaustedEntry !== undefined,
    "ADR-074 L1 regression: the wrap-up iteration must include a synthetic tool_budget_exhausted entry in toolHistory so the model can read why it was cut off."
  );
  if (normalLoopExhaustedEntry !== undefined) {
    const parsed = JSON.parse(normalLoopExhaustedEntry.toolResult.content) as {
      toolCode?: string;
      reason?: string;
      budgetReason?: string;
      limit?: number;
      observed?: number;
      action?: string;
    };
    assert.equal(parsed.toolCode, "web_fetch");
    assert.equal(parsed.reason, "tool_budget_exhausted");
    assert.equal(
      parsed.budgetReason,
      "loop_limit",
      "ADR-074 F4 regression: normal-mode iteration past loopLimit=3 must report budgetReason=loop_limit (NOT per_tool_cap — web_fetch cap=5 is not the limiter here)."
    );
    assert.equal(parsed.limit, 3);
    assert.equal(parsed.observed, 4);
    assert.equal(parsed.action, "skipped");
  }
  await flushTaskQueue();

  // ── L1 Test 2 — per-tool cap fires inside a single iteration ──
  // Model emits 6 web_fetch calls in one turn iteration. web_fetch has a
  // per-turn hard cap of 5, so the first 5 must execute and the 6th must
  // be substituted with `tool_budget_exhausted` / `per_tool_cap`. This
  // exercises the per-call (not per-iteration) branch of the policy. The
  // loop budget (loopLimit=3 in normal mode after ADR-074 F4) is *not*
  // the limiter here — we are inside a single iteration, iteration index 0.
  const webFetchCallsBeforePerToolCap = providerGatewayClient.webFetchCalls.length;
  providerGatewayClient.resultQueue = [
    buildWebFetchToolCallsResult(
      ["l1-cap-1", "l1-cap-2", "l1-cap-3", "l1-cap-4", "l1-cap-5", "l1-cap-6"],
      "2026-04-13T12:00:10.000Z"
    ),
    buildCompletionResult("per-tool-cap wrap-up reply", "2026-04-13T12:00:11.000Z")
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const perToolCapCompleted = await service.createTurn(request);
  assert.equal(
    perToolCapCompleted.assistantText,
    "per-tool-cap wrap-up reply",
    "ADR-074 L1 regression: after the per-tool cap is hit the model must still get a wrap-up iteration to reply honestly."
  );
  assert.equal(
    providerGatewayClient.webFetchCalls.length - webFetchCallsBeforePerToolCap,
    5,
    "ADR-074 L1 regression: web_fetch per-turn cap=5 must allow exactly 5 real executions out of 6 emitted tool calls in a single iteration (got a different count)."
  );
  const perToolCapHistory = providerGatewayClient.calls.at(-1)?.toolHistory ?? [];
  assert.equal(
    perToolCapHistory.length,
    6,
    "ADR-074 L1 regression: every emitted tool call in the iteration must produce a toolHistory entry, including the 6th (synthesized tool_budget_exhausted)."
  );
  const perToolCapExhaustedEntries = perToolCapHistory.filter((entry) =>
    entry.toolResult.content.includes('"reason":"tool_budget_exhausted"')
  );
  assert.equal(
    perToolCapExhaustedEntries.length,
    1,
    "ADR-074 L1 regression: exactly one of the six toolHistory entries must be tool_budget_exhausted (got a different count — either the cap fired more than once per turn or it never fired)."
  );
  const perToolCapPayload = JSON.parse(
    perToolCapExhaustedEntries[0]?.toolResult.content ?? "{}"
  ) as {
    budgetReason?: string;
    limit?: number;
    observed?: number;
  };
  assert.equal(
    perToolCapPayload.budgetReason,
    "per_tool_cap",
    "ADR-074 L1 regression: 6th web_fetch in one iteration must be rejected as per_tool_cap (NOT loop_limit — iteration 0 is well inside the loop budget)."
  );
  assert.equal(perToolCapPayload.limit, 5);
  assert.equal(perToolCapPayload.observed, 6);
  await flushTaskQueue();

  // ── L1 Test 3 — premium mode allows more iterations than normal ──
  // With deepMode=true the routing service resolves executionMode=premium
  // (loopLimit=4). 5 sequential web_fetch iterations should produce 4
  // real executions + a 5th iteration that is loop-limit-exhausted, then
  // a wrap-up iteration where the model replies. This proves the limit
  // is mode-aware and is not stuck at the old universal value of 4
  // executions in every mode (premium=4 happens to coincide with the
  // pre-L1 universal cap, but the assertions here would fail if we
  // accidentally clamped premium back down to 2).
  if (bundleRegistry.entry !== null) {
    // Premium needs the gpt-5.4-pro slot configured; restore it from the
    // earlier test in case any later block mutated it.
    const runtimeProviderRouting = bundleRegistry.entry.parsedBundle.runtime
      .runtimeProviderRouting as Record<string, unknown>;
    bundleRegistry.entry.parsedBundle.runtime.runtimeProviderRouting = {
      ...runtimeProviderRouting,
      modelSlots: {
        normalReply: { providerKey: "openai", modelKey: "gpt-5.4" },
        premiumReply: { providerKey: "openai", modelKey: "gpt-5.4-pro" },
        reasoning: { providerKey: "openai", modelKey: "gpt-5.4-thinking" },
        systemTool: { providerKey: "openai", modelKey: "gpt-4.1" },
        retrieval: { providerKey: "openai", modelKey: "gpt-4.1-mini" }
      }
    };
  }
  const buildPremiumWebFetchToolCallsResult = (
    callIds: readonly string[],
    respondedAt: string
  ): ProviderGatewayTextGenerateResult => ({
    ...buildWebFetchToolCallsResult(callIds, respondedAt),
    model: "gpt-5.4-pro"
  });
  const buildPremiumCompletionResult = (
    text: string,
    respondedAt: string
  ): ProviderGatewayTextGenerateResult => ({
    ...buildCompletionResult(text, respondedAt),
    model: "gpt-5.4-pro"
  });
  const premiumLoopRequest = createRuntimeTurnRequest();
  premiumLoopRequest.bundle.bundleHash = request.bundle.bundleHash;
  premiumLoopRequest.deepMode = true;
  const webFetchCallsBeforePremiumLoop = providerGatewayClient.webFetchCalls.length;
  providerGatewayClient.resultQueue = [
    buildPremiumWebFetchToolCallsResult(["l1-premium-1"], "2026-04-13T12:00:20.000Z"),
    buildPremiumWebFetchToolCallsResult(["l1-premium-2"], "2026-04-13T12:00:21.000Z"),
    buildPremiumWebFetchToolCallsResult(["l1-premium-3"], "2026-04-13T12:00:22.000Z"),
    buildPremiumWebFetchToolCallsResult(["l1-premium-4"], "2026-04-13T12:00:23.000Z"),
    buildPremiumWebFetchToolCallsResult(["l1-premium-5"], "2026-04-13T12:00:24.000Z"),
    buildPremiumCompletionResult("premium wrap-up reply", "2026-04-13T12:00:25.000Z")
  ];
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  const premiumLoopCompleted = await service.createTurn(premiumLoopRequest);
  assert.equal(
    premiumLoopCompleted.assistantText,
    "premium wrap-up reply",
    "ADR-074 L1 regression: premium-mode turn must wrap up gracefully after the loop budget is hit."
  );
  assert.equal(
    providerGatewayClient.webFetchCalls.length - webFetchCallsBeforePremiumLoop,
    4,
    "ADR-074 L1 regression: premium-mode loopLimit=4 must allow exactly 4 real web_fetch executions (got a different count — either the per-mode lookup is broken or premium silently fell back to normal)."
  );
  const premiumLoopExhaustedEntry = (providerGatewayClient.calls.at(-1)?.toolHistory ?? []).find(
    (entry) => entry.toolResult.content.includes('"reason":"tool_budget_exhausted"')
  );
  assert.ok(
    premiumLoopExhaustedEntry !== undefined,
    "ADR-074 L1 regression: 5th web_fetch iteration in premium mode must be substituted with tool_budget_exhausted before the wrap-up reply."
  );
  if (premiumLoopExhaustedEntry !== undefined) {
    const parsed = JSON.parse(premiumLoopExhaustedEntry.toolResult.content) as {
      budgetReason?: string;
      limit?: number;
      observed?: number;
    };
    assert.equal(
      parsed.budgetReason,
      "loop_limit",
      "ADR-074 L1 regression: premium iteration past loopLimit=4 must report budgetReason=loop_limit (per-tool cap of 5 is not the limiter at iteration 4)."
    );
    assert.equal(parsed.limit, 4);
    assert.equal(parsed.observed, 5);
  }
  await flushTaskQueue();

  // ── L1 Test 4 — per-assistant bundle override of loopLimitByMode ──
  // Founder Q9-C revision (2026-04-23): the limits must be tunable per
  // assistant (different plans/models ship different numbers). The bundle
  // here pretends to be such an assistant by setting
  // `runtime.toolBudgets.loopLimitByMode.normal = 5`. With the override in
  // place, normal mode must allow 5 real iterations (not the code default
  // of 3 after ADR-074 F4) before the synthetic tool_budget_exhausted fires
  // on iteration 6.
  // This pins the wiring from the bundle through `createToolBudgetPolicy`
  // into the actual loop bound.
  if (bundleRegistry.entry !== null) {
    bundleRegistry.entry.parsedBundle.runtime.toolBudgets = {
      loopLimitByMode: {
        normal: 5,
        premium: null,
        reasoning: null
      }
    };
  }
  try {
    const overrideRequest = createRuntimeTurnRequest();
    overrideRequest.bundle.bundleHash = request.bundle.bundleHash;
    const webFetchCallsBeforeOverride = providerGatewayClient.webFetchCalls.length;
    providerGatewayClient.resultQueue = [
      buildWebFetchToolCallsResult(["l1-override-1"], "2026-04-13T12:00:30.000Z"),
      buildWebFetchToolCallsResult(["l1-override-2"], "2026-04-13T12:00:31.000Z"),
      buildWebFetchToolCallsResult(["l1-override-3"], "2026-04-13T12:00:32.000Z"),
      buildWebFetchToolCallsResult(["l1-override-4"], "2026-04-13T12:00:33.000Z"),
      buildWebFetchToolCallsResult(["l1-override-5"], "2026-04-13T12:00:34.000Z"),
      buildWebFetchToolCallsResult(["l1-override-6"], "2026-04-13T12:00:35.000Z"),
      buildCompletionResult("override wrap-up reply", "2026-04-13T12:00:36.000Z")
    ];
    turnAcceptanceService.result = createAcceptedTurn();
    (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
      request.bundle.bundleHash;
    const overrideCompleted = await service.createTurn(overrideRequest);
    assert.equal(
      overrideCompleted.assistantText,
      "override wrap-up reply",
      "ADR-074 L1 regression: per-assistant loopLimit override must still allow a wrap-up reply after the override budget is exhausted."
    );
    assert.equal(
      providerGatewayClient.webFetchCalls.length - webFetchCallsBeforeOverride,
      5,
      "ADR-074 L1 regression: bundle override loopLimitByMode.normal=5 must allow exactly 5 real web_fetch executions (got a different count — the runtime is ignoring the bundle override and using the code default)."
    );
    const overrideHistory = providerGatewayClient.calls.at(-1)?.toolHistory ?? [];
    const overrideExhaustedEntry = overrideHistory.find((entry) =>
      entry.toolResult.content.includes('"reason":"tool_budget_exhausted"')
    );
    assert.ok(
      overrideExhaustedEntry !== undefined,
      "ADR-074 L1 regression: with override loopLimit=5 the 6th iteration must be substituted with tool_budget_exhausted, NOT silently truncated."
    );
    if (overrideExhaustedEntry !== undefined) {
      const parsed = JSON.parse(overrideExhaustedEntry.toolResult.content) as {
        budgetReason?: string;
        limit?: number;
        observed?: number;
      };
      assert.equal(
        parsed.budgetReason,
        "loop_limit",
        "ADR-074 L1 regression: override-driven exhaustion must still report loop_limit."
      );
      assert.equal(
        parsed.limit,
        5,
        "ADR-074 L1 regression: tool_budget_exhausted.limit must reflect the OVERRIDE value (5), not the code default."
      );
      assert.equal(parsed.observed, 6);
    }
    await flushTaskQueue();
  } finally {
    if (bundleRegistry.entry !== null) {
      bundleRegistry.entry.parsedBundle.runtime.toolBudgets = null;
    }
  }
}
