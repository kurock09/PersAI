const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const assistantId = process.argv[2];

if (!assistantId) {
  console.error("assistantId argument is required");
  process.exit(1);
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const toolInvocations = Array.isArray(payload.toolInvocations)
    ? payload.toolInvocations.map((entry) => ({
        name: entry?.name ?? null,
        iteration: entry?.iteration ?? null,
        ok: entry?.ok ?? null,
        reason: entry?.reason ?? null
      }))
    : [];
  return {
    assistantText: typeof payload.assistantText === "string" ? payload.assistantText : null,
    toolInvocations
  };
}

async function main() {
  const rows = await prisma.runtimeTurnReceipt.findMany({
    where: { assistantId },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      requestId: true,
      channel: true,
      externalThreadKey: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      resultPayload: true
    }
  });

  console.log(
    JSON.stringify(
      rows.map((row) => ({
        ...row,
        summary: summarizePayload(row.resultPayload)
      })),
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
