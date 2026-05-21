import type { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type AdminOpsPeriodEconomicsSnapshot = {
  periodStartedAt: string;
  periodEndsAt: string;
  paidTotalMinor: number;
  paidCurrency: string | null;
  modelCostUsdMicros: number;
};

export async function readWorkspacePaidInPeriod(
  prisma: WorkspaceManagementPrismaService,
  input: {
    workspaceId: string;
    startedAt: Date;
    endedAt: Date;
  }
): Promise<{ totalMinor: number; currency: string | null }> {
  const rows = await prisma.workspacePaymentIntent.groupBy({
    by: ["currency"],
    where: {
      workspaceId: input.workspaceId,
      status: "succeeded",
      updatedAt: {
        gte: input.startedAt,
        lt: input.endedAt
      }
    },
    _sum: { amountMinor: true }
  });
  if (rows.length === 0) {
    return { totalMinor: 0, currency: null };
  }
  const sorted = [...rows].sort(
    (left, right) => (right._sum.amountMinor ?? 0) - (left._sum.amountMinor ?? 0)
  );
  const primary = sorted[0];
  return {
    totalMinor: primary?._sum.amountMinor ?? 0,
    currency: primary?.currency ?? null
  };
}

export async function readWorkspaceModelCostUsdMicros(
  prisma: WorkspaceManagementPrismaService,
  input: {
    workspaceId: string;
    startedAt: Date;
    endedAt: Date;
  }
): Promise<number> {
  const aggregate = await prisma.modelCostLedgerEvent.aggregate({
    where: {
      workspaceId: input.workspaceId,
      currency: "USD",
      occurredAt: {
        gte: input.startedAt,
        lt: input.endedAt
      }
    },
    _sum: { actualCostMicros: true }
  });
  const total = aggregate._sum.actualCostMicros;
  return typeof total === "bigint" ? Number(total) : (total ?? 0);
}

export async function readWorkspacePeriodEconomics(
  prisma: WorkspaceManagementPrismaService,
  input: {
    workspaceId: string;
    periodStartedAt: string;
    periodEndsAt: string;
  }
): Promise<AdminOpsPeriodEconomicsSnapshot> {
  const startedAt = new Date(input.periodStartedAt);
  const endedAt = new Date(input.periodEndsAt);
  const [paid, modelCostUsdMicros] = await Promise.all([
    readWorkspacePaidInPeriod(prisma, { workspaceId: input.workspaceId, startedAt, endedAt }),
    readWorkspaceModelCostUsdMicros(prisma, { workspaceId: input.workspaceId, startedAt, endedAt })
  ]);
  return {
    periodStartedAt: input.periodStartedAt,
    periodEndsAt: input.periodEndsAt,
    paidTotalMinor: paid.totalMinor,
    paidCurrency: paid.currency,
    modelCostUsdMicros
  };
}
