import { PrismaClient } from "@prisma/client";
import { TOOL_CATALOG } from "./tool-catalog-data.js";
import { upsertToolCatalogEntry } from "./tool-catalog-sync.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const t of TOOL_CATALOG) {
    await upsertToolCatalogEntry(prisma, t, null);
  }
  console.log(`seed:catalog — upserted ${TOOL_CATALOG.length} tools`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
