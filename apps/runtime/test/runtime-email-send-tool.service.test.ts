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
  ConsumeToolDailyLimitOutcome,
  SendAssistantEmailInput,
  SendAssistantEmailOutcome
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeEmailSendToolService } from "../src/modules/turns/runtime-email-send-tool.service";

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

function createBundle(options?: {
  policy?: "allowed" | "missing";
  dailyCallLimit?: number | null;
}) {
  const toolPolicies =
    options?.policy === "missing"
      ? []
      : [
          {
            toolCode: "email_send",
            displayName: "Email Send",
            description: "Send a plain-text email from the workspace's verified sender.",
            kind: "plan" as const,
            executionMode: "worker" as const,
            usageRule: "allowed" as const,
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: options?.dailyCallLimit ?? null
          }
        ];
  return compileAssistantRuntimeBundle({
    effectiveRoleId: "role-test",
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
      toolPolicies,
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
    id: "tool-call-email-send-1",
    name: "email_send",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  quotaCalls: Array<Record<string, unknown>> = [];
  sendCalls: SendAssistantEmailInput[] = [];
  quotaOutcome: ConsumeToolDailyLimitOutcome = { allowed: true, currentCount: 1, limit: null };
  sendOutcome: SendAssistantEmailOutcome = { status: "sent", messageId: "postmark-msg-1" };
  sendError: Error | null = null;

  async consumeToolDailyLimit(
    input: Record<string, unknown>
  ): Promise<ConsumeToolDailyLimitOutcome> {
    this.quotaCalls.push(input);
    return this.quotaOutcome;
  }

  async sendAssistantEmail(input: SendAssistantEmailInput): Promise<SendAssistantEmailOutcome> {
    this.sendCalls.push(input);
    if (this.sendError !== null) {
      throw this.sendError;
    }
    return this.sendOutcome;
  }
}

export async function runRuntimeEmailSendToolServiceTest(): Promise<void> {
  // Projection: included when the policy allows it, omitted when null.
  const projectedBundle = createBundle();
  const projection = projectRuntimeNativeTools(projectedBundle);
  assert.equal(
    projection.tools.some((tool) => tool.name === "email_send"),
    true
  );

  const hiddenBundle = createBundle({ policy: "missing" });
  const hiddenProjection = projectRuntimeNativeTools(hiddenBundle);
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "email_send"),
    false
  );

  // Verified send returns action="sent" with the messageId.
  {
    const client = new FakePersaiInternalApiClientService();
    const service = new RuntimeEmailSendToolService(client as never);
    const bundle = createBundle();
    const result = await service.executeToolCall({
      bundle,
      toolCall: createToolCall({
        to: "partner@example.com",
        subject: "Follow-up",
        body: "Hello, following up on our call."
      }),
      requestId: "req-1",
      chatId: "chat-1"
    });
    assert.equal(result.payload.action, "sent");
    assert.equal(result.payload.messageId, "postmark-msg-1");
    assert.equal(result.isError, false);
    assert.equal(client.sendCalls.length, 1);
    assert.equal(client.sendCalls[0]?.to, "partner@example.com");
    assert.equal(client.sendCalls[0]?.assistantId, "assistant-1");
    assert.equal(client.sendCalls[0]?.workspaceId, "workspace-1");
    assert.equal(client.sendCalls[0]?.chatId, "chat-1");
    assert.equal(client.sendCalls[0]?.requestId, "req-1");
  }

  // ADR-169 — each skip reason carries its own concrete fix. A single shared
  // sentence would tell a user who hit the provider's daily limit to connect
  // the mailbox they already have connected.
  {
    const expectedGuidanceByReason = [
      [
        "mailbox_not_connected",
        "Подключите почтовый ящик в Настройках → Интеграции → Email, затем повторите отправку."
      ],
      [
        "mailbox_token_invalid",
        "Доступ к почтовому ящику отозван. Переподключите его в Настройках → Интеграции → Email."
      ],
      [
        "provider_daily_limit_reached",
        "Достигнут суточный лимит отправки у почтового провайдера. Повторите отправку позже."
      ]
    ] as const;

    for (const [reason, guidance] of expectedGuidanceByReason) {
      const client = new FakePersaiInternalApiClientService();
      client.sendOutcome = { status: "skipped", reason };
      const service = new RuntimeEmailSendToolService(client as never);
      const result = await service.executeToolCall({
        bundle: createBundle(),
        toolCall: createToolCall({
          to: "partner@example.com",
          subject: "Follow-up",
          body: "Hello."
        }),
        requestId: "req-2"
      });
      assert.equal(result.payload.action, "skipped");
      assert.equal(result.payload.reason, reason);
      assert.equal(result.payload.guidance, guidance);
      assert.equal(result.isError, false);
    }
  }

  // Daily-limit exhaustion short-circuits before the internal send call.
  {
    const client = new FakePersaiInternalApiClientService();
    client.quotaOutcome = {
      allowed: false,
      code: "tool_daily_limit_reached",
      message: 'Daily tool usage limit reached for "email_send".'
    };
    const service = new RuntimeEmailSendToolService(client as never);
    const result = await service.executeToolCall({
      bundle: createBundle({ dailyCallLimit: 3 }),
      toolCall: createToolCall({
        to: "partner@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-3"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "tool_daily_limit_reached");
    assert.equal(result.isError, false);
    assert.equal(client.sendCalls.length, 0);
    assert.equal(client.quotaCalls.length, 1);
    assert.equal(client.quotaCalls[0]?.dailyCallLimit, 3);
  }

  // Postmark/API failure maps to action="failed".
  {
    const client = new FakePersaiInternalApiClientService();
    client.sendOutcome = {
      status: "failed",
      reason: "postmark_rejected",
      message: "Signature revoked."
    };
    const service = new RuntimeEmailSendToolService(client as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "partner@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-4"
    });
    assert.equal(result.payload.action, "failed");
    assert.equal(result.payload.reason, "postmark_rejected");
    assert.equal(result.payload.warning, "Signature revoked.");
    assert.equal(result.isError, true);
  }

  // Network/unexpected error from the internal API client also maps to failed.
  {
    const client = new FakePersaiInternalApiClientService();
    client.sendError = new Error("internal api unavailable");
    const service = new RuntimeEmailSendToolService(client as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "partner@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-4b"
    });
    assert.equal(result.payload.action, "failed");
    assert.equal(result.payload.reason, "email_send_error");
    assert.equal(result.isError, true);
  }

  // Multiple recipients / cc / bcc / html are rejected as invalid arguments,
  // with no send call.
  {
    const client = new FakePersaiInternalApiClientService();
    const service = new RuntimeEmailSendToolService(client as never);

    const arrayRecipient = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: ["a@example.com", "b@example.com"],
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-5a"
    });
    assert.equal(arrayRecipient.payload.action, "skipped");
    assert.equal(arrayRecipient.payload.reason, "invalid_arguments");
    assert.equal(arrayRecipient.isError, true);

    const withCc = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "a@example.com",
        cc: "b@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-5b"
    });
    assert.equal(withCc.payload.action, "skipped");
    assert.equal(withCc.payload.reason, "invalid_arguments");

    const withBcc = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "a@example.com",
        bcc: "b@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-5c"
    });
    assert.equal(withBcc.payload.action, "skipped");
    assert.equal(withBcc.payload.reason, "invalid_arguments");

    const withHtml = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "a@example.com",
        subject: "Follow-up",
        body: "Hello.",
        html: "<p>Hello.</p>"
      }),
      requestId: "req-5d"
    });
    assert.equal(withHtml.payload.action, "skipped");
    assert.equal(withHtml.payload.reason, "invalid_arguments");

    const malformedRecipient = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({
        to: "not-an-email",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-5e"
    });
    assert.equal(malformedRecipient.payload.action, "skipped");
    assert.equal(malformedRecipient.payload.reason, "invalid_arguments");
    assert.equal(malformedRecipient.isError, true);
    assert.match(String(malformedRecipient.payload.warning), /valid email address/);

    assert.equal(client.sendCalls.length, 0);
  }

  // describe action returns the contract without sending.
  {
    const client = new FakePersaiInternalApiClientService();
    const service = new RuntimeEmailSendToolService(client as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: createToolCall({ action: "describe" }),
      requestId: "req-6"
    });
    assert.equal((result.payload as { action: string }).action, "described_contract");
    assert.equal((result.payload as { toolCode: string }).toolCode, "email_send");
    assert.equal(client.sendCalls.length, 0);
    assert.equal(client.quotaCalls.length, 0);
  }

  // tool_unavailable when the policy is missing/disallowed.
  {
    const client = new FakePersaiInternalApiClientService();
    const service = new RuntimeEmailSendToolService(client as never);
    const result = await service.executeToolCall({
      bundle: createBundle({ policy: "missing" }),
      toolCall: createToolCall({
        to: "partner@example.com",
        subject: "Follow-up",
        body: "Hello."
      }),
      requestId: "req-7"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "tool_unavailable");
    assert.equal(result.isError, false);
    assert.equal(client.sendCalls.length, 0);
  }
}
