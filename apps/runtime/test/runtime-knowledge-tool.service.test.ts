import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeKnowledgeDocument,
  RuntimeKnowledgeSearchHit,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { RuntimeKnowledgeToolService } from "../src/modules/turns/runtime-knowledge-tool.service";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";

const KNOWLEDGE_ACCESS_WITH_PRIVATE_AND_SHARED_SOURCES = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: [
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
    },
    {
      source: "document",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const KNOWLEDGE_ACCESS_EMPTY = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: []
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

function createBundle(knowledgeAccess: RuntimeKnowledgeAccessConfig) {
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
      knowledgeAccess,
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
      toolCredentialRefs: {},
      toolPolicies: [],
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

function createToolCall(
  name: "knowledge_search" | "knowledge_fetch",
  argumentsObject: Record<string, unknown>
): ProviderGatewayToolCall {
  return {
    id: "tool-call-1",
    name,
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  searchCalls: Array<Record<string, unknown>> = [];
  fetchCalls: Array<Record<string, unknown>> = [];
  searchHits: RuntimeKnowledgeSearchHit[] = [
    {
      referenceId: "source-1:1:1",
      source: "document",
      title: "Pricing Notes",
      locator: "p2",
      snippet: "Quota limits stay separate.",
      score: 42,
      metadata: { knowledgeSourceId: "source-1" }
    }
  ];
  fetchedDocument: RuntimeKnowledgeDocument | null = {
    referenceId: "source-1:1:1",
    source: "document",
    title: "Pricing Notes",
    locator: "p2",
    content: "Quota limits stay separate for media uploads and knowledge storage.",
    snippet: "Quota limits stay separate.",
    metadata: { knowledgeSourceId: "source-1" }
  };
  searchError: Error | null = null;

  async searchKnowledge(input: Record<string, unknown>) {
    this.searchCalls.push(input);
    if (this.searchError) {
      throw this.searchError;
    }
    return this.searchHits;
  }

  async fetchKnowledge(input: Record<string, unknown>) {
    this.fetchCalls.push(input);
    return this.fetchedDocument;
  }
}

async function run(): Promise<void> {
  const bundle = createBundle(KNOWLEDGE_ACCESS_WITH_PRIVATE_AND_SHARED_SOURCES);
  const hiddenBundle = createBundle(KNOWLEDGE_ACCESS_EMPTY);
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(hiddenBundle);

  assert.equal(
    projection.tools.some((tool) => tool.name === "knowledge_search"),
    true
  );
  assert.equal(
    projection.tools.some((tool) => tool.name === "knowledge_fetch"),
    true
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "knowledge_search"),
    false
  );
  assert.deepEqual(
    projection.knowledgeSearchSources.map((source) => source.source),
    ["memory", "chat", "preset", "subscription", "global", "document"]
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeKnowledgeToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );

  const searchResult = await service.executeSearchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_search", {
      source: "document",
      query: "quota limits",
      maxResults: 2
    }),
    allowedSources: projection.knowledgeSearchSources
  });
  assert.equal(searchResult.payload.action, "results");
  assert.equal(searchResult.payload.hits.length, 1);
  assert.equal(searchResult.isError, false);
  assert.deepEqual(internalApi.searchCalls, [
    {
      assistantId: "assistant-1",
      source: "document",
      query: "quota limits",
      maxResults: 2
    }
  ]);

  const fetched = await service.executeFetchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_fetch", {
      source: "document",
      referenceId: "source-1:1:1"
    }),
    allowedSources: projection.knowledgeFetchSources
  });
  assert.equal(fetched.payload.action, "fetched");
  assert.equal(fetched.payload.document?.referenceId, "source-1:1:1");
  assert.equal(fetched.isError, false);

  internalApi.fetchedDocument = null;
  const missingFetch = await service.executeFetchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_fetch", {
      source: "document",
      referenceId: "missing:1:1"
    }),
    allowedSources: projection.knowledgeFetchSources
  });
  assert.equal(missingFetch.payload.action, "skipped");
  assert.equal(missingFetch.payload.reason, "reference_not_found");

  const invalidSearch = await service.executeSearchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_search", {
      source: "document",
      query: ""
    }),
    allowedSources: projection.knowledgeSearchSources
  });
  assert.equal(invalidSearch.payload.reason, "invalid_arguments");
  assert.equal(invalidSearch.isError, true);

  const unavailableSearch = await service.executeSearchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_search", {
      source: "web",
      query: "quota"
    }),
    allowedSources: projection.knowledgeSearchSources
  });
  assert.equal(unavailableSearch.payload.reason, "source_unavailable");
  assert.equal(unavailableSearch.isError, false);

  internalApi.searchError = new Error("boom");
  const failedSearch = await service.executeSearchToolCall({
    bundle,
    toolCall: createToolCall("knowledge_search", {
      source: "document",
      query: "quota"
    }),
    allowedSources: projection.knowledgeSearchSources
  });
  assert.equal(failedSearch.payload.reason, "knowledge_search_failed");
  assert.equal(failedSearch.isError, true);
}

void run();
