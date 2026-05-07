const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const assistantId = process.argv[2];

if (!assistantId) {
  console.error("assistantId argument is required");
  process.exit(1);
}

async function main() {
  const spec = await prisma.assistantMaterializedSpec.findFirst({
    where: { assistantId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      createdAt: true,
      runtimeBundleDocument: true
    }
  });

  if (!spec?.runtimeBundleDocument) {
    console.log(JSON.stringify({ assistantId, spec: null }, null, 2));
    return;
  }

  const bundle = JSON.parse(spec.runtimeBundleDocument);
  const toolPolicies = Array.isArray(bundle?.governance?.toolPolicies)
    ? bundle.governance.toolPolicies
    : [];
  const workerTools = Array.isArray(bundle?.runtime?.workerTools?.tools)
    ? bundle.runtime.workerTools.tools
    : [];

  console.log(
    JSON.stringify(
      {
        assistantId,
        specId: spec.id,
        specCreatedAt: spec.createdAt,
        backgroundTaskPolicy: toolPolicies.find((entry) => entry?.toolCode === "background_task") ?? null,
        scheduledActionPolicy: toolPolicies.find((entry) => entry?.toolCode === "scheduled_action") ?? null,
        backgroundTaskWorkerTool: workerTools.find((entry) => entry?.toolCode === "background_task") ?? null,
        workerToolCodes: workerTools.map((entry) => entry?.toolCode).filter(Boolean)
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
