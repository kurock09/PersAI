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
      }
    },
    secretRefs: null,
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
  assert.equal(resolved.modelSlots.normalReply.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.premiumReply.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.reasoning.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.systemTool.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.retrieval.modelKey, "text_premium_primary");
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
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.strategy,
    "degrade_to_safe_mode"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.target
      .modelKey,
    "text_safe_low_cost"
  );

  const adminManaged = service.execute({
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
          allowed: true,
          quotaGoverned: false
        },
        utility: {
          allowed: true,
          quotaGoverned: false
        }
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: false,
        whatsapp: false,
        max: false
      }
    },
    secretRefs: {
      refs: {
        runtime_provider_credentials: {
          schema: "persai.runtimeProviderCredentialRefs.v1",
          providers: {
            openai: {
              secretRef: {
                source: "env",
                provider: "default",
                id: "OPENAI_API_KEY"
              }
            },
            anthropic: {
              secretRef: {
                source: "env",
                provider: "default",
                id: "ANTHROPIC_API_KEY"
              }
            }
          }
        }
      }
    },
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallback: {
          provider: "anthropic",
          model: "claude-sonnet-4-5"
        }
      }
    },
    planPremiumModelKey: "gpt-5.4",
    planReasoningModelKey: "gpt-5.4-mini",
    planSystemToolModelKey: "gpt-5.4-cheap",
    planRetrievalModelKey: "gpt-5.4-nano"
  });

  assert.equal(adminManaged.primaryPath.providerKey, "openai");
  assert.equal(adminManaged.primaryPath.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.normalReply.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.premiumReply.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.reasoning.modelKey, "gpt-5.4-mini");
  assert.equal(
    adminManaged.modelSlots.systemTool.modelKey,
    "gpt-5.4-cheap",
    "plan-level systemToolModelKey must override the provider profile primary model"
  );
  assert.equal(adminManaged.modelSlots.retrieval.modelKey, "gpt-5.4-nano");
  assert.equal(
    adminManaged.fallbackMatrix.find((item) => item.trigger === "provider_failure_or_timeout")
      ?.target.providerKey,
    "anthropic"
  );
  assert.equal(
    adminManaged.fallbackMatrix.find((item) => item.trigger === "runtime_degraded")?.target
      .modelKey,
    "claude-sonnet-4-5"
  );
}

void run();
