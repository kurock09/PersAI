import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const jobs = await prisma.safetyModerationReviewJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      triggerKey: true,
      surface: true,
      messageSnapshot: true,
      precheckOutcome: true,
      createdAt: true,
      updatedAt: true
    }
  });
  const cases = await prisma.moderationCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      decision: true,
      reasonCode: true,
      triggerSnapshot: true,
      scores: true,
      createdAt: true
    }
  });
  console.log(JSON.stringify({ jobs, cases }, null, 2));
} finally {
  await prisma.$disconnect();
}
