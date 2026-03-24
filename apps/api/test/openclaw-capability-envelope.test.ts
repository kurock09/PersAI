import assert from "node:assert/strict";
import { ResolveOpenClawCapabilityEnvelopeService } from "../src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service";

async function run(): Promise<void> {
  const service = new ResolveOpenClawCapabilityEnvelopeService();
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
    effectiveToolAvailability: {
      schema: "persai.effectiveToolAvailability.v2",
      derivedFrom: {
        effectiveCapabilitiesSchema: "persai.effectiveCapabilities.v1",
        planCode: "starter_trial"
      },
      toolClasses: {
        utility: {
          allowed: true,
          quotaGoverned: true,
          activation: "active"
        },
        costDriving: {
          allowed: false,
          quotaGoverned: true,
          activation: "inactive"
        }
      },
      tools: [
        {
          code: "memory_center_read",
          displayName: "Memory Center Read",
          description: null,
          capabilityGroup: "workspace_ops",
          toolClass: "utility",
          catalogStatus: "active",
          planActivationStatus: "active",
          effectiveActivation: "active"
        },
        {
          code: "web_search",
          displayName: "Web Search",
          description: null,
          capabilityGroup: "knowledge",
          toolClass: "cost_driving",
          catalogStatus: "active",
          planActivationStatus: "active",
          effectiveActivation: "inactive"
        }
      ],
      notes: []
    },
    channelSurfaceBindings: {
      schema: "persai.openclawChannelSurfaceBindings.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: "persai.effectiveCapabilities.v1",
        planCode: "starter_trial"
      },
      providers: [
        {
          provider: "web_internal",
          assistantBinding: { assistantId: "assistant_1", bound: true, state: "active" },
          policy: {
            inboundUserMessages: true,
            outboundAssistantMessages: true,
            supportsInteractiveChat: true
          },
          config: { mode: "native", configRef: null },
          surfaces: [
            {
              surfaceType: "web_chat",
              allowed: true,
              state: "active",
              denyReason: null,
              policy: {
                interactionMode: "chat",
                inboundUserMessages: true,
                outboundAssistantMessages: true
              },
              config: { routingKey: "web.chat" }
            }
          ]
        }
      ],
      suppression: {
        suppressUnavailableSurfaces: true,
        deniedSurfaceTypes: [],
        declaredSurfaceTypes: ["web_chat"]
      }
    },
    runtimeProviderRouting: {
      schema: "persai.runtimeProviderRouting.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: "persai.effectiveCapabilities.v1",
        policyEnvelopeSchema: null,
        planCode: "starter_trial"
      },
      userFacingProviderPickerEnabled: false,
      primaryPath: {
        providerKey: "openclaw_managed_default",
        modelKey: "text_standard_v1",
        active: true,
        inactiveReason: null
      },
      fallbackMatrix: [],
      governanceAlignment: {
        channelsEvaluated: {
          webChat: true,
          telegram: true,
          whatsapp: false,
          max: false
        },
        textMediaAllowed: true,
        costDrivingAllowed: false,
        costDrivingQuotaGoverned: true
      },
      notes: []
    }
  });

  assert.equal(resolved.schema, "persai.openclawCapabilityEnvelope.v1");
  assert.equal(resolved.catalog.declaredToolCodes.includes("memory_center_read"), true);
  assert.equal(resolved.channelsAndSurfaces.webChat.allowed, true);
  assert.equal(resolved.channelSurfaceBindings.providers[0]?.surfaces[0]?.surfaceType, "web_chat");
  assert.equal(resolved.channelsAndSurfaces.whatsapp.allowed, false);
  assert.equal(resolved.tools.find((tool) => tool.code === "web_search")?.allowed, false);
  assert.equal(
    resolved.tools.find((tool) => tool.code === "web_search")?.denyReason,
    "class_not_allowed"
  );
  assert.equal(resolved.suppression.deniedToolCodes.includes("web_search"), true);
  assert.equal(resolved.quotaRestrictions.costDriving.restrictedByQuota, false);
  assert.equal(resolved.quotaRestrictions.utility.restrictedByQuota, true);
  assert.equal(resolved.quotaRestrictions.tasksAndRemindersExcludedFromCommercialQuotas, true);
}

void run();
