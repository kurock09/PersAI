import { Injectable } from "@nestjs/common";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface ReadSmokeTurnReceiptsInput {
  assistantId: string;
  afterCursor: Date | null;
  requestId: string | null;
  limit: number;
}

export interface SmokeTurnReceiptUsageEntry {
  stepType: string;
  modelRole: string | null;
  providerKey: string | null;
  modelKey: string | null;
  toolCode: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface SmokeTurnReceiptUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  entries: SmokeTurnReceiptUsageEntry[];
}

export interface SmokeTurnReceiptItem {
  receiptId: string;
  requestId: string;
  status: string;
  channel: string;
  mode: string;
  conversationKey: string;
  externalThreadKey: string;
  bundleHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  usage: SmokeTurnReceiptUsage | null;
  toolCalls: Array<{ toolCode: string; count: number }>;
  routingMode: string | null;
  routingExecutionMode: string | null;
  autoCompactionTokensBefore: number | null;
  autoCompactionTokensAfter: number | null;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Injectable()
export class ReadSmokeTurnReceiptsService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseInput(query: Record<string, string | string[] | undefined>): ReadSmokeTurnReceiptsInput {
    const assistantIdRaw = pickFirst(query.assistantId);
    if (typeof assistantIdRaw !== "string" || assistantIdRaw.trim().length === 0) {
      throw new ApiErrorHttpException(400, {
        code: "assistant_id_required",
        category: "validation",
        message: "assistantId query parameter is required."
      });
    }
    const afterCursorRaw = pickFirst(query.afterCursor);
    let afterCursor: Date | null = null;
    if (typeof afterCursorRaw === "string" && afterCursorRaw.trim().length > 0) {
      const parsed = new Date(afterCursorRaw.trim());
      if (Number.isNaN(parsed.valueOf())) {
        throw new ApiErrorHttpException(400, {
          code: "after_cursor_invalid",
          category: "validation",
          message: "afterCursor must be a valid ISO timestamp."
        });
      }
      afterCursor = parsed;
    }
    const requestIdRaw = pickFirst(query.requestId);
    const requestId =
      typeof requestIdRaw === "string" && requestIdRaw.trim().length > 0
        ? requestIdRaw.trim()
        : null;
    const limitRaw = pickFirst(query.limit);
    let limit = DEFAULT_LIMIT;
    if (typeof limitRaw === "string" && limitRaw.trim().length > 0) {
      const parsed = Number.parseInt(limitRaw.trim(), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ApiErrorHttpException(400, {
          code: "limit_invalid",
          category: "validation",
          message: "limit must be a positive integer."
        });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }
    return {
      assistantId: assistantIdRaw.trim(),
      afterCursor,
      requestId,
      limit
    };
  }

  async execute(input: ReadSmokeTurnReceiptsInput): Promise<{
    items: SmokeTurnReceiptItem[];
    nextCursor: string | null;
  }> {
    const rows = await this.prisma.runtimeTurnReceipt.findMany({
      where: {
        assistantId: input.assistantId,
        ...(input.afterCursor === null ? {} : { createdAt: { gt: input.afterCursor } }),
        ...(input.requestId === null ? {} : { requestId: input.requestId })
      },
      orderBy: { createdAt: "asc" },
      take: input.limit
    });

    const items = rows.map((row) => this.mapRow(row));
    const last = items[items.length - 1];
    const nextCursor = last ? last.createdAt : null;
    return { items, nextCursor };
  }

  private mapRow(row: {
    id: string;
    requestId: string;
    status: string;
    channel: string;
    mode: string;
    conversationKey: string;
    externalThreadKey: string;
    bundleHash: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    resultPayload: unknown;
  }): SmokeTurnReceiptItem {
    const payload =
      row.resultPayload !== null &&
      typeof row.resultPayload === "object" &&
      !Array.isArray(row.resultPayload)
        ? (row.resultPayload as Record<string, unknown>)
        : {};
    const usage = extractUsage(payload);
    const routing = extractRouting(payload);
    const compaction = extractCompaction(payload);
    const toolCalls = aggregateToolCalls(usage);
    return {
      receiptId: row.id,
      requestId: row.requestId,
      status: row.status,
      channel: row.channel,
      mode: row.mode,
      conversationKey: row.conversationKey,
      externalThreadKey: row.externalThreadKey,
      bundleHash: row.bundleHash,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
      usage,
      toolCalls,
      routingMode: routing.mode,
      routingExecutionMode: routing.executionMode,
      autoCompactionTokensBefore: compaction.tokensBefore,
      autoCompactionTokensAfter: compaction.tokensAfter
    };
  }
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractUsage(payload: Record<string, unknown>): SmokeTurnReceiptUsage | null {
  const raw = payload.usageAccounting;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const usage = raw as Record<string, unknown>;
  const entriesRaw = Array.isArray(usage.entries) ? (usage.entries as unknown[]) : [];
  const entries = entriesRaw
    .map((entryRaw): SmokeTurnReceiptUsageEntry | null => {
      if (entryRaw === null || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
        return null;
      }
      const entry = entryRaw as Record<string, unknown>;
      return {
        stepType: typeof entry.stepType === "string" ? entry.stepType : "unknown",
        modelRole: typeof entry.modelRole === "string" ? entry.modelRole : null,
        providerKey: typeof entry.providerKey === "string" ? entry.providerKey : null,
        modelKey: typeof entry.modelKey === "string" ? entry.modelKey : null,
        toolCode: typeof entry.toolCode === "string" ? entry.toolCode : null,
        inputTokens: numberOrNull(entry.inputTokens),
        cachedInputTokens: numberOrNull(entry.cachedInputTokens),
        outputTokens: numberOrNull(entry.outputTokens),
        totalTokens: numberOrNull(entry.totalTokens)
      };
    })
    .filter((entry): entry is SmokeTurnReceiptUsageEntry => entry !== null);
  return {
    inputTokens: numberOrNull(usage.inputTokens),
    cachedInputTokens: numberOrNull(usage.cachedInputTokens),
    outputTokens: numberOrNull(usage.outputTokens),
    totalTokens: numberOrNull(usage.totalTokens),
    entries
  };
}

function extractRouting(payload: Record<string, unknown>): {
  mode: string | null;
  executionMode: string | null;
} {
  const raw = payload.turnRouting;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { mode: null, executionMode: null };
  }
  const routing = raw as Record<string, unknown>;
  return {
    mode: typeof routing.mode === "string" ? routing.mode : null,
    executionMode: typeof routing.executionMode === "string" ? routing.executionMode : null
  };
}

function extractCompaction(payload: Record<string, unknown>): {
  tokensBefore: number | null;
  tokensAfter: number | null;
} {
  const raw = payload.autoCompaction;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { tokensBefore: null, tokensAfter: null };
  }
  const auto = raw as Record<string, unknown>;
  return {
    tokensBefore: numberOrNull(auto.tokensBefore),
    tokensAfter: numberOrNull(auto.tokensAfter)
  };
}

function aggregateToolCalls(
  usage: SmokeTurnReceiptUsage | null
): Array<{ toolCode: string; count: number }> {
  if (usage === null) return [];
  const counts = new Map<string, number>();
  for (const entry of usage.entries) {
    if (entry.toolCode === null) continue;
    counts.set(entry.toolCode, (counts.get(entry.toolCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([toolCode, count]) => ({ toolCode, count }))
    .sort((a, b) => a.toolCode.localeCompare(b.toolCode));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
