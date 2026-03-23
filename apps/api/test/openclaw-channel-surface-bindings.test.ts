import assert from "node:assert/strict";
import { ResolveOpenClawChannelSurfaceBindingsService } from "../src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service";

async function run(): Promise<void> {
  const service = new ResolveOpenClawChannelSurfaceBindingsService();
  const resolved = service.execute({
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
      },
      governedFeatures: {
        assistantLifecycle: true,
        memoryCenter: true,
        tasksCenter: true,
        viewLimitPercentages: true,
        tasksExcludedFromCommercialQuotas: true
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
    "unconfigured"
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
