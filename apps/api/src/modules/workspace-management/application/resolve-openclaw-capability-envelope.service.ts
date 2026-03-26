import { Injectable } from "@nestjs/common";
import type { EffectiveCapabilityState } from "./effective-capability.types";
import type { EffectiveToolAvailabilityState } from "./effective-tool-availability.types";
import type { OpenClawCapabilityEnvelopeState } from "./openclaw-capability-envelope.types";
import type { OpenClawChannelSurfaceBindingsState } from "./openclaw-channel-surface-bindings.types";
import type { RuntimeProviderRoutingState } from "./runtime-provider-routing.types";

type ToolGroup = "knowledge" | "automation" | "communication" | "workspace_ops";

@Injectable()
export class ResolveOpenClawCapabilityEnvelopeService {
  execute(params: {
    effectiveCapabilities: EffectiveCapabilityState;
    effectiveToolAvailability: EffectiveToolAvailabilityState;
    channelSurfaceBindings: OpenClawChannelSurfaceBindingsState;
    runtimeProviderRouting: RuntimeProviderRoutingState;
  }): OpenClawCapabilityEnvelopeState {
    const {
      effectiveCapabilities,
      effectiveToolAvailability,
      channelSurfaceBindings,
      runtimeProviderRouting
    } = params;

    const tools = effectiveToolAvailability.tools.map((tool) => {
      const allowed = tool.effectiveActivation === "active";
      let denyReason: "catalog_inactive" | "plan_activation_inactive" | "class_not_allowed" | null =
        null;
      if (!allowed) {
        if (tool.catalogStatus !== "active") {
          denyReason = "catalog_inactive";
        } else if (tool.planActivationStatus !== "active") {
          denyReason = "plan_activation_inactive";
        } else {
          denyReason = "class_not_allowed";
        }
      }
      return {
        code: tool.code,
        displayName: tool.displayName,
        capabilityGroup: tool.capabilityGroup,
        toolClass: tool.toolClass,
        allowed,
        denyReason
      };
    });

    const groups: ToolGroup[] = ["knowledge", "automation", "communication", "workspace_ops"];
    const toolGroups = groups.map((group) => {
      const groupTools = tools.filter((tool) => tool.capabilityGroup === group);
      const allowedToolCodes = groupTools.filter((tool) => tool.allowed).map((tool) => tool.code);
      const deniedToolCodes = groupTools.filter((tool) => !tool.allowed).map((tool) => tool.code);
      return {
        group,
        allowedToolCodes,
        deniedToolCodes,
        anyAllowed: allowedToolCodes.length > 0
      };
    });

    const deniedToolCodes = tools.filter((tool) => !tool.allowed).map((tool) => tool.code);

    return {
      schema: "persai.openclawCapabilityEnvelope.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: effectiveCapabilities.schema ?? null,
        effectiveToolAvailabilitySchema: effectiveToolAvailability.schema ?? null,
        planCode: effectiveCapabilities.derivedFrom.planCode
      },
      channelsAndSurfaces: {
        webChat: { allowed: effectiveCapabilities.channelsAndSurfaces.webChat },
        telegram: { allowed: effectiveCapabilities.channelsAndSurfaces.telegram },
        whatsapp: { allowed: effectiveCapabilities.channelsAndSurfaces.whatsapp },
        max: { allowed: effectiveCapabilities.channelsAndSurfaces.max }
      },
      channelSurfaceBindings,
      runtimeProviderRouting,
      toolClasses: {
        utility: effectiveToolAvailability.toolClasses.utility,
        costDriving: effectiveToolAvailability.toolClasses.costDriving
      },
      toolGroups,
      catalog: {
        declaredToolCodes: tools.map((tool) => tool.code)
      },
      tools,
      quotaRestrictions: {
        costDriving: {
          classAllowed: effectiveCapabilities.toolClasses.costDriving.allowed,
          quotaGoverned: effectiveCapabilities.toolClasses.costDriving.quotaGoverned,
          restrictedByQuota:
            effectiveCapabilities.toolClasses.costDriving.allowed &&
            effectiveCapabilities.toolClasses.costDriving.quotaGoverned
        },
        utility: {
          classAllowed: effectiveCapabilities.toolClasses.utility.allowed,
          quotaGoverned: effectiveCapabilities.toolClasses.utility.quotaGoverned,
          restrictedByQuota:
            effectiveCapabilities.toolClasses.utility.allowed &&
            effectiveCapabilities.toolClasses.utility.quotaGoverned
        }
      },
      suppression: {
        suppressUnavailableTools: true,
        deniedToolCodes
      },
      notes: [
        "E2 capability envelope provides explicit per-tool/per-group allow-deny truth.",
        "Any tool code outside catalog.declaredToolCodes is treated as unavailable.",
        "Runtime provider baseline includes explicit primary and fallback paths without user-facing picker.",
        "Unavailable tools are explicitly denied so runtime cannot infer or invent them.",
        "Backend remains control-plane and does not route runtime tool execution."
      ]
    };
  }
}
