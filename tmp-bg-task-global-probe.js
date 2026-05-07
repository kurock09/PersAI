const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const recentTasks = await prisma.assistantBackgroundTask.findMany({
    where: {
      OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }]
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      assistantId: true,
      title: true,
      status: true,
      nextRunAt: true,
      runCount: true,
      lastRunAt: true,
      lastRunStatus: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const recentRuns = await prisma.assistantBackgroundTaskRun.findMany({
    where: {
      OR: [{ createdAt: { gte: since } }, { startedAt: { gte: since } }, { finishedAt: { gte: since } }]
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      taskId: true,
      assistantId: true,
      status: true,
      scheduledRunAt: true,
      startedAt: true,
      finishedAt: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true
    }
  });

  console.log(JSON.stringify({ since: since.toISOString(), recentTasks, recentRuns }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
