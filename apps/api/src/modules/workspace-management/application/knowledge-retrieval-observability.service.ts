import { Injectable } from "@nestjs/common";
import type {
  KnowledgeRetrievalEvent as PrismaKnowledgeRetrievalEvent,
  KnowledgeRetrievalRollup as PrismaKnowledgeRetrievalRollup
} from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MAX_RECENT_EVENTS = 40;

export type KnowledgeRetrievalTrackedSource =
  | "document"
  | "global"
  | "product"
  | "skill"
  | "memory"
  | "chat"
  | "preset"
  | "subscription"
  | "web";
export type KnowledgeRetrievalMode = "lexical" | "hybrid";
export type KnowledgeRetrievalOutcome = "success" | "empty" | "error";
export type KnowledgeRetrievalEventKind = "search" | "fetch";

export type KnowledgeRetrievalMetricSummary = {
  searchesTotal: number;
  fetchesTotal: number;
  successTotal: number;
  emptyTotal: number;
  errorTotal: number;
  lexicalTotal: number;
  hybridTotal: number;
  helperAppliedTotal: number;
  embeddingQueryTotal: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgResultCount: number;
  avgLexicalCandidates: number;
  avgVectorCandidates: number;
  avgFetchDepth: number;
  maxFetchDepth: number;
  avgFetchedChars: number;
  maxFetchedChars: number;
  helperInputTokensTotal: number;
  helperOutputTokensTotal: number;
  helperTotalTokensTotal: number;
  emptyRate: number;
  errorRate: number;
  hybridRate: number;
  helperAppliedRate: number;
};

export type KnowledgeRetrievalMetricSourceSummary = KnowledgeRetrievalMetricSummary & {
  source: KnowledgeRetrievalTrackedSource;
};

export type KnowledgeRetrievalRecentSearch = {
  at: string;
  eventKind: KnowledgeRetrievalEventKind;
  source: KnowledgeRetrievalTrackedSource;
  retrievalMode: KnowledgeRetrievalMode;
  outcome: KnowledgeRetrievalOutcome;
  durationMs: number;
  resultCount: number;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  helperApplied: boolean;
  fetchDepth: number;
  fetchedChars: number;
  embeddingModelKey: string | null;
  helperModelKey: string | null;
  helperProviderKey: string | null;
  helperTotalTokens: number | null;
  errorCode: string | null;
};

export type KnowledgeRetrievalObservabilityState = {
  updatedAt: string | null;
  totals: KnowledgeRetrievalMetricSummary;
  bySource: KnowledgeRetrievalMetricSourceSummary[];
  recent: KnowledgeRetrievalRecentSearch[];
};

type SummaryInput = {
  searchesTotal: number;
  fetchesTotal: number;
  successTotal: number;
  emptyTotal: number;
  errorTotal: number;
  lexicalTotal: number;
  hybridTotal: number;
  helperAppliedTotal: number;
  embeddingQueryTotal: number;
  durationMsTotal: number;
  maxDurationMs: number;
  resultCountTotal: number;
  lexicalCandidatesTotal: number;
  vectorCandidatesTotal: number;
  fetchDepthTotal: number;
  maxFetchDepth: number;
  fetchedCharsTotal: number;
  maxFetchedChars: number;
  helperInputTokensTotal: number;
  helperOutputTokensTotal: number;
  helperTotalTokensTotal: number;
};

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function toRoundedAverage(total: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.round((total / count) * 100) / 100;
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function toMetricSummary(summary: SummaryInput): KnowledgeRetrievalMetricSummary {
  return {
    searchesTotal: summary.searchesTotal,
    fetchesTotal: summary.fetchesTotal,
    successTotal: summary.successTotal,
    emptyTotal: summary.emptyTotal,
    errorTotal: summary.errorTotal,
    lexicalTotal: summary.lexicalTotal,
    hybridTotal: summary.hybridTotal,
    helperAppliedTotal: summary.helperAppliedTotal,
    embeddingQueryTotal: summary.embeddingQueryTotal,
    avgDurationMs: toRoundedAverage(summary.durationMsTotal, summary.searchesTotal),
    maxDurationMs: summary.maxDurationMs,
    avgResultCount: toRoundedAverage(summary.resultCountTotal, summary.searchesTotal),
    avgLexicalCandidates: toRoundedAverage(summary.lexicalCandidatesTotal, summary.searchesTotal),
    avgVectorCandidates: toRoundedAverage(summary.vectorCandidatesTotal, summary.searchesTotal),
    avgFetchDepth: toRoundedAverage(summary.fetchDepthTotal, summary.fetchesTotal),
    maxFetchDepth: summary.maxFetchDepth,
    avgFetchedChars: toRoundedAverage(summary.fetchedCharsTotal, summary.fetchesTotal),
    maxFetchedChars: summary.maxFetchedChars,
    helperInputTokensTotal: summary.helperInputTokensTotal,
    helperOutputTokensTotal: summary.helperOutputTokensTotal,
    helperTotalTokensTotal: summary.helperTotalTokensTotal,
    emptyRate: toRate(summary.emptyTotal, summary.searchesTotal),
    errorRate: toRate(summary.errorTotal, summary.searchesTotal),
    hybridRate: toRate(summary.hybridTotal, summary.searchesTotal),
    helperAppliedRate: toRate(summary.helperAppliedTotal, summary.searchesTotal)
  };
}

function buildEmptySummary(): SummaryInput {
  return {
    searchesTotal: 0,
    fetchesTotal: 0,
    successTotal: 0,
    emptyTotal: 0,
    errorTotal: 0,
    lexicalTotal: 0,
    hybridTotal: 0,
    helperAppliedTotal: 0,
    embeddingQueryTotal: 0,
    durationMsTotal: 0,
    maxDurationMs: 0,
    resultCountTotal: 0,
    lexicalCandidatesTotal: 0,
    vectorCandidatesTotal: 0,
    fetchDepthTotal: 0,
    maxFetchDepth: 0,
    fetchedCharsTotal: 0,
    maxFetchedChars: 0,
    helperInputTokensTotal: 0,
    helperOutputTokensTotal: 0,
    helperTotalTokensTotal: 0
  };
}

function mergeRollup(
  target: SummaryInput,
  rollup: Pick<
    PrismaKnowledgeRetrievalRollup,
    | "searchesTotal"
    | "fetchesTotal"
    | "successTotal"
    | "emptyTotal"
    | "errorTotal"
    | "lexicalTotal"
    | "hybridTotal"
    | "helperAppliedTotal"
    | "embeddingQueryTotal"
    | "durationMsTotal"
    | "maxDurationMs"
    | "resultCountTotal"
    | "lexicalCandidatesTotal"
    | "vectorCandidatesTotal"
    | "fetchDepthTotal"
    | "maxFetchDepth"
    | "fetchedCharsTotal"
    | "maxFetchedChars"
    | "helperInputTokensTotal"
    | "helperOutputTokensTotal"
    | "helperTotalTokensTotal"
  >
): SummaryInput {
  target.searchesTotal += rollup.searchesTotal;
  target.fetchesTotal += rollup.fetchesTotal;
  target.successTotal += rollup.successTotal;
  target.emptyTotal += rollup.emptyTotal;
  target.errorTotal += rollup.errorTotal;
  target.lexicalTotal += rollup.lexicalTotal;
  target.hybridTotal += rollup.hybridTotal;
  target.helperAppliedTotal += rollup.helperAppliedTotal;
  target.embeddingQueryTotal += rollup.embeddingQueryTotal;
  target.durationMsTotal += toNumber(rollup.durationMsTotal);
  target.maxDurationMs = Math.max(target.maxDurationMs, rollup.maxDurationMs);
  target.resultCountTotal += rollup.resultCountTotal;
  target.lexicalCandidatesTotal += rollup.lexicalCandidatesTotal;
  target.vectorCandidatesTotal += rollup.vectorCandidatesTotal;
  target.fetchDepthTotal += rollup.fetchDepthTotal;
  target.maxFetchDepth = Math.max(target.maxFetchDepth, rollup.maxFetchDepth);
  target.fetchedCharsTotal += toNumber(rollup.fetchedCharsTotal);
  target.maxFetchedChars = Math.max(target.maxFetchedChars, rollup.maxFetchedChars);
  target.helperInputTokensTotal += rollup.helperInputTokensTotal;
  target.helperOutputTokensTotal += rollup.helperOutputTokensTotal;
  target.helperTotalTokensTotal += rollup.helperTotalTokensTotal;
  return target;
}

@Injectable()
export class KnowledgeRetrievalObservabilityService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async recordSearch(input: {
    workspaceId: string;
    assistantId: string | null;
    source: KnowledgeRetrievalTrackedSource;
    retrievalMode: KnowledgeRetrievalMode;
    durationMs: number;
    resultCount: number;
    lexicalCandidateCount: number;
    vectorCandidateCount: number;
    helperApplied: boolean;
    embeddingModelKey: string | null;
    helperModelKey?: string | null;
    helperProviderKey?: string | null;
    helperInputTokens?: number | null;
    helperOutputTokens?: number | null;
    helperTotalTokens?: number | null;
    outcome?: KnowledgeRetrievalOutcome;
    errorCode?: string | null;
  }): Promise<void> {
    const outcome =
      input.outcome ?? (input.resultCount > 0 ? "success" : ("empty" as KnowledgeRetrievalOutcome));
    await this.recordEvent({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      eventKind: "search",
      source: input.source,
      retrievalMode: input.retrievalMode,
      outcome,
      resultCount: input.resultCount,
      lexicalCandidateCount: input.lexicalCandidateCount,
      vectorCandidateCount: input.vectorCandidateCount,
      helperApplied: input.helperApplied,
      fetchDepth: 0,
      fetchedChars: 0,
      embeddingModelKey: input.embeddingModelKey,
      helperModelKey: input.helperModelKey ?? null,
      helperProviderKey: input.helperProviderKey ?? null,
      helperInputTokens: input.helperInputTokens ?? null,
      helperOutputTokens: input.helperOutputTokens ?? null,
      helperTotalTokens: input.helperTotalTokens ?? null,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs
    });
  }

  async recordFetch(input: {
    workspaceId: string;
    assistantId: string | null;
    source: KnowledgeRetrievalTrackedSource;
    retrievalMode: KnowledgeRetrievalMode;
    durationMs: number;
    fetchDepth: number;
    fetchedChars: number;
    embeddingModelKey: string | null;
    outcome?: KnowledgeRetrievalOutcome;
    errorCode?: string | null;
  }): Promise<void> {
    const outcome =
      input.outcome ??
      (input.fetchedChars > 0 ? "success" : ("empty" as KnowledgeRetrievalOutcome));
    await this.recordEvent({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      eventKind: "fetch",
      source: input.source,
      retrievalMode: input.retrievalMode,
      outcome,
      resultCount: outcome === "success" ? 1 : 0,
      lexicalCandidateCount: 0,
      vectorCandidateCount: 0,
      helperApplied: false,
      fetchDepth: input.fetchDepth,
      fetchedChars: input.fetchedChars,
      embeddingModelKey: input.embeddingModelKey,
      helperModelKey: null,
      helperProviderKey: null,
      helperInputTokens: null,
      helperOutputTokens: null,
      helperTotalTokens: null,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs
    });
  }

  async getSnapshot(workspaceId: string): Promise<KnowledgeRetrievalObservabilityState> {
    const [rollups, recent] = await Promise.all([
      this.prisma.knowledgeRetrievalRollup.findMany({
        where: { workspaceId },
        orderBy: [{ source: "asc" }]
      }),
      this.prisma.knowledgeRetrievalEvent.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_RECENT_EVENTS
      })
    ]);

    const totals = rollups.reduce<SummaryInput>(
      (summary, rollup) => mergeRollup(summary, rollup),
      buildEmptySummary()
    );
    return {
      updatedAt:
        recent[0]?.createdAt.toISOString() ??
        rollups.reduce<string | null>(
          (latest, rollup) =>
            latest === null || rollup.updatedAt.toISOString() > latest
              ? rollup.updatedAt.toISOString()
              : latest,
          null
        ),
      totals: toMetricSummary(totals),
      bySource: rollups.map((rollup) => ({
        source: rollup.source,
        ...toMetricSummary(mergeRollup(buildEmptySummary(), rollup))
      })),
      recent: recent.map((row) => this.toRecentState(row))
    };
  }

  private async recordEvent(input: {
    workspaceId: string;
    assistantId: string | null;
    eventKind: KnowledgeRetrievalEventKind;
    source: KnowledgeRetrievalTrackedSource;
    retrievalMode: KnowledgeRetrievalMode;
    outcome: KnowledgeRetrievalOutcome;
    resultCount: number;
    lexicalCandidateCount: number;
    vectorCandidateCount: number;
    helperApplied: boolean;
    fetchDepth: number;
    fetchedChars: number;
    embeddingModelKey: string | null;
    helperModelKey: string | null;
    helperProviderKey: string | null;
    helperInputTokens: number | null;
    helperOutputTokens: number | null;
    helperTotalTokens: number | null;
    errorCode: string | null;
    durationMs: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeRetrievalEvent.create({
        data: {
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          eventKind: input.eventKind,
          source: input.source,
          retrievalMode: input.retrievalMode,
          outcome: input.outcome,
          resultCount: Math.max(0, input.resultCount),
          lexicalCandidateCount: Math.max(0, input.lexicalCandidateCount),
          vectorCandidateCount: Math.max(0, input.vectorCandidateCount),
          helperApplied: input.helperApplied,
          fetchDepth: Math.max(0, input.fetchDepth),
          fetchedChars: Math.max(0, input.fetchedChars),
          embeddingModelKey: input.embeddingModelKey,
          helperModelKey: input.helperModelKey,
          helperProviderKey: input.helperProviderKey,
          helperInputTokens: input.helperInputTokens,
          helperOutputTokens: input.helperOutputTokens,
          helperTotalTokens: input.helperTotalTokens,
          errorCode: input.errorCode,
          durationMs: Math.max(0, input.durationMs)
        }
      });

      const existing = await tx.knowledgeRetrievalRollup.findUnique({
        where: {
          workspaceId_source: {
            workspaceId: input.workspaceId,
            source: input.source
          }
        }
      });
      if (existing === null) {
        await tx.knowledgeRetrievalRollup.create({
          data: {
            workspaceId: input.workspaceId,
            source: input.source,
            searchesTotal: input.eventKind === "search" ? 1 : 0,
            fetchesTotal: input.eventKind === "fetch" ? 1 : 0,
            successTotal: input.outcome === "success" ? 1 : 0,
            emptyTotal: input.outcome === "empty" ? 1 : 0,
            errorTotal: input.outcome === "error" ? 1 : 0,
            lexicalTotal: input.eventKind === "search" && input.retrievalMode === "lexical" ? 1 : 0,
            hybridTotal: input.eventKind === "search" && input.retrievalMode === "hybrid" ? 1 : 0,
            helperAppliedTotal: input.helperApplied ? 1 : 0,
            embeddingQueryTotal: input.embeddingModelKey !== null ? 1 : 0,
            durationMsTotal: BigInt(Math.max(0, input.durationMs)),
            maxDurationMs: Math.max(0, input.durationMs),
            resultCountTotal: Math.max(0, input.resultCount),
            lexicalCandidatesTotal: Math.max(0, input.lexicalCandidateCount),
            vectorCandidatesTotal: Math.max(0, input.vectorCandidateCount),
            fetchDepthTotal: Math.max(0, input.fetchDepth),
            maxFetchDepth: Math.max(0, input.fetchDepth),
            fetchedCharsTotal: BigInt(Math.max(0, input.fetchedChars)),
            maxFetchedChars: Math.max(0, input.fetchedChars),
            helperInputTokensTotal: Math.max(0, input.helperInputTokens ?? 0),
            helperOutputTokensTotal: Math.max(0, input.helperOutputTokens ?? 0),
            helperTotalTokensTotal: Math.max(0, input.helperTotalTokens ?? 0)
          }
        });
        return;
      }

      await tx.knowledgeRetrievalRollup.update({
        where: {
          workspaceId_source: {
            workspaceId: input.workspaceId,
            source: input.source
          }
        },
        data: {
          searchesTotal: existing.searchesTotal + (input.eventKind === "search" ? 1 : 0),
          fetchesTotal: existing.fetchesTotal + (input.eventKind === "fetch" ? 1 : 0),
          successTotal: existing.successTotal + (input.outcome === "success" ? 1 : 0),
          emptyTotal: existing.emptyTotal + (input.outcome === "empty" ? 1 : 0),
          errorTotal: existing.errorTotal + (input.outcome === "error" ? 1 : 0),
          lexicalTotal:
            existing.lexicalTotal +
            (input.eventKind === "search" && input.retrievalMode === "lexical" ? 1 : 0),
          hybridTotal:
            existing.hybridTotal +
            (input.eventKind === "search" && input.retrievalMode === "hybrid" ? 1 : 0),
          helperAppliedTotal: existing.helperAppliedTotal + (input.helperApplied ? 1 : 0),
          embeddingQueryTotal:
            existing.embeddingQueryTotal + (input.embeddingModelKey !== null ? 1 : 0),
          durationMsTotal: existing.durationMsTotal + BigInt(Math.max(0, input.durationMs)),
          maxDurationMs: Math.max(existing.maxDurationMs, Math.max(0, input.durationMs)),
          resultCountTotal: existing.resultCountTotal + Math.max(0, input.resultCount),
          lexicalCandidatesTotal:
            existing.lexicalCandidatesTotal + Math.max(0, input.lexicalCandidateCount),
          vectorCandidatesTotal:
            existing.vectorCandidatesTotal + Math.max(0, input.vectorCandidateCount),
          fetchDepthTotal: existing.fetchDepthTotal + Math.max(0, input.fetchDepth),
          maxFetchDepth: Math.max(existing.maxFetchDepth, Math.max(0, input.fetchDepth)),
          fetchedCharsTotal: existing.fetchedCharsTotal + BigInt(Math.max(0, input.fetchedChars)),
          maxFetchedChars: Math.max(existing.maxFetchedChars, Math.max(0, input.fetchedChars)),
          helperInputTokensTotal:
            existing.helperInputTokensTotal + Math.max(0, input.helperInputTokens ?? 0),
          helperOutputTokensTotal:
            existing.helperOutputTokensTotal + Math.max(0, input.helperOutputTokens ?? 0),
          helperTotalTokensTotal:
            existing.helperTotalTokensTotal + Math.max(0, input.helperTotalTokens ?? 0)
        }
      });
    });
  }

  private toRecentState(row: PrismaKnowledgeRetrievalEvent): KnowledgeRetrievalRecentSearch {
    return {
      at: row.createdAt.toISOString(),
      eventKind: row.eventKind,
      source: row.source,
      retrievalMode: row.retrievalMode,
      outcome: row.outcome,
      durationMs: row.durationMs,
      resultCount: row.resultCount,
      lexicalCandidateCount: row.lexicalCandidateCount,
      vectorCandidateCount: row.vectorCandidateCount,
      helperApplied: row.helperApplied,
      fetchDepth: row.fetchDepth,
      fetchedChars: row.fetchedChars,
      embeddingModelKey: row.embeddingModelKey,
      helperModelKey: row.helperModelKey,
      helperProviderKey: row.helperProviderKey,
      helperTotalTokens: row.helperTotalTokens,
      errorCode: row.errorCode
    };
  }
}
