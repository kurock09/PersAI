import assert from "node:assert/strict";
import { ResolveOpenClawChannelSurfaceBindingsService } from "../src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service";

const effectiveCapabilities = {
  schema: "persai.effectiveCapabilities.v1",
  derivedFrom: {
    planCode: "starter_trial",
    planStatus: "active",
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
    costDriving: {
      allowed: false,
      quotaGoverned: true
    },
    utility: {
      allowed: true,
      quotaGoverned: true
    }
  },
  channelsAndSurfaces: {
    webChat: true,
    telegram: true,
    whatsapp: true,
    max: true
  },
  mediaClasses: {
    text: true,
    image: false,
    audio: false,
    video: false,
    file: false
  }
};

async function run(): Promise<void> {
  const service = new ResolveOpenClawChannelSurfaceBindingsService(
    {
      hasActiveBindingForProvider: async (_assistantId, providerKey) =>
        providerKey === "telegram" || providerKey === "whatsapp" || providerKey === "max"
    } as never,
    {
      findByAssistantId: async () => ({
        id: "gov_g5",
        assistantId: "assistant_g5",
        capabilityEnvelope: null,
        secretRefs: {
          schema: "persai.secretRefs.v1",
          refs: {
            telegram_bot_token: {
              refKey: "vault://assistants/assistant_g5/telegram_bot_token/v2",
              manager: "backend_vault_kms",
              providerKey: "telegram",
              surfaceType: "telegram_bot",
              version: 2,
              status: "active",
              rotatedAt: new Date().toISOString(),
              expiresAt: null,
              revokedAt: null,
              emergencyRevokedAt: null,
              revokeReason: null,
              hints: {
                tokenFingerprintPrefix: "abcdef123456",
                tokenLastFour: "1234"
              }
            }
          }
        },
        policyEnvelope: null,
        memoryControl: null,
        tasksControl: null,
        quotaPlanCode: "starter_trial",
        quotaHook: null,
        auditHook: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    } as never
  );

  const resolved = await service.execute({
    assistantId: "assistant_g5",
    effectiveCapabilities
  });

  const whatsappProvider = resolved.providers.find((p) => p.provider === "whatsapp");
  assert.equal(whatsappProvider?.assistantBinding.state, "active");
  assert.equal(whatsappProvider?.surfaces[0]?.surfaceType, "whatsapp_business");
  assert.equal(whatsappProvider?.surfaces[0]?.allowed, true);

  const maxProvider = resolved.providers.find((p) => p.provider === "max");
  assert.equal(maxProvider?.assistantBinding.state, "active");
  assert.equal(maxProvider?.surfaces.length, 2);
  assert.equal(
    maxProvider?.surfaces.some((s) => s.surfaceType === "max_bot"),
    true
  );
  assert.equal(
    maxProvider?.surfaces.some((s) => s.surfaceType === "max_mini_app"),
    true
  );
  assert.equal(
    maxProvider?.surfaces.every((s) => s.allowed),
    true
  );
}

void run();
