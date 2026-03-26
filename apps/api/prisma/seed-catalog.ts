import { PrismaClient, ToolCatalogStatus } from "@prisma/client";
import { TOOL_CATALOG } from "./tool-catalog-data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const t of TOOL_CATALOG) {
    const providerHints = t.requiredCredentialId
      ? {
          schema: "persai.toolCatalogProviderHints.v2",
          providerAgnostic: false,
          requiredCredentialId: t.requiredCredentialId
        }
      : { schema: "persai.toolCatalogProviderHints.v1", providerAgnostic: true };

    await prisma.toolCatalogTool.upsert({
      where: { code: t.code },
      update: {
        displayName: t.displayName,
        description: t.description,
        capabilityGroup: t.capabilityGroup,
        toolClass: t.toolClass,
        status: ToolCatalogStatus.active,
        providerHints
      },
      create: {
        id: t.id,
        code: t.code,
        displayName: t.displayName,
        description: t.description,
        capabilityGroup: t.capabilityGroup,
        toolClass: t.toolClass,
        status: ToolCatalogStatus.active,
        providerHints
      }
    });
  }
  console.log(`seed:catalog — upserted ${TOOL_CATALOG.length} tools`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
