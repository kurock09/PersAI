const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const assistantId = process.argv[2];
const needle = (process.argv[3] || "").toLowerCase();

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
    take: 120,
    select: {
      id: true,
      requestId: true,
      channel: true,
      externalThreadKey: true,
      status: true,
      createdAt: true,
      resultPayload: true
    }
  });

  const filtered = rows
    .map((row) => ({ ...row, summary: summarizePayload(row.resultPayload) }))
    .filter((row) => {
      const text = (row.summary?.assistantText || "").toLowerCase();
      const hasNeedle = needle ? text.includes(needle) : true;
      const hasBackgroundTool = (row.summary?.toolInvocations || []).some(
        (entry) => entry.name === "background_task"
      );
      return hasNeedle || hasBackgroundTool;
    });

  console.log(JSON.stringify(filtered, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
