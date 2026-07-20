import { Injectable } from "@nestjs/common";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { decodeTextGenerationUsageForApi } from "./text-generation-usage-accounting";

export interface ReadSmokeTurnReceiptsInput {
  assistantId: string;
  afterCursor: Date | null;
  requestId: string | null;
  limit: number;
}

export interface SmokeTurnReceiptUsageEntry {
  schemaVersion: 2;
  stepType: string;
  modelRole: string | null;
  providerKey: string | null;
  modelKey: string | null;
  toolCode: string | null;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheWriteInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SmokeTurnReceiptUsage {
  schemaVersion: 2;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheWriteInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
  toolCallsSource: "tool_invocations" | "usage_entries" | "none";
  toolInvocations: Array<{
    name: string;
    iteration: number;
    ok: boolean;
    executionMode: string | null;
  }>;
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
    const toolInvocations = extractToolInvocations(payload);
    const toolCallsFromInvocations = aggregateToolCallsFromInvocations(toolInvocations);
    const toolCallsFromUsage = aggregateToolCallsFromUsage(usage);
    const toolCalls = toolInvocations.length > 0 ? toolCallsFromInvocations : toolCallsFromUsage;
    const toolCallsSource: SmokeTurnReceiptItem["toolCallsSource"] =
      toolInvocations.length > 0
        ? "tool_invocations"
        : toolCallsFromUsage.length > 0
          ? "usage_entries"
          : "none";
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
      toolCallsSource,
      toolInvocations,
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
  const decoded = decodeTextGenerationUsageForApi(payload.textUsageAccounting);
  if (decoded.kind !== "v2") {
    return null;
  }
  const usage = decoded.usage;
  return {
    schemaVersion: 2,
    totalInputTokens: usage.totalInputTokens,
    uncachedInputTokens: usage.uncachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    entries: usage.entries.map((entry) => ({
      schemaVersion: 2,
      stepType: entry.stepType,
      modelRole: entry.modelRole,
      providerKey: entry.providerKey,
      modelKey: entry.modelKey,
      toolCode: entry.toolCode ?? null,
      totalInputTokens: entry.totalInputTokens,
      uncachedInputTokens: entry.uncachedInputTokens,
      cacheWriteInputTokens: entry.cacheWriteInputTokens,
      cacheReadInputTokens: entry.cacheReadInputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.totalTokens
    }))
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

function extractToolInvocations(
  payload: Record<string, unknown>
): SmokeTurnReceiptItem["toolInvocations"] {
  const raw = payload.toolInvocations;
  if (!Array.isArray(raw)) return [];
  const result: SmokeTurnReceiptItem["toolInvocations"] = [];
  for (const itemRaw of raw) {
    if (itemRaw === null || typeof itemRaw !== "object" || Array.isArray(itemRaw)) continue;
    const item = itemRaw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (name.length === 0) continue;
    const iteration =
      typeof item.iteration === "number" && Number.isFinite(item.iteration)
        ? Math.max(0, Math.trunc(item.iteration))
        : 0;
    const ok = item.ok === true;
    const executionModeRaw = item.executionMode;
    const executionMode =
      executionModeRaw === "inline" ||
      executionModeRaw === "worker" ||
      executionModeRaw === "sandbox"
        ? executionModeRaw
        : null;
    result.push({ name, iteration, ok, executionMode });
  }
  return result;
}

function aggregateToolCallsFromInvocations(
  invocations: SmokeTurnReceiptItem["toolInvocations"]
): Array<{ toolCode: string; count: number }> {
  if (invocations.length === 0) return [];
  const counts = new Map<string, number>();
  for (const invocation of invocations) {
    counts.set(invocation.name, (counts.get(invocation.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([toolCode, count]) => ({ toolCode, count }))
    .sort((a, b) => a.toolCode.localeCompare(b.toolCode));
}

function aggregateToolCallsFromUsage(
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
