const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const assistantId = process.argv[2];

if (!assistantId) {
  console.error("assistantId argument is required");
  process.exit(1);
}

async function main() {
  const tasks = await prisma.assistantBackgroundTask.findMany({
    where: { assistantId },
    orderBy: [{ updatedAt: "desc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      brief: true,
      status: true,
      nextRunAt: true,
      retryAfterAt: true,
      attemptCount: true,
      runCount: true,
      lastRunAt: true,
      lastRunStatus: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      schedulerClaimEpoch: true,
      schedulerClaimedAt: true,
      schedulerClaimExpiresAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const runs = await prisma.assistantBackgroundTaskRun.findMany({
    where: { assistantId },
    orderBy: [{ startedAt: "desc" }],
    take: 30,
    select: {
      id: true,
      taskId: true,
      status: true,
      scheduledRunAt: true,
      startedAt: true,
      finishedAt: true,
      decisionJson: true,
      pushText: true,
      errorCode: true,
      errorMessage: true
    }
  });

  const chats = await prisma.assistantChat.findMany({
    where: { assistantId },
    orderBy: [{ updatedAt: "desc" }],
    take: 5,
    select: {
      id: true,
      surface: true,
      surfaceThreadKey: true,
      updatedAt: true
    }
  });

  const messages = chats.length
    ? await prisma.assistantChatMessage.findMany({
        where: {
          assistantId,
          chatId: { in: chats.map((chat) => chat.id) }
        },
        orderBy: [{ createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          chatId: true,
          author: true,
          content: true,
          createdAt: true
        }
      })
    : [];

  console.log(
    JSON.stringify(
      {
        assistantId,
        tasks,
        runs,
        chats,
        messages
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
