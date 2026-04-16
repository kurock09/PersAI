import type { Prisma, ToolCatalogStatus } from "@prisma/client";
import type { ToolCatalogEntry } from "./tool-catalog-data.js";
import { buildToolPromptMetadataState } from "../src/modules/workspace-management/application/tool-prompt-metadata";

type ToolCatalogSyncStore = {
  toolCatalogTool: {
    upsert(args: {
      where: { id: string };
      update: {
        code: string;
        displayName: string;
        description: string;
        capabilityGroup: ToolCatalogEntry["capabilityGroup"];
        toolClass: ToolCatalogEntry["toolClass"];
        status: ToolCatalogStatus | "active";
        providerHints: Prisma.InputJsonValue;
      };
      create: {
        id: string;
        code: string;
        displayName: string;
        description: string;
        capabilityGroup: ToolCatalogEntry["capabilityGroup"];
        toolClass: ToolCatalogEntry["toolClass"];
        status: ToolCatalogStatus | "active";
        providerHints: Prisma.InputJsonValue;
      };
    }): Promise<unknown>;
  };
};

export function buildToolCatalogProviderHints(tool: ToolCatalogEntry): Prisma.InputJsonValue {
  return buildToolPromptMetadataState({
    existingProviderHints: null,
    requiredCredentialId: tool.requiredCredentialId,
    defaultModelDescription: tool.modelDescription ?? tool.description,
    defaultModelUsageGuidance: tool.modelUsageGuidance
  }) as Prisma.InputJsonValue;
}

export async function upsertToolCatalogEntry(
  store: ToolCatalogSyncStore,
  tool: ToolCatalogEntry,
  existingProviderHints: unknown,
  status: ToolCatalogStatus | "active" = "active"
): Promise<void> {
  const providerHints = buildToolPromptMetadataState({
    existingProviderHints,
    requiredCredentialId: tool.requiredCredentialId,
    defaultModelDescription: tool.modelDescription ?? tool.description,
    defaultModelUsageGuidance: tool.modelUsageGuidance
  }) as Prisma.InputJsonValue;
  await store.toolCatalogTool.upsert({
    where: { id: tool.id },
    update: {
      code: tool.code,
      displayName: tool.displayName,
      description: tool.description,
      capabilityGroup: tool.capabilityGroup,
      toolClass: tool.toolClass,
      status,
      providerHints
    },
    create: {
      id: tool.id,
      code: tool.code,
      displayName: tool.displayName,
      description: tool.description,
      capabilityGroup: tool.capabilityGroup,
      toolClass: tool.toolClass,
      status,
      providerHints
    }
  });
}
