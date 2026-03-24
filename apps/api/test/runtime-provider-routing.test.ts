import assert from "node:assert/strict";
import { ResolveRuntimeProviderRoutingService } from "../src/modules/workspace-management/application/resolve-runtime-provider-routing.service";

async function run(): Promise<void> {
  const service = new ResolveRuntimeProviderRoutingService();
  const resolved = service.execute({
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
        max: false
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
    },
    policyEnvelope: {
      runtimeProviderRouting: {
        schema: "persai.runtimeProviderRoutingPolicy.v1",
        primaryModelKey: "text_premium_primary",
        fallbackModelKey: "text_fast_alt",
        degradeModelKey: "text_safe_low_cost",
        disableFallback: false
      }
    }
  });

  assert.equal(resolved.schema, "persai.runtimeProviderRouting.v1");
  assert.equal(resolved.userFacingProviderPickerEnabled, false);
  assert.equal(resolved.primaryPath.modelKey, "text_premium_primary");
  assert.equal(resolved.primaryPath.active, true);
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "provider_failure_or_timeout")?.target
      .modelKey,
    "text_fast_alt"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "runtime_degraded")?.target.modelKey,
    "text_safe_low_cost"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.eligible,
    true
  );
}

void run();
