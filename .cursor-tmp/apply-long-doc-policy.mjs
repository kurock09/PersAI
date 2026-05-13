const targetPlans = new Map([
  ["free", { fetchFullModeMaxChars: 20_000, fetchFullModeMaxChatMessages: 50 }],
  ["basic", { fetchFullModeMaxChars: 60_000, fetchFullModeMaxChatMessages: 100 }],
  ["pro", { fetchFullModeMaxChars: 200_000, fetchFullModeMaxChatMessages: 200 }],
  ["starter_trial", { fetchFullModeMaxChars: 200_000, fetchFullModeMaxChatMessages: 200 }],
  ["ultima", { fetchFullModeMaxChars: 400_000, fetchFullModeMaxChatMessages: 400 }]
]);

const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();

try {
  const plans = await prisma.planCatalogPlan.findMany({
    where: {
      code: {
        in: [...targetPlans.keys()]
      }
    },
    select: {
      id: true,
      code: true,
      billingProviderHints: true
    }
  });

  for (const plan of plans) {
    const target = targetPlans.get(plan.code);
    if (!target) {
      continue;
    }
    const hints =
      plan.billingProviderHints !== null &&
      typeof plan.billingProviderHints === "object" &&
      !Array.isArray(plan.billingProviderHints)
        ? { ...plan.billingProviderHints }
        : {};
    const retrievalPolicy =
      hints.retrievalPolicy !== null &&
      typeof hints.retrievalPolicy === "object" &&
      !Array.isArray(hints.retrievalPolicy)
        ? { ...hints.retrievalPolicy }
        : {};

    retrievalPolicy.fetchFullModeMaxChars = target.fetchFullModeMaxChars;
    retrievalPolicy.fetchFullModeMaxChatMessages = target.fetchFullModeMaxChatMessages;
    hints.retrievalPolicy = retrievalPolicy;

    await prisma.planCatalogPlan.update({
      where: { id: plan.id },
      data: {
        billingProviderHints: hints
      }
    });

    console.log(
      JSON.stringify({
        code: plan.code,
        fetchFullModeMaxChars: target.fetchFullModeMaxChars,
        fetchFullModeMaxChatMessages: target.fetchFullModeMaxChatMessages
      })
    );
  }
} finally {
  await prisma.$disconnect();
}
