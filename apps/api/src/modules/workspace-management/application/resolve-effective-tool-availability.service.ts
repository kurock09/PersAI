import { Inject, Injectable } from "@nestjs/common";
import type { EffectiveCapabilityState } from "./effective-capability.types";
import type { EffectiveToolAvailabilityState } from "./effective-tool-availability.types";
import {
  TOOL_CATALOG_REPOSITORY,
  type ToolCatalogRepository
} from "../domain/tool-catalog.repository";

@Injectable()
export class ResolveEffectiveToolAvailabilityService {
  constructor(
    @Inject(TOOL_CATALOG_REPOSITORY)
    private readonly toolCatalogRepository: ToolCatalogRepository
  ) {}

  async execute(params: {
    effectiveCapabilities: EffectiveCapabilityState;
  }): Promise<EffectiveToolAvailabilityState> {
    const { effectiveCapabilities } = params;
    const tools = await this.toolCatalogRepository.listToolsForPlanActivationView(
      effectiveCapabilities.derivedFrom.planCode
    );

    const utilityAllowed = effectiveCapabilities.toolClasses.utility.allowed;
    const utilityQuotaGoverned = effectiveCapabilities.toolClasses.utility.quotaGoverned;
    const costDrivingAllowed = effectiveCapabilities.toolClasses.costDriving.allowed;
    const costDrivingQuotaGoverned = effectiveCapabilities.toolClasses.costDriving.quotaGoverned;

    return {
      schema: "persai.effectiveToolAvailability.v2",
      derivedFrom: {
        effectiveCapabilitiesSchema: effectiveCapabilities.schema,
        planCode: effectiveCapabilities.derivedFrom.planCode
      },
      toolClasses: {
        utility: {
          allowed: utilityAllowed,
          quotaGoverned: utilityQuotaGoverned,
          activation: utilityAllowed ? "active" : "inactive"
        },
        costDriving: {
          allowed: costDrivingAllowed,
          quotaGoverned: costDrivingQuotaGoverned,
          activation: costDrivingAllowed ? "active" : "inactive"
        }
      },
      tools: tools.map((tool) => {
        const classAllowed = tool.toolClass === "utility" ? utilityAllowed : costDrivingAllowed;
        const isActive =
          tool.catalogStatus === "active" && tool.planActivationStatus === "active" && classAllowed;
        return {
          code: tool.toolCode,
          displayName: tool.displayName,
          description: tool.description,
          capabilityGroup: tool.capabilityGroup,
          toolClass: tool.toolClass,
          catalogStatus: tool.catalogStatus,
          planActivationStatus: tool.planActivationStatus,
          effectiveActivation: isActive ? "active" : "inactive"
        };
      }),
      notes: [
        "E1 adds governed tool catalog and plan activation projection.",
        "OpenClaw remains runtime behavior owner; backend provides explicit availability truth only."
      ]
    };
  }
}
