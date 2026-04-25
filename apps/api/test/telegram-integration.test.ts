import assert from "node:assert/strict";
import { ConnectTelegramIntegrationService } from "../src/modules/workspace-management/application/connect-telegram-integration.service";
import { ResolveTelegramIntegrationStateService } from "../src/modules/workspace-management/application/resolve-telegram-integration-state.service";
import { UpdateTelegramIntegrationConfigService } from "../src/modules/workspace-management/application/update-telegram-integration-config.service";
import { RevokeTelegramIntegrationSecretService } from "../src/modules/workspace-management/application/revoke-telegram-integration-secret.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantGovernance } from "../src/modules/workspace-management/domain/assistant-governance.entity";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "ws-1",
  draftDisplayName: null,
  draftInstructions: null,
  draftUpdatedAt: null,
  applyStatus: "not_requested",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

let governance: AssistantGovernance = {
  id: "gov-1",
  assistantId: assistant.id,
  capabilityEnvelope: null,
  secretRefs: null,
  policyEnvelope: null,
  memoryControl: null,
  tasksControl: null,
  quotaPlanCode: "starter_trial",
  quotaHook: null,
  auditHook: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

type BindingRecord = {
  id: string;
  assistantId: string;
  providerKey: "telegram";
  surfaceType: "telegram_bot";
  bindingState: "active" | "inactive" | "unconfigured";
  tokenFingerprint: string | null;
  tokenLastFour: string | null;
  policy: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function run(): Promise<void> {
  let binding: BindingRecord | null = null;

  const assistantRepository = {
    findByUserId: async (userId: string) => (userId === assistant.userId ? assistant : null)
  };
  const governanceRepository = {
    findByAssistantId: async () => governance,
    createBaseline: async () => governance,
    updateSecretRefs: async (_assistantId: string, secretRefs: Record<string, unknown> | null) => {
      governance = {
        ...governance,
        secretRefs
      };
      return governance;
    }
  };
  const capabilityResolver = {
    execute: async () => ({
      schema: "persai.effectiveCapabilities.v1" as const,
      derivedFrom: {
        planCode: "starter_trial",
        planStatus: "active" as const,
        governanceSchema: null
      },
      subscription: {
        source: "workspace_subscription" as const,
        status: "trialing" as const,
        planCode: "starter_trial",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      },
      toolClasses: {
        costDriving: { allowed: false, quotaGoverned: true },
        utility: { allowed: true, quotaGoverned: true }
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      mediaClasses: { text: true, image: false, audio: false, video: false, file: false }
    })
  };
  const bindingRepository = {
    findByAssistantProviderSurface: async () => binding,
    upsert: async (input: {
      assistantId: string;
      bindingState: "active" | "inactive" | "unconfigured";
      tokenFingerprint: string | null;
      tokenLastFour: string | null;
      policy: Record<string, unknown> | null;
      config: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      connectedAt: Date | null;
      disconnectedAt: Date | null;
    }) => {
      binding = {
        id: "binding-1",
        assistantId: input.assistantId,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: input.bindingState,
        tokenFingerprint: input.tokenFingerprint,
        tokenLastFour: input.tokenLastFour,
        policy: input.policy,
        config: input.config,
        metadata: input.metadata,
        connectedAt: input.connectedAt,
        disconnectedAt: input.disconnectedAt,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return binding;
    },
    patchMetadata: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      patch: Record<string, unknown>
    ) => {
      if (!binding) {
        return;
      }
      binding = {
        ...binding,
        metadata: {
          ...(binding.metadata ?? {}),
          ...patch
        }
      };
    },
    hasActiveBindingForProvider: async () => binding?.bindingState === "active"
  };
  const auditEventService = {
    execute: async () => undefined
  };

  const resolveStateService = new ResolveTelegramIntegrationStateService(
    assistantRepository as never,
    governanceRepository as never,
    bindingRepository as never,
    capabilityResolver as never
  );
  const prismaServiceMock = {
    assistant: { update: async () => ({}), updateMany: async () => ({}) }
  };
  const secretStoreServiceMock = {
    upsertProviderKey: async () => undefined,
    deleteProviderKey: async () => undefined,
    resolveSecretValueByProviderKey: async () => null
  };
  const publishedVersionRepositoryMock = {
    findLatestByAssistantId: async () => ({
      id: "published-1"
    })
  };
  let applyCallCount = 0;
  const applyServiceMock = {
    execute: async () => {
      applyCallCount += 1;
    }
  };
  const connectService = new ConnectTelegramIntegrationService(
    assistantRepository as never,
    governanceRepository as never,
    bindingRepository as never,
    publishedVersionRepositoryMock as never,
    applyServiceMock as never,
    capabilityResolver as never,
    resolveStateService,
    auditEventService as never,
    secretStoreServiceMock as never,
    prismaServiceMock as never
  );
  const updateConfigService = new UpdateTelegramIntegrationConfigService(
    assistantRepository as never,
    bindingRepository as never,
    publishedVersionRepositoryMock as never,
    applyServiceMock as never,
    resolveStateService,
    auditEventService as never,
    prismaServiceMock as never
  );
  const revokeService = new RevokeTelegramIntegrationSecretService(
    assistantRepository as never,
    governanceRepository as never,
    bindingRepository as never,
    publishedVersionRepositoryMock as never,
    applyServiceMock as never,
    resolveStateService,
    auditEventService as never,
    secretStoreServiceMock as never,
    prismaServiceMock as never
  );

  const originalFetch = globalThis.fetch;
  const originalEnv = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    PERSAI_INTERNAL_API_TOKEN: process.env.PERSAI_INTERNAL_API_TOKEN,
    TELEGRAM_WEBHOOK_BASE_URL: process.env.TELEGRAM_WEBHOOK_BASE_URL,
    TELEGRAM_WEBHOOK_HMAC_SECRET: process.env.TELEGRAM_WEBHOOK_HMAC_SECRET
  };
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/persai";
  process.env.CLERK_SECRET_KEY = "sk_test_123";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
  process.env.TELEGRAM_WEBHOOK_BASE_URL = "https://bot.persai.dev";
  process.env.TELEGRAM_WEBHOOK_HMAC_SECRET = "0123456789abcdef0123456789abcdef";
  const fetchCalls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/getMe")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: 777, first_name: "PersAI Bot", username: "persai_bot" }
        }),
        {
          status: 200
        }
      );
    }
    if (url.includes("/setWebhook")) {
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, description: "unexpected request" }), {
      status: 500
    });
  }) as typeof fetch;
  try {
    const connected = await connectService.execute("user-1", {
      botToken: "123456:ABCDEF01234567890123"
    });
    assert.equal(connected.connectionStatus, "claim_required");
    assert.equal(connected.secretLifecycle.status, "active");
    assert.equal(connected.secretLifecycle.version, 1);
    assert.equal(connected.bot.displayName, "PersAI Bot");
    assert.equal(connected.bot.username, "persai_bot");
    assert.equal(connected.configPanel.available, true);
    assert.equal(connected.configPanel.settings.autoCompactionEnabled, true);
    assert.equal(connected.configPanel.settings.defaultParseMode, "markdown");
    assert.equal(connected.ownerClaim.required, true);
    assert.equal(connected.ownerClaim.status, "pending");
    assert.match(connected.ownerClaim.code ?? "", /^\d{6}$/);
    assert.notEqual(connected.ownerClaim.claimExpiresAt, null);
    const webhookCall = fetchCalls.find((call) => call.url.includes("/setWebhook"));
    assert.ok(webhookCall, "connect must register the Telegram webhook");
    assert.deepEqual(webhookCall.body, {
      url: "https://bot.persai.dev/telegram-webhook/assistant-1",
      secret_token: "7f5ae9d50e575605e0900f58bbcd8eac8080c6fac0e80d4177aa6069016d6eb8",
      allowed_updates: ["message"]
    });

    applyCallCount = 0;
    const updated = await updateConfigService.execute("user-1", {
      autoCompactionEnabled: false,
      defaultParseMode: "markdown",
      inboundUserMessagesEnabled: true,
      outboundAssistantMessagesEnabled: false,
      groupReplyMode: "mention_reply",
      notes: "Only outbound notifications for now"
    });
    assert.equal(updated.configPanel.settings.autoCompactionEnabled, false);
    assert.equal(updated.configPanel.settings.defaultParseMode, "markdown");
    assert.equal(updated.configPanel.settings.outboundAssistantMessagesEnabled, false);
    assert.equal(updated.configPanel.settings.groupReplyMode, "mention_reply");
    assert.equal(updated.configPanel.settings.notes, "Only outbound notifications for now");
    assert.equal(updated.connectionStatus, "claim_required");
    assert.equal(applyCallCount, 1);

    const previousCode = updated.ownerClaim.code;
    assert.notEqual(previousCode, null);
    if (binding?.metadata) {
      binding.metadata.telegramOwnerClaimExpiresAt = "2000-01-01T00:00:00.000Z";
    }
    const refreshed = await resolveStateService.execute("user-1");
    assert.equal(refreshed.connectionStatus, "claim_required");
    assert.match(refreshed.ownerClaim.code ?? "", /^\d{6}$/);
    assert.notEqual(refreshed.ownerClaim.code, previousCode);
    assert.notEqual(refreshed.ownerClaim.claimExpiresAt, null);

    const revoked = await revokeService.execute("user-1", { reason: "token leaked" }, false);
    assert.equal(revoked.connectionStatus, "not_connected");
    assert.equal(revoked.secretLifecycle.status, "revoked");
    assert.equal(revoked.secretLifecycle.revokeReason, "token leaked");

    const emergencyRevoked = await revokeService.execute(
      "user-1",
      { reason: "incident response" },
      true
    );
    assert.equal(emergencyRevoked.secretLifecycle.status, "emergency_revoked");
    assert.equal(emergencyRevoked.secretLifecycle.revokeReason, "incident response");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

void run();
