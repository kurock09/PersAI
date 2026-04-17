import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeConversationAddress,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type {
  InternalScheduledActionItem,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeScheduledActionToolService } from "../src/modules/turns/runtime-scheduled-action-tool.service";

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
      toolPolicies: [
        {
          toolCode: "scheduled_action",
          displayName: "Scheduled Action",
          description: "Schedule actions for reminders and hidden follow-ups.",
          kind: "system",
          executionMode: "worker",
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
      preview: "",
      welcome: ""
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-scheduled-action-1",
    name: "scheduled_action",
    arguments: argumentsObject
  };
}

function createConversation(externalThreadKey: string): RuntimeConversationAddress {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey,
    externalUserKey: "user-1",
    mode: "direct"
  };
}

class FakePersaiInternalApiClientService {
  listCalls: string[] = [];
  controlCalls: Array<Record<string, unknown>> = [];
  items: InternalScheduledActionItem[] = [
    {
      id: "task-current",
      title: "monitor_keyword_arbuz",
      audience: "assistant",
      actionType: "follow_up",
      controlStatus: "active",
      nextRunAt: "2026-04-16T15:39:40.000Z",
      externalRef: "job-current"
    },
    {
      id: "task-other",
      title: "pay rent",
      audience: "user",
      actionType: null,
      controlStatus: "active",
      nextRunAt: "2026-04-16T16:00:00.000Z",
      externalRef: "job-other"
    }
  ];

  async listScheduledActions(assistantId: string) {
    this.listCalls.push(assistantId);
    return this.items;
  }

  async controlScheduledAction(input: Record<string, unknown>) {
    this.controlCalls.push(input);
    return {
      ok: true
    };
  }
}

export async function runRuntimeScheduledActionToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    projection.tools.some((tool) => tool.name === "scheduled_action"),
    true
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "scheduled_action"),
    false
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeScheduledActionToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );

  const backgroundList = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "list"
    }),
    conversation: createConversation("system:scheduled-action:job-current")
  });
  assert.equal(backgroundList.payload.action, "listed");
  assert.equal(backgroundList.isError, false);
  assert.equal(backgroundList.payload.items?.length, 1);
  assert.equal(backgroundList.payload.items?.[0]?.id, "task-other");

  const webList = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "list"
    }),
    conversation: createConversation("thread-1")
  });
  assert.equal(webList.payload.action, "listed");
  assert.equal(webList.payload.items?.length, 2);
  assert.equal(webList.payload.items?.[0]?.id, "task-current");

  const createReminder = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "create",
      audience: "user",
      title: "Pay rent",
      delayMs: 300000
    }),
    conversation: createConversation("thread-1")
  });
  assert.equal(createReminder.payload.action, "created");
  assert.equal(createReminder.isError, false);
  assert.deepEqual(internalApi.controlCalls.at(-1), {
    assistantId: "assistant-1",
    action: "create",
    audience: "user",
    title: "Pay rent",
    reminderText: "Pay rent",
    contextSessionKey: "thread-1",
    delayMs: 300000,
    conversationContext: {
      channel: "web",
      externalThreadKey: "thread-1"
    }
  });

  const blockedSelfCancel = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "cancel",
      titleMatch: "arbuz"
    }),
    conversation: createConversation("system:scheduled-action:job-current")
  });
  assert.equal(blockedSelfCancel.payload.action, "skipped");
  assert.equal(blockedSelfCancel.payload.reason, "self_target_not_allowed");
  assert.equal(blockedSelfCancel.payload.warning !== null, true);
  assert.equal(blockedSelfCancel.isError, false);
  assert.equal(internalApi.controlCalls.length, 1);

  const cancelOtherTask = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "cancel",
      titleMatch: "rent"
    }),
    conversation: createConversation("system:scheduled-action:job-current")
  });
  assert.equal(cancelOtherTask.payload.action, "cancelled");
  assert.equal(cancelOtherTask.isError, false);
  assert.deepEqual(internalApi.controlCalls.at(-1), {
    assistantId: "assistant-1",
    action: "cancel",
    taskId: "task-other"
  });
}
