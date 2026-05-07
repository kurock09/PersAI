const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const ids = process.argv.slice(2);

if (ids.length === 0) {
  console.error("At least one media job id is required");
  process.exit(1);
}

async function main() {
  const rows = await prisma.assistantMediaJob.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      assistantId: true,
      status: true,
      kind: true,
      sourceUserMessageId: true,
      requestJson: true,
      resultText: true,
      artifactsJson: true,
      attemptCount: true,
      maxAttempts: true,
      nextRetryAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      deliveredAt: true,
      assistantAcknowledgementMessageId: true,
      completionAssistantMessageId: true
    }
  });

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
