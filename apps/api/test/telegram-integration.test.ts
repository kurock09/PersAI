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
  const connectService = new ConnectTelegramIntegrationService(
    assistantRepository as never,
    governanceRepository as never,
    bindingRepository as never,
    capabilityResolver as never,
    resolveStateService,
    auditEventService as never,
    prismaServiceMock as never
  );
  const updateConfigService = new UpdateTelegramIntegrationConfigService(
    assistantRepository as never,
    bindingRepository as never,
    resolveStateService,
    auditEventService as never
  );
  const revokeService = new RevokeTelegramIntegrationSecretService(
    assistantRepository as never,
    governanceRepository as never,
    bindingRepository as never,
    resolveStateService,
    auditEventService as never,
    prismaServiceMock as never
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: { id: 777, first_name: "PersAI Bot", username: "persai_bot" }
      }),
      {
        status: 200
      }
    )) as typeof fetch;
  try {
    const connected = await connectService.execute("user-1", {
      botToken: "123456:ABCDEF01234567890123"
    });
    assert.equal(connected.connectionStatus, "connected");
    assert.equal(connected.secretLifecycle.status, "active");
    assert.equal(connected.secretLifecycle.version, 1);
    assert.equal(connected.bot.displayName, "PersAI Bot");
    assert.equal(connected.bot.username, "persai_bot");
    assert.equal(connected.configPanel.available, true);

    const updated = await updateConfigService.execute("user-1", {
      defaultParseMode: "markdown",
      inboundUserMessagesEnabled: true,
      outboundAssistantMessagesEnabled: false,
      notes: "Only outbound notifications for now"
    });
    assert.equal(updated.configPanel.settings.defaultParseMode, "markdown");
    assert.equal(updated.configPanel.settings.outboundAssistantMessagesEnabled, false);
    assert.equal(updated.configPanel.settings.notes, "Only outbound notifications for now");

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
  }
}

void run();
