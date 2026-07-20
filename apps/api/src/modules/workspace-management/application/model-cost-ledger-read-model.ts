import type { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type AdminModelCostLedgerPeriodSource =
  | "rolling_7d"
  | "subscription_period"
  | "calendar_month_fallback"
  | "all_time";

export type AdminModelCostLedgerCurrencyTotal = {
  currency: string;
  eventCount: number;
  totalCostMicros: number;
};

export type AdminModelCostLedgerBreakdownItem = {
  key: string;
  label: string;
  eventCount: number;
  totalCostMicros: number;
};

export type AdminModelCostLedgerTopBreakdownItem = {
  provider: string;
  model: string;
  purpose: string;
  purposeLabel: string;
  surface: string;
  surfaceLabel: string;
  currency: string;
  eventCount: number;
  totalCostMicros: number;
};

export type AdminTextCacheAccountingAggregate = {
  v2CallCount: number;
  v2TurnCount: number;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheWriteInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  hitCallCount: number;
  actualCachedInputCostMicros: number;
  noCacheInputCostMicros: number;
  netCacheSavingsMicros: number;
  cacheReadSharePercent: number | null;
  cacheWriteSharePercent: number | null;
  hitCallSharePercent: number | null;
  netCacheSavingsPercent: number | null;
};

export type AdminTextCacheProviderCohort = AdminTextCacheAccountingAggregate & {
  provider: string;
  model: string;
  currency: string;
};

export type AdminTextCacheCurrencyAggregate = AdminTextCacheAccountingAggregate & {
  currency: string;
};

export type AdminModelCostLedgerWindowState = {
  windowLabel: string;
  startedAt: string;
  endedAt: string | null;
  periodSource: AdminModelCostLedgerPeriodSource;
  coverageScope: "adr099_block1_model_priced_paths";
  coverageNote: string;
  totalEvents: number;
  trackedWorkspaces: number;
  trackedUsers: number;
  hasMultipleCurrencies: boolean;
  currencyTotals: AdminModelCostLedgerCurrencyTotal[];
  byPurpose: AdminModelCostLedgerBreakdownItem[];
  bySurface: AdminModelCostLedgerBreakdownItem[];
  topBreakdown: AdminModelCostLedgerTopBreakdownItem[];
  textCacheAccountingV2: AdminTextCacheCurrencyAggregate[];
  textCacheAccountingV2ByProvider: AdminTextCacheProviderCohort[];
};

export const ADMIN_MODEL_COST_LEDGER_COVERAGE_NOTE =
  "Current ledger-backed model cost covers model-priced paths when Admin Runtime catalog rows match the event timestamp: ordinary web/Telegram chat (main reply + router), background-task evaluator usage, persisted media job and attachment billing facts (image/video/STT/TTS), retrieval-helper reranker usage, upload micro-description helper usage, knowledge indexing embedding calls, async media/document completion framing usage, standalone voice HTTP transcribe events, and Mistral OCR document extraction. Tool-path economics (web_search, web_fetch, browser, document_render) price from Admin > Tools when billing facts and tool-path catalog rows match the event timestamp. Other non-ledger tool paths remain outside this summary.";

function asNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function labelPurpose(value: string): string {
  switch (value) {
    case "chat_main_reply":
      return "Main reply";
    case "background_task":
      return "Background task evaluator";
    case "router":
      return "Router / classifier";
    case "image_generation":
      return "Image generation";
    case "image_edit":
      return "Image edit";
    case "video_generation":
      return "Video generation";
    case "stt":
      return "Speech-to-text";
    case "tts":
      return "Text-to-speech";
    case "retrieval_helper":
      return "Retrieval helper";
    case "tool_helper":
      return "Tool helper";
    case "chat_helper":
      return "Completion framing";
    case "document_generation":
      return "Document generation (worker LLM)";
    case "ocr_or_document_parsing":
      return "OCR / document parsing";
    case "knowledge_embedding":
      return "Knowledge indexing (embeddings)";
    case "web_search":
      return "Web search";
    case "web_fetch":
      return "Web fetch";
    case "browser":
      return "Browser";
    case "document_render":
      return "Document render";
    default:
      return value.replaceAll("_", " ");
  }
}

function labelSurface(value: string): string {
  switch (value) {
    case "background":
      return "Background";
    case "web":
      return "Web";
    case "telegram":
      return "Telegram";
    default:
      return value.replaceAll("_", " ");
  }
}

type V2RawUsage = {
  providerKey: string;
  modelKey: string;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheWriteInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  actualCachedInputCostMicros: number;
  noCacheInputCostMicros: number;
  sourceEventId: string | null;
  currency: string;
};

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readV2RawUsage(
  value: unknown,
  sourceEventId: string | null,
  currency: string
): V2RawUsage | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const providerKey = typeof row.providerKey === "string" ? row.providerKey : null;
  const modelKey = typeof row.modelKey === "string" ? row.modelKey : null;
  const totalInputTokens = nonNegativeInteger(row.totalInputTokens);
  const uncachedInputTokens = nonNegativeInteger(row.uncachedInputTokens);
  const cacheWriteInputTokens = nonNegativeInteger(row.cacheWriteInputTokens);
  const cacheReadInputTokens = nonNegativeInteger(row.cacheReadInputTokens);
  const outputTokens = nonNegativeInteger(row.outputTokens);
  const totalTokens = nonNegativeInteger(row.totalTokens);
  const actualCachedInputCostMicros = nonNegativeInteger(row.actualCachedInputCostMicros);
  const noCacheInputCostMicros = nonNegativeInteger(row.noCacheInputCostMicros);
  if (
    providerKey === null ||
    modelKey === null ||
    totalInputTokens === null ||
    uncachedInputTokens === null ||
    cacheWriteInputTokens === null ||
    cacheReadInputTokens === null ||
    outputTokens === null ||
    totalTokens === null ||
    actualCachedInputCostMicros === null ||
    noCacheInputCostMicros === null ||
    totalInputTokens !== uncachedInputTokens + cacheWriteInputTokens + cacheReadInputTokens ||
    totalTokens !== totalInputTokens + outputTokens
  ) {
    return null;
  }
  return {
    providerKey,
    modelKey,
    totalInputTokens,
    uncachedInputTokens,
    cacheWriteInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens,
    actualCachedInputCostMicros,
    noCacheInputCostMicros,
    sourceEventId,
    currency
  };
}

function emptyTextCacheAggregate(): AdminTextCacheAccountingAggregate {
  return {
    v2CallCount: 0,
    v2TurnCount: 0,
    totalInputTokens: 0,
    uncachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hitCallCount: 0,
    actualCachedInputCostMicros: 0,
    noCacheInputCostMicros: 0,
    netCacheSavingsMicros: 0,
    cacheReadSharePercent: null,
    cacheWriteSharePercent: null,
    hitCallSharePercent: null,
    netCacheSavingsPercent: null
  };
}

function finalizeTextCacheAggregate(
  aggregate: AdminTextCacheAccountingAggregate,
  turns: Set<string>
): AdminTextCacheAccountingAggregate {
  aggregate.v2TurnCount = turns.size;
  aggregate.netCacheSavingsMicros =
    aggregate.noCacheInputCostMicros - aggregate.actualCachedInputCostMicros;
  aggregate.cacheReadSharePercent =
    aggregate.totalInputTokens === 0
      ? null
      : (aggregate.cacheReadInputTokens / aggregate.totalInputTokens) * 100;
  aggregate.cacheWriteSharePercent =
    aggregate.totalInputTokens === 0
      ? null
      : (aggregate.cacheWriteInputTokens / aggregate.totalInputTokens) * 100;
  aggregate.hitCallSharePercent =
    aggregate.v2CallCount === 0 ? null : (aggregate.hitCallCount / aggregate.v2CallCount) * 100;
  aggregate.netCacheSavingsPercent =
    aggregate.noCacheInputCostMicros === 0
      ? null
      : (aggregate.netCacheSavingsMicros / aggregate.noCacheInputCostMicros) * 100;
  return aggregate;
}

export async function readAdminModelCostLedgerWindow(
  prisma: WorkspaceManagementPrismaService,
  input: {
    startedAt: Date;
    endedAt?: Date;
    windowLabel: string;
    periodSource: AdminModelCostLedgerPeriodSource;
    workspaceId?: string;
    topBreakdownLimit?: number;
  }
): Promise<AdminModelCostLedgerWindowState> {
  const where = {
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    occurredAt: {
      gte: input.startedAt,
      ...(input.endedAt ? { lt: input.endedAt } : {})
    }
  };

  const [
    currencyTotalsRaw,
    purposeTotalsRaw,
    surfaceTotalsRaw,
    topBreakdownRaw,
    workspaceRows,
    userRows,
    v2Rows
  ] = await Promise.all([
    prisma.modelCostLedgerEvent.groupBy({
      where,
      by: ["currency"],
      _sum: { actualCostMicros: true },
      _count: { _all: true }
    }),
    prisma.modelCostLedgerEvent.groupBy({
      where,
      by: ["purpose"],
      _sum: { actualCostMicros: true },
      _count: { _all: true }
    }),
    prisma.modelCostLedgerEvent.groupBy({
      where,
      by: ["surface"],
      _sum: { actualCostMicros: true },
      _count: { _all: true }
    }),
    prisma.modelCostLedgerEvent.groupBy({
      where,
      by: ["provider", "model", "purpose", "surface", "currency"],
      _sum: { actualCostMicros: true },
      _count: { _all: true }
    }),
    prisma.modelCostLedgerEvent.findMany({
      where,
      distinct: ["workspaceId"],
      select: { workspaceId: true }
    }),
    prisma.modelCostLedgerEvent.findMany({
      where: {
        ...where,
        userId: { not: null }
      },
      distinct: ["userId"],
      select: { userId: true }
    }),
    prisma.modelCostLedgerEvent.findMany({
      where: {
        ...where,
        capability: "chat",
        rawUsage: { path: ["schemaVersion"], equals: 2 }
      },
      select: { rawUsage: true, sourceEventId: true, currency: true }
    })
  ]);

  const currencyTotals = currencyTotalsRaw
    .map((row) => ({
      currency: row.currency,
      eventCount: row._count._all,
      totalCostMicros: asNumber(row._sum.actualCostMicros)
    }))
    .sort((left, right) => right.totalCostMicros - left.totalCostMicros);

  const byPurpose = purposeTotalsRaw
    .map((row) => ({
      key: row.purpose,
      label: labelPurpose(row.purpose),
      eventCount: row._count._all,
      totalCostMicros: asNumber(row._sum.actualCostMicros)
    }))
    .sort((left, right) => right.totalCostMicros - left.totalCostMicros);

  const bySurface = surfaceTotalsRaw
    .map((row) => ({
      key: row.surface,
      label: labelSurface(row.surface),
      eventCount: row._count._all,
      totalCostMicros: asNumber(row._sum.actualCostMicros)
    }))
    .sort((left, right) => right.totalCostMicros - left.totalCostMicros);

  const topBreakdown = topBreakdownRaw
    .map((row) => ({
      provider: row.provider,
      model: row.model,
      purpose: row.purpose,
      purposeLabel: labelPurpose(row.purpose),
      surface: row.surface,
      surfaceLabel: labelSurface(row.surface),
      currency: row.currency,
      eventCount: row._count._all,
      totalCostMicros: asNumber(row._sum.actualCostMicros)
    }))
    .sort((left, right) => {
      if (right.totalCostMicros !== left.totalCostMicros) {
        return right.totalCostMicros - left.totalCostMicros;
      }
      return right.eventCount - left.eventCount;
    })
    .slice(0, input.topBreakdownLimit ?? 6);

  const currencyAggregates = new Map<
    string,
    { aggregate: AdminTextCacheAccountingAggregate; turns: Set<string> }
  >();
  const cohorts = new Map<
    string,
    {
      aggregate: AdminTextCacheAccountingAggregate;
      turns: Set<string>;
      provider: string;
      model: string;
      currency: string;
    }
  >();
  for (const row of v2Rows) {
    const usage = readV2RawUsage(row.rawUsage, row.sourceEventId, row.currency);
    if (usage === null) continue;
    const apply = (aggregate: AdminTextCacheAccountingAggregate, turns: Set<string>) => {
      aggregate.v2CallCount += 1;
      aggregate.totalInputTokens += usage.totalInputTokens;
      aggregate.uncachedInputTokens += usage.uncachedInputTokens;
      aggregate.cacheWriteInputTokens += usage.cacheWriteInputTokens;
      aggregate.cacheReadInputTokens += usage.cacheReadInputTokens;
      aggregate.outputTokens += usage.outputTokens;
      aggregate.totalTokens += usage.totalTokens;
      aggregate.hitCallCount += usage.cacheReadInputTokens > 0 ? 1 : 0;
      aggregate.actualCachedInputCostMicros += usage.actualCachedInputCostMicros;
      aggregate.noCacheInputCostMicros += usage.noCacheInputCostMicros;
      if (usage.sourceEventId !== null) turns.add(usage.sourceEventId);
    };
    const currencyAggregate = currencyAggregates.get(usage.currency) ?? {
      aggregate: emptyTextCacheAggregate(),
      turns: new Set<string>()
    };
    apply(currencyAggregate.aggregate, currencyAggregate.turns);
    currencyAggregates.set(usage.currency, currencyAggregate);
    const key = `${usage.providerKey}\u0000${usage.modelKey}\u0000${usage.currency}`;
    const cohort = cohorts.get(key) ?? {
      aggregate: emptyTextCacheAggregate(),
      turns: new Set<string>(),
      provider: usage.providerKey,
      model: usage.modelKey,
      currency: usage.currency
    };
    apply(cohort.aggregate, cohort.turns);
    cohorts.set(key, cohort);
  }
  const textCacheAccountingV2ByProvider = [...cohorts.values()]
    .map(({ aggregate, turns, provider, model, currency }) => ({
      provider,
      model,
      currency,
      ...finalizeTextCacheAggregate(aggregate, turns)
    }))
    .sort((left, right) => right.noCacheInputCostMicros - left.noCacheInputCostMicros);

  return {
    windowLabel: input.windowLabel,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt?.toISOString() ?? null,
    periodSource: input.periodSource,
    coverageScope: "adr099_block1_model_priced_paths",
    coverageNote: ADMIN_MODEL_COST_LEDGER_COVERAGE_NOTE,
    totalEvents: currencyTotals.reduce((sum, row) => sum + row.eventCount, 0),
    trackedWorkspaces: workspaceRows.length,
    trackedUsers: userRows.length,
    hasMultipleCurrencies: currencyTotals.length > 1,
    currencyTotals,
    byPurpose,
    bySurface,
    topBreakdown,
    textCacheAccountingV2: [...currencyAggregates.entries()]
      .map(([currency, { aggregate, turns }]) => ({
        currency,
        ...finalizeTextCacheAggregate(aggregate, turns)
      }))
      .sort((left, right) => right.noCacheInputCostMicros - left.noCacheInputCostMicros),
    textCacheAccountingV2ByProvider
  };
}
