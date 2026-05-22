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
    userRows
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
    topBreakdown
  };
}
