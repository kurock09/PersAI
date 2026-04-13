import type { Prisma, ToolCatalogStatus } from "@prisma/client";
import type { ToolCatalogEntry } from "./tool-catalog-data.js";

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
  return tool.requiredCredentialId
    ? {
        schema: "persai.toolCatalogProviderHints.v2",
        providerAgnostic: false,
        requiredCredentialId: tool.requiredCredentialId
      }
    : { schema: "persai.toolCatalogProviderHints.v1", providerAgnostic: true };
}

export async function upsertToolCatalogEntry(
  store: ToolCatalogSyncStore,
  tool: ToolCatalogEntry,
  status: ToolCatalogStatus | "active" = "active"
): Promise<void> {
  const providerHints = buildToolCatalogProviderHints(tool);
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
