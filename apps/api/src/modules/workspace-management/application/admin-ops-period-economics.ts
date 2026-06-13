import type { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type AdminOpsPeriodEconomicsSnapshot = {
  periodStartedAt: string;
  periodEndsAt: string;
  paidTotalMinor: number;
  paidCurrency: string | null;
  modelCostUsdMicros: number;
};

export type AdminPlatformPaymentRevenueAllTime = {
  rubTotalMinor: number;
  rubSucceededPayments: number;
  usdTotalMinor: number;
  usdSucceededPayments: number;
};

type CurrencyTotalsMap = Map<string, { totalMinor: number; paymentCount: number }>;

type RecurringBillingRevenueRow = {
  planCode: string | null;
  metadata: unknown;
};

const PAID_BILLING_EVENT_CODES = new Set([
  "payment_activated",
  "renewal_succeeded",
  "payment_recovered"
]);

function normalizeCurrency(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toMinorCurrencyUnits(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

function readRecurringBillingRevenueFromMetadata(
  metadata: unknown
): { amountMinor: number; currency: string } | null {
  const row = asObject(metadata);
  if (row === null) {
    return null;
  }
  const amountMinor = row.amountMinor;
  const currency = normalizeCurrency(typeof row.currency === "string" ? row.currency : null);
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor) || currency === null) {
    return null;
  }
  return {
    amountMinor: Math.round(amountMinor),
    currency
  };
}

function readPlanPriceFromBillingHints(
  billingProviderHints: unknown
): { amountMinor: number; currency: string } | null {
  const hints = asObject(billingProviderHints);
  const presentation = hints !== null ? asObject(hints.presentation) : null;
  const price = presentation !== null ? asObject(presentation.price) : null;
  const amountMajor =
    typeof price?.amount === "number" && Number.isFinite(price.amount) ? price.amount : null;
  const currency = normalizeCurrency(typeof price?.currency === "string" ? price.currency : null);
  if (amountMajor === null || currency === null) {
    return null;
  }
  return {
    amountMinor: toMinorCurrencyUnits(amountMajor),
    currency
  };
}

async function readPlanPriceFallbacks(
  prisma: WorkspaceManagementPrismaService,
  planCodes: Iterable<string>
): Promise<Map<string, { amountMinor: number; currency: string }>> {
  const uniquePlanCodes = Array.from(
    new Set(Array.from(planCodes).filter((code) => code.trim().length > 0))
  );
  if (uniquePlanCodes.length === 0) {
    return new Map();
  }
  const delegate = (
    prisma as unknown as {
      planCatalogPlan?: {
        findMany?: (args: {
          where: { code: { in: string[] } };
          select: { code: true; billingProviderHints: true };
        }) => Promise<Array<{ code: string; billingProviderHints: unknown }>>;
      };
    }
  ).planCatalogPlan;
  if (typeof delegate?.findMany !== "function") {
    return new Map();
  }
  const rows = await delegate.findMany({
    where: { code: { in: uniquePlanCodes } },
    select: { code: true, billingProviderHints: true }
  });
  const result = new Map<string, { amountMinor: number; currency: string }>();
  for (const row of rows) {
    const price = readPlanPriceFromBillingHints(row.billingProviderHints);
    if (price !== null) {
      result.set(row.code, price);
    }
  }
  return result;
}

async function readRecurringBillingRevenueRows(
  prisma: WorkspaceManagementPrismaService,
  where: {
    workspaceId?: string;
    currentPeriodStartedAt?: { gte: Date; lt: Date };
  }
): Promise<RecurringBillingRevenueRow[]> {
  const delegate = (
    prisma as unknown as {
      workspaceSubscriptionBillingEvent?: {
        findMany?: (args: {
          where: Record<string, unknown>;
          select: { planCode: true; metadata: true };
        }) => Promise<Array<RecurringBillingRevenueRow>>;
      };
    }
  ).workspaceSubscriptionBillingEvent;
  if (typeof delegate?.findMany !== "function") {
    return [];
  }
  return await delegate.findMany({
    where: {
      ...where,
      source: "provider",
      paymentIntentRef: null,
      applyStatus: "applied",
      eventCode: { in: Array.from(PAID_BILLING_EVENT_CODES) }
    },
    select: { planCode: true, metadata: true }
  });
}

function mergeCurrencyTotals(
  baseRows: Array<{
    currency: string;
    _sum: { amountMinor: number | null };
    _count?: { _all: number };
  }>,
  recurringRows: Array<{ amountMinor: number; currency: string }>
): CurrencyTotalsMap {
  const totals: CurrencyTotalsMap = new Map();
  for (const row of baseRows) {
    const currency = normalizeCurrency(row.currency);
    if (currency === null) {
      continue;
    }
    const existing = totals.get(currency) ?? { totalMinor: 0, paymentCount: 0 };
    existing.totalMinor += row._sum.amountMinor ?? 0;
    existing.paymentCount += row._count?._all ?? 0;
    totals.set(currency, existing);
  }
  for (const row of recurringRows) {
    const currency = normalizeCurrency(row.currency);
    if (currency === null) {
      continue;
    }
    const existing = totals.get(currency) ?? { totalMinor: 0, paymentCount: 0 };
    existing.totalMinor += row.amountMinor;
    existing.paymentCount += 1;
    totals.set(currency, existing);
  }
  return totals;
}

async function resolveRecurringRevenueWithFallback(
  prisma: WorkspaceManagementPrismaService,
  rows: RecurringBillingRevenueRow[]
): Promise<Array<{ amountMinor: number; currency: string }>> {
  const fallbackPrices = await readPlanPriceFallbacks(
    prisma,
    rows.map((row) => row.planCode).filter((code): code is string => typeof code === "string")
  );
  return rows
    .map((row) => {
      const direct = readRecurringBillingRevenueFromMetadata(row.metadata);
      if (direct !== null) {
        return direct;
      }
      if (row.planCode === null) {
        return null;
      }
      return fallbackPrices.get(row.planCode) ?? null;
    })
    .filter((row): row is { amountMinor: number; currency: string } => row !== null);
}

export async function readPlatformSucceededPaymentsAllTime(
  prisma: WorkspaceManagementPrismaService
): Promise<AdminPlatformPaymentRevenueAllTime> {
  const [intentRows, recurringBillingRows] = await Promise.all([
    prisma.workspacePaymentIntent.groupBy({
      by: ["currency"],
      where: { status: "succeeded" },
      _sum: { amountMinor: true },
      _count: { _all: true }
    }),
    readRecurringBillingRevenueRows(prisma, {})
  ]);
  const recurringRevenue = await resolveRecurringRevenueWithFallback(prisma, recurringBillingRows);
  const totals = mergeCurrencyTotals(intentRows, recurringRevenue);
  const rub = totals.get("RUB") ?? { totalMinor: 0, paymentCount: 0 };
  const usd = totals.get("USD") ?? { totalMinor: 0, paymentCount: 0 };
  return {
    rubTotalMinor: rub.totalMinor,
    rubSucceededPayments: rub.paymentCount,
    usdTotalMinor: usd.totalMinor,
    usdSucceededPayments: usd.paymentCount
  };
}

export async function readWorkspacePaidInPeriod(
  prisma: WorkspaceManagementPrismaService,
  input: {
    workspaceId: string;
    startedAt: Date;
    endedAt: Date;
  }
): Promise<{ totalMinor: number; currency: string | null }> {
  const [intentRows, recurringBillingRows] = await Promise.all([
    prisma.workspacePaymentIntent.groupBy({
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
    }),
    readRecurringBillingRevenueRows(prisma, {
      workspaceId: input.workspaceId,
      currentPeriodStartedAt: {
        gte: input.startedAt,
        lt: input.endedAt
      }
    })
  ]);
  const recurringRevenue = await resolveRecurringRevenueWithFallback(prisma, recurringBillingRows);
  const totals = mergeCurrencyTotals(intentRows, recurringRevenue);
  if (totals.size === 0) {
    return { totalMinor: 0, currency: null };
  }
  const sorted = [...totals.entries()].sort(
    (left, right) => right[1].totalMinor - left[1].totalMinor
  );
  const primary = sorted[0];
  return {
    totalMinor: primary?.[1].totalMinor ?? 0,
    currency: primary?.[0] ?? null
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
