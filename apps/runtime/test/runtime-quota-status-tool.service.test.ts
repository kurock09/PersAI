import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type {
  InternalQuotaStatusOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeQuotaStatusToolService } from "../src/modules/turns/runtime-quota-status-tool.service";

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
      toolPolicies: [
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
    id: "tool-call-quota-status-1",
    name: "quota_status",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  readCalls: Array<Record<string, unknown>> = [];
  outcome: InternalQuotaStatusOutcome = {
    planCode: "paid",
    tools: [
      {
        toolCode: "web_search",
        activationStatus: "active",
        dailyCallLimit: 30,
        currentCount: 4,
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
  error: Error | null = null;

  async readQuotaStatus(input: Record<string, unknown>) {
    this.readCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.outcome;
  }
}

export async function runRuntimeQuotaStatusToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    projection.tools.some((tool) => tool.name === "quota_status"),
    true
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "quota_status"),
    false
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeQuotaStatusToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );

  const success = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      toolCode: "web_search"
    })
  });
  assert.equal(success.payload.action, "reported");
  assert.equal(success.payload.requestedToolCode, "web_search");
  assert.equal(success.payload.tools[0]?.toolCode, "web_search");
  assert.equal(success.payload.buckets[0]?.bucketCode, "token_budget");
  assert.equal(success.payload.buckets.length, 1);
  assert.deepEqual(internalApi.readCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "web_search"
  });

  const allTools = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({})
  });
  assert.equal(allTools.payload.action, "reported");
  assert.equal(allTools.payload.requestedToolCode, null);
  assert.equal(allTools.payload.buckets.length, 1);
  assert.deepEqual(internalApi.readCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: null
  });

  const invalid = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      toolCode: ""
    })
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);

  internalApi.error = new Error("internal quota error");
  const failed = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      toolCode: "web_search"
    })
  });
  assert.equal(failed.payload.action, "skipped");
  assert.equal(failed.payload.reason, "quota_status_failed");
  assert.equal(failed.payload.warning, "internal quota error");
  assert.deepEqual(failed.payload.buckets, []);
  assert.equal(failed.isError, true);
}
