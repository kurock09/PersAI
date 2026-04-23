import { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import type { ToolCatalogRepository } from "../../domain/tool-catalog.repository";
import type {
  ToolCatalogActivationView,
  ToolCatalogPromptMetadataView
} from "../../domain/tool-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";
import { TOOL_CATALOG } from "../../../../../prisma/tool-catalog-data";
import {
  patchToolPromptMetadataState,
  readToolPromptMetadataState
} from "../../application/tool-prompt-metadata";

const POLICY_CLASS_BY_TOOL_CODE = new Map(
  TOOL_CATALOG.map((tool) => [tool.code, tool.policyClass ?? "plan_managed"])
);
const TOOL_CATALOG_BY_CODE = new Map(TOOL_CATALOG.map((tool) => [tool.code, tool] as const));
const CURRENT_TOOL_CODES = TOOL_CATALOG.map((tool) => tool.code);

@Injectable()
export class PrismaToolCatalogRepository implements ToolCatalogRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  private mapPromptMetadata(tool: {
    code: string;
    displayName: string;
    description: string | null;
    toolClass: ToolCatalogPromptMetadataView["toolClass"];
    capabilityGroup: ToolCatalogPromptMetadataView["capabilityGroup"];
    status: ToolCatalogPromptMetadataView["catalogStatus"];
    providerHints: unknown;
  }): ToolCatalogPromptMetadataView {
    const promptMetadata = readToolPromptMetadataState(tool.providerHints);
    const catalogEntry = TOOL_CATALOG_BY_CODE.get(tool.code);
    const codeDefaultModelDescription =
      catalogEntry?.modelDescription?.trim() ||
      catalogEntry?.description?.trim() ||
      tool.description;
    const codeDefaultModelUsageGuidance = catalogEntry?.modelUsageGuidance?.trim() || null;
    return {
      toolCode: tool.code,
      displayName: tool.displayName,
      description: tool.description,
      modelDescription: promptMetadata.modelDescription ?? codeDefaultModelDescription ?? null,
      modelUsageGuidance: promptMetadata.modelUsageGuidance ?? codeDefaultModelUsageGuidance,
      codeDefaultModelDescription: codeDefaultModelDescription ?? null,
      codeDefaultModelUsageGuidance,
      modelDescriptionOverridden: promptMetadata.modelDescription !== null,
      modelUsageGuidanceOverridden: promptMetadata.modelUsageGuidance !== null,
      toolClass: tool.toolClass,
      capabilityGroup: tool.capabilityGroup,
      policyClass: POLICY_CLASS_BY_TOOL_CODE.get(tool.code) ?? "plan_managed",
      catalogStatus: tool.status
    };
  }

  async listToolsForPlanActivationView(
    planCode: string | null
  ): Promise<ToolCatalogActivationView[]> {
    const tools = await this.prisma.toolCatalogTool.findMany({
      where: {
        status: "active",
        code: { in: CURRENT_TOOL_CODES }
      },
      orderBy: [{ toolClass: "asc" }, { displayName: "asc" }],
      include: {
        planActivations:
          planCode === null
            ? false
            : {
                where: {
                  plan: {
                    code: planCode
                  }
                },
                take: 1
              }
      }
    });

    return tools.map((tool) => {
      const activation =
        Array.isArray(tool.planActivations) && tool.planActivations.length > 0
          ? tool.planActivations[0]
          : null;
      const promptMetadata = this.mapPromptMetadata(tool);
      return {
        ...promptMetadata,
        planActivationStatus: activation?.activationStatus ?? "inactive"
      };
    });
  }

  async listToolsForPromptMetadata(): Promise<ToolCatalogPromptMetadataView[]> {
    const tools = await this.prisma.toolCatalogTool.findMany({
      where: {
        status: "active",
        code: { in: CURRENT_TOOL_CODES }
      },
      orderBy: [{ toolClass: "asc" }, { displayName: "asc" }]
    });
    return tools.map((tool) => this.mapPromptMetadata(tool));
  }

  async updateToolPromptMetadata(
    toolCode: string,
    patch: {
      modelDescription?: string | null;
      modelUsageGuidance?: string | null;
    }
  ): Promise<ToolCatalogPromptMetadataView> {
    const existing = await this.prisma.toolCatalogTool.findUnique({
      where: { code: toolCode }
    });
    if (existing === null) {
      throw new Error(`Tool "${toolCode}" not found.`);
    }

    const updated = await this.prisma.toolCatalogTool.update({
      where: { code: toolCode },
      data: {
        providerHints: patchToolPromptMetadataState({
          existingProviderHints: existing.providerHints,
          modelDescription: patch.modelDescription,
          modelUsageGuidance: patch.modelUsageGuidance
        }) as Prisma.InputJsonValue
      }
    });

    return this.mapPromptMetadata(updated);
  }
}
