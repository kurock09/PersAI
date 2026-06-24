import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeTodoItem,
  RuntimeTurnRequest,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type {
  InternalApplyTodoWriteInput,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeTodoWriteToolService } from "../src/modules/turns/runtime-todo-write-tool.service";

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

function createBundle(options?: { todoWritePolicyEnabled?: boolean }) {
  const todoWritePolicyEnabled = options?.todoWritePolicyEnabled ?? true;
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
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "en-US",
        deliveryKind: "voice_note",
        elevenlabs: { voiceId: null },
        yandex: { voice: "jane", role: null },
        openai: { voice: "marin" }
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
        primary: { provider: "openai", model: "gpt-5.4" }
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
          toolCode: "todo_write",
          displayName: "Todo Write",
          description: "Manage the orchestrator's structured plan for this chat.",
          usageGuidance: null,
          kind: "plan",
          executionMode: "inline",
          usageRule: todoWritePolicyEnabled ? "allowed" : "forbidden",
          enabled: todoWritePolicyEnabled,
          visibleToModel: todoWritePolicyEnabled,
          visibleInPlanEditor: true,
          dailyCallLimit: null
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
    id: "tool-call-todo-write-1",
    name: "todo_write",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  applyCalls: InternalApplyTodoWriteInput[] = [];
  applyOutcome: {
    chatId: string;
    action: "applied" | "skipped";
    reason: string | null;
    warning: string | null;
    todos: RuntimeTodoItem[];
    windowed: boolean;
    totalCount: number;
  } = {
    chatId: "chat-1",
    action: "applied",
    reason: null,
    warning: null,
    todos: [
      {
        id: "todo-0001",
        parentId: null,
        content: "First task",
        status: "in_progress"
      }
    ],
    windowed: false,
    totalCount: 1
  };
  applyError: Error | null = null;
  quotaCalls: Array<Record<string, unknown>> = [];
  quotaOutcome:
    | { allowed: true; currentCount: number; limit: number | null }
    | { allowed: false; code: string; message: string } = {
    allowed: true,
    currentCount: 1,
    limit: null
  };

  async applyTodoWriteAction(input: InternalApplyTodoWriteInput) {
    this.applyCalls.push(input);
    if (this.applyError !== null) throw this.applyError;
    return this.applyOutcome;
  }

  async consumeToolDailyLimit(input: Record<string, unknown>) {
    this.quotaCalls.push(input);
    return this.quotaOutcome;
  }
}

const directWebConversation: RuntimeTurnRequest["conversation"] = {
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  channel: "web",
  externalThreadKey: "thread-1",
  externalUserKey: "user-1",
  mode: "direct"
};

export async function runRuntimeTodoWriteToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const todoWriteDefinition = projection.tools.find((tool) => tool.name === "todo_write");
  assert.ok(todoWriteDefinition, "todo_write tool definition should be projected");
  const schema = todoWriteDefinition.inputSchema as {
    properties?: Record<string, { enum?: string[]; description?: string }>;
  };
  assert.deepEqual(schema.properties?.action?.enum?.sort(), [
    "add",
    "clear",
    "complete",
    "remove",
    "update"
  ]);

  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "todo_write"),
    false
  );

  const disabledBundle = createBundle({ todoWritePolicyEnabled: false });
  const disabledProjection = projectRuntimeNativeTools(disabledBundle);
  assert.equal(
    disabledProjection.tools.some((tool) => tool.name === "todo_write"),
    false,
    "todo_write must be hidden when the policy is forbidden / disabled"
  );

  // Happy-path: add action delegates to internal API and surfaces the windowed result.
  {
    const api = new FakePersaiInternalApiClientService();
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "add",
        items: [{ content: "First task", status: "in_progress" }]
      }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "applied");
    assert.equal(result.payload.toolCode, "todo_write");
    assert.equal(result.payload.executionMode, "inline");
    assert.equal(result.payload.todos.length, 1);
    assert.equal(api.applyCalls.length, 1);
    assert.equal(api.applyCalls[0]?.action.kind, "add");
    assert.equal(api.applyCalls[0]?.channel, "web");
    assert.equal(api.applyCalls[0]?.surfaceThreadKey, "thread-1");
  }

  // Invalid arguments (unknown action) -> skipped + isError
  {
    const api = new FakePersaiInternalApiClientService();
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "not_a_real_action" }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(api.applyCalls.length, 0);
  }

  // add with missing items rejected
  {
    const api = new FakePersaiInternalApiClientService();
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "add" }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.reason, "invalid_arguments");
  }

  // add with completed status rejected
  {
    const api = new FakePersaiInternalApiClientService();
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "add",
        items: [{ content: "Bad", status: "completed" }]
      }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.reason, "invalid_arguments");
  }

  // update with id passes through
  {
    const api = new FakePersaiInternalApiClientService();
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "update", id: "todo-0001", content: "Updated" }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, false);
    assert.equal(api.applyCalls.length, 1);
    const call = api.applyCalls[0];
    assert.ok(call);
    assert.equal(call.action.kind, "update");
    if (call.action.kind === "update") {
      assert.equal(call.action.id, "todo-0001");
      assert.equal(call.action.content, "Updated");
    }
  }

  // clear delegates and returns empty
  {
    const api = new FakePersaiInternalApiClientService();
    api.applyOutcome = {
      chatId: "chat-1",
      action: "applied",
      reason: null,
      warning: null,
      todos: [],
      windowed: false,
      totalCount: 0
    };
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "clear" }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "applied");
    assert.equal(result.payload.todos.length, 0);
  }

  // Internal API failure propagates as skipped + isError
  {
    const api = new FakePersaiInternalApiClientService();
    api.applyError = new Error("internal API down");
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "add",
        items: [{ content: "Task" }]
      }),
      conversation: directWebConversation
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "todo_write_failed");
    assert.ok(result.payload.warning?.includes("internal API down"));
  }

  // Daily-limit denial path
  {
    const api = new FakePersaiInternalApiClientService();
    api.quotaOutcome = {
      allowed: false,
      code: "tool_daily_limit_reached",
      message: "Daily limit reached for todo_write."
    };
    const enforcedBundle = createBundle();
    const policy = enforcedBundle.governance.toolPolicies.find(
      (entry) => entry.toolCode === "todo_write"
    );
    if (policy) {
      (policy as { dailyCallLimit: number | null }).dailyCallLimit = 5;
    }
    const service = new RuntimeTodoWriteToolService(
      api as unknown as PersaiInternalApiClientService
    );
    const result = await service.executeToolCall({
      bundle: enforcedBundle,
      toolCall: createToolCall({
        action: "add",
        items: [{ content: "Task" }]
      }),
      conversation: directWebConversation
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "tool_daily_limit_reached");
    assert.equal(api.applyCalls.length, 0);
  }

  console.log("[runtime-todo-write-tool.service] all tests passed");
}
