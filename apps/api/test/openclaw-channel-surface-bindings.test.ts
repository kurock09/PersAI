import assert from "node:assert/strict";
import { ResolveOpenClawChannelSurfaceBindingsService } from "../src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service";

async function run(): Promise<void> {
  const service = new ResolveOpenClawChannelSurfaceBindingsService(
    {
      hasActiveBindingForProvider: async (_assistantId, providerKey) => providerKey === "telegram"
    } as never,
    {
      findByAssistantId: async () => ({
        id: "gov_e3",
        assistantId: "assistant_e3",
        capabilityEnvelope: null,
        secretRefs: {
          schema: "persai.secretRefs.v1",
          refs: {
            telegram_bot_token: {
              refKey: "vault://assistants/assistant_e3/telegram_bot_token/v1",
              manager: "backend_vault_kms",
              providerKey: "telegram",
              surfaceType: "telegram_bot",
              version: 1,
              status: "active",
              rotatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
    assistantId: "assistant_e3",
    effectiveCapabilities: {
      schema: "persai.effectiveCapabilities.v1",
      derivedFrom: {
        planCode: "starter_trial",
        planStatus: "active",
        governanceSchema: null
      },
      subscription: {
        source: "workspace_subscription",
        status: "trialing",
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
        whatsapp: false,
        max: true
      },
      mediaClasses: {
        text: true,
        image: false,
        audio: false,
        video: false,
        file: false
      }
    }
  });

  assert.equal(resolved.schema, "persai.openclawChannelSurfaceBindings.v1");
  assert.equal(
    resolved.suppression.declaredSurfaceTypes.includes("max_bot") &&
      resolved.suppression.declaredSurfaceTypes.includes("max_mini_app"),
    true
  );
  assert.equal(
    resolved.providers.find((provider) => provider.provider === "telegram")?.assistantBinding.state,
    "active"
  );
  assert.equal(
    resolved.providers
      .find((provider) => provider.provider === "whatsapp")
      ?.surfaces.find((surface) => surface.surfaceType === "whatsapp_business")?.allowed,
    false
  );
  assert.equal(
    resolved.providers
      .find((provider) => provider.provider === "system_notifications")
      ?.surfaces.find((surface) => surface.surfaceType === "system_notification")?.allowed,
    true
  );
}

void run();
