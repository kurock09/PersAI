import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeMemoryWriteItem,
  RuntimeTurnRequest,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeMemoryWriteToolService } from "../src/modules/turns/runtime-memory-write-tool.service";

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

function createBundle() {
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_EMPTY,
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
      preview: "",
      welcome: ""
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-memory-write-1",
    name: "memory_write",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  writeCalls: Array<Record<string, unknown>> = [];
  outcome: {
    written: boolean;
    code: string | null;
    message: string | null;
    item: RuntimeMemoryWriteItem | null;
  } = {
    written: true,
    code: null,
    message: null,
    item: {
      id: "memory-1",
      summary: "User prefers concise answers.",
      kind: "preference",
      sourceLabel: "Memory write: preference",
      createdAt: "2026-04-14T19:00:00.000Z",
      chatId: null
    }
  };
  error: Error | null = null;

  async writeMemory(input: Record<string, unknown>) {
    this.writeCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.outcome;
  }
}

async function run(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    projection.tools.some((tool) => tool.name === "memory_write"),
    true
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "memory_write"),
    false
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeMemoryWriteToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );
  const directWebConversation: RuntimeTurnRequest["conversation"] = {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    mode: "direct"
  };

  const success = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "preference",
      memory: "User prefers concise answers."
    }),
    conversation: directWebConversation,
    currentUserMessageId: "not-a-uuid",
    requestId: "request-1"
  });
  assert.equal(success.payload.action, "remembered");
  assert.equal(success.payload.item?.summary, "User prefers concise answers.");
  assert.deepEqual(internalApi.writeCalls.at(-1), {
    assistantId: "assistant-1",
    kind: "preference",
    summary: "User prefers concise answers.",
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-1"
  });

  const invalid = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "preference",
      memory: ""
    }),
    conversation: directWebConversation,
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);

  const unsupportedSurface = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "fact",
      memory: "User works in finance."
    }),
    conversation: {
      ...directWebConversation,
      channel: "max_ru"
    },
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(unsupportedSurface.payload.action, "skipped");
  assert.equal(unsupportedSurface.payload.reason, "surface_unavailable");

  internalApi.outcome = {
    written: false,
    code: "memory_group_global_write_denied",
    message: "Global memory cannot be written from group sources.",
    item: null
  };
  const denied = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "open_loop",
      memory: "Follow up on the analytics dashboard migration."
    }),
    conversation: {
      ...directWebConversation,
      channel: "telegram",
      mode: "group"
    },
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(denied.payload.action, "skipped");
  assert.equal(denied.payload.reason, "memory_group_global_write_denied");
  assert.equal(denied.payload.warning, "Global memory cannot be written from group sources.");

  internalApi.outcome = {
    written: true,
    code: null,
    message: null,
    item: {
      id: "memory-2",
      summary: "User prefers concise answers.",
      kind: "preference",
      sourceLabel: "Memory write: preference",
      createdAt: "2026-04-14T19:00:00.000Z",
      chatId: null
    }
  };
  internalApi.error = new Error("PersAI internal API memory write request failed.");
  const failed = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "fact",
      memory: "User works in finance."
    }),
    conversation: directWebConversation,
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(failed.payload.action, "skipped");
  assert.equal(failed.payload.reason, "memory_write_failed");
  assert.equal(failed.isError, true);
}

void run();
