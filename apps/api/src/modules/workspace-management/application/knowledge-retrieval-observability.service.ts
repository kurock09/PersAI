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
  reuseCachedRefsTotal: number;
  refreshSearchOnlyTotal: number;
  refreshWithHelperTotal: number;
  cacheReuseTotal: number;
  helperAppliedTotal: number;
  helperChangedOrderTotal: number;
  embeddingQueryTotal: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgResultCount: number;
  avgCandidateCount: number;
  avgLexicalCandidates: number;
  avgVectorCandidates: number;
  avgTopScoreMargin: number;
  avgQuerySimilarity: number;
  avgCachedReferenceCoverage: number;
  avgCandidateAmbiguity: number;
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
  helperChangedOrderRate: number;
  cacheReuseRate: number;
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
  decisionMode: string;
  policyState: string | null;
  cacheReuseHit: boolean;
  helperApplied: boolean;
  helperChangedOrder: boolean;
  candidateCount: number;
  topScoreMargin: number | null;
  querySimilarity: number | null;
  cachedReferenceCoverage: number | null;
  candidateAmbiguity: number | null;
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
  reuseCachedRefsTotal: number;
  refreshSearchOnlyTotal: number;
  refreshWithHelperTotal: number;
  cacheReuseTotal: number;
  helperAppliedTotal: number;
  helperChangedOrderTotal: number;
  embeddingQueryTotal: number;
  durationMsTotal: number;
  maxDurationMs: number;
  resultCountTotal: number;
  candidateCountTotal: number;
  lexicalCandidatesTotal: number;
  vectorCandidatesTotal: number;
  topScoreMarginTotal: number;
  querySimilarityTotal: number;
  cachedReferenceCoverageTotal: number;
  candidateAmbiguityTotal: number;
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

function encodeDecisionMode(decisionMode: string, policyState?: string | null): string {
  const normalizedDecisionMode = decisionMode.trim();
  const normalizedPolicyState = policyState?.trim() ?? "";
  if (normalizedDecisionMode.length === 0 || normalizedPolicyState.length === 0) {
    return normalizedDecisionMode;
  }
  const combined = `${normalizedDecisionMode}@${normalizedPolicyState}`;
  return combined.length <= 32 ? combined : normalizedDecisionMode;
}

function decodeDecisionMode(value: string): { decisionMode: string; policyState: string | null } {
  const [decisionMode = "", policyState] = value.split("@", 2);
  return {
    decisionMode,
    policyState: policyState && policyState.length > 0 ? policyState : null
  };
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
    reuseCachedRefsTotal: summary.reuseCachedRefsTotal,
    refreshSearchOnlyTotal: summary.refreshSearchOnlyTotal,
    refreshWithHelperTotal: summary.refreshWithHelperTotal,
    cacheReuseTotal: summary.cacheReuseTotal,
    helperAppliedTotal: summary.helperAppliedTotal,
    helperChangedOrderTotal: summary.helperChangedOrderTotal,
    embeddingQueryTotal: summary.embeddingQueryTotal,
    avgDurationMs: toRoundedAverage(summary.durationMsTotal, summary.searchesTotal),
    maxDurationMs: summary.maxDurationMs,
    avgResultCount: toRoundedAverage(summary.resultCountTotal, summary.searchesTotal),
    avgCandidateCount: toRoundedAverage(summary.candidateCountTotal, summary.searchesTotal),
    avgLexicalCandidates: toRoundedAverage(summary.lexicalCandidatesTotal, summary.searchesTotal),
    avgVectorCandidates: toRoundedAverage(summary.vectorCandidatesTotal, summary.searchesTotal),
    avgTopScoreMargin: toRoundedAverage(summary.topScoreMarginTotal, summary.searchesTotal),
    avgQuerySimilarity: toRoundedAverage(summary.querySimilarityTotal, summary.searchesTotal),
    avgCachedReferenceCoverage: toRoundedAverage(
      summary.cachedReferenceCoverageTotal,
      summary.searchesTotal
    ),
    avgCandidateAmbiguity: toRoundedAverage(summary.candidateAmbiguityTotal, summary.searchesTotal),
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
    helperAppliedRate: toRate(summary.helperAppliedTotal, summary.searchesTotal),
    helperChangedOrderRate: toRate(summary.helperChangedOrderTotal, summary.searchesTotal),
    cacheReuseRate: toRate(summary.cacheReuseTotal, summary.searchesTotal)
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
    reuseCachedRefsTotal: 0,
    refreshSearchOnlyTotal: 0,
    refreshWithHelperTotal: 0,
    cacheReuseTotal: 0,
    helperAppliedTotal: 0,
    helperChangedOrderTotal: 0,
    embeddingQueryTotal: 0,
    durationMsTotal: 0,
    maxDurationMs: 0,
    resultCountTotal: 0,
    candidateCountTotal: 0,
    lexicalCandidatesTotal: 0,
    vectorCandidatesTotal: 0,
    topScoreMarginTotal: 0,
    querySimilarityTotal: 0,
    cachedReferenceCoverageTotal: 0,
    candidateAmbiguityTotal: 0,
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
    | "reuseCachedRefsTotal"
    | "refreshSearchOnlyTotal"
    | "refreshWithHelperTotal"
    | "cacheReuseTotal"
    | "helperAppliedTotal"
    | "helperChangedOrderTotal"
    | "embeddingQueryTotal"
    | "durationMsTotal"
    | "maxDurationMs"
    | "resultCountTotal"
    | "candidateCountTotal"
    | "lexicalCandidatesTotal"
    | "vectorCandidatesTotal"
    | "topScoreMarginTotal"
    | "querySimilarityTotal"
    | "cachedReferenceCoverageTotal"
    | "candidateAmbiguityTotal"
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
  target.reuseCachedRefsTotal += rollup.reuseCachedRefsTotal;
  target.refreshSearchOnlyTotal += rollup.refreshSearchOnlyTotal;
  target.refreshWithHelperTotal += rollup.refreshWithHelperTotal;
  target.cacheReuseTotal += rollup.cacheReuseTotal;
  target.helperAppliedTotal += rollup.helperAppliedTotal;
  target.helperChangedOrderTotal += rollup.helperChangedOrderTotal;
  target.embeddingQueryTotal += rollup.embeddingQueryTotal;
  target.durationMsTotal += toNumber(rollup.durationMsTotal);
  target.maxDurationMs = Math.max(target.maxDurationMs, rollup.maxDurationMs);
  target.resultCountTotal += rollup.resultCountTotal;
  target.candidateCountTotal += rollup.candidateCountTotal;
  target.lexicalCandidatesTotal += rollup.lexicalCandidatesTotal;
  target.vectorCandidatesTotal += rollup.vectorCandidatesTotal;
  target.topScoreMarginTotal += rollup.topScoreMarginTotal;
  target.querySimilarityTotal += rollup.querySimilarityTotal;
  target.cachedReferenceCoverageTotal += rollup.cachedReferenceCoverageTotal;
  target.candidateAmbiguityTotal += rollup.candidateAmbiguityTotal;
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
    decisionMode?: string;
    cacheReuseHit?: boolean;
    helperApplied: boolean;
    helperChangedOrder?: boolean;
    candidateCount?: number;
    topScoreMargin?: number | null;
    querySimilarityToLastTurn?: number | null;
    cachedReferenceCoverage?: number | null;
    candidateAmbiguity?: number | null;
    embeddingModelKey: string | null;
    helperModelKey?: string | null;
    helperProviderKey?: string | null;
    helperInputTokens?: number | null;
    helperOutputTokens?: number | null;
    helperTotalTokens?: number | null;
    policyState?: string | null;
    outcome?: KnowledgeRetrievalOutcome;
    errorCode?: string | null;
  }): Promise<void> {
    const outcome =
      input.outcome ?? (input.resultCount > 0 ? "success" : ("empty" as KnowledgeRetrievalOutcome));
    const decisionModeBase =
      input.source === "skill" ? (input.decisionMode ?? "refresh_search_only") : "not_applicable";
    const decisionMode = encodeDecisionMode(decisionModeBase, input.policyState);
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
      decisionMode,
      cacheReuseHit: input.cacheReuseHit ?? false,
      helperApplied: input.helperApplied,
      helperChangedOrder: input.helperChangedOrder ?? false,
      candidateCount: input.candidateCount ?? input.resultCount,
      topScoreMargin: input.topScoreMargin ?? null,
      querySimilarity: input.querySimilarityToLastTurn ?? null,
      cachedReferenceCoverage: input.cachedReferenceCoverage ?? null,
      candidateAmbiguity: input.candidateAmbiguity ?? null,
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
      decisionMode: "not_applicable",
      cacheReuseHit: false,
      helperApplied: false,
      helperChangedOrder: false,
      candidateCount: 0,
      topScoreMargin: null,
      querySimilarity: null,
      cachedReferenceCoverage: null,
      candidateAmbiguity: null,
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
    decisionMode: string;
    cacheReuseHit: boolean;
    helperApplied: boolean;
    helperChangedOrder: boolean;
    candidateCount: number;
    topScoreMargin: number | null;
    querySimilarity: number | null;
    cachedReferenceCoverage: number | null;
    candidateAmbiguity: number | null;
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
    const countsTowardSkillDecisionMode = input.eventKind === "search" && input.source === "skill";
    const { decisionMode: baseDecisionMode } = decodeDecisionMode(input.decisionMode);
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
          decisionMode: input.decisionMode,
          cacheReuseHit: input.cacheReuseHit,
          helperApplied: input.helperApplied,
          helperChangedOrder: input.helperChangedOrder,
          candidateCount: Math.max(0, input.candidateCount),
          topScoreMargin: input.topScoreMargin,
          querySimilarity: input.querySimilarity,
          cachedReferenceCoverage: input.cachedReferenceCoverage,
          candidateAmbiguity: input.candidateAmbiguity,
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
            reuseCachedRefsTotal:
              countsTowardSkillDecisionMode && baseDecisionMode === "reuse_cached_refs" ? 1 : 0,
            refreshSearchOnlyTotal:
              countsTowardSkillDecisionMode && baseDecisionMode === "refresh_search_only" ? 1 : 0,
            refreshWithHelperTotal:
              countsTowardSkillDecisionMode && baseDecisionMode === "refresh_with_helper" ? 1 : 0,
            cacheReuseTotal: input.cacheReuseHit ? 1 : 0,
            helperAppliedTotal: input.helperApplied ? 1 : 0,
            helperChangedOrderTotal: input.helperChangedOrder ? 1 : 0,
            embeddingQueryTotal: input.embeddingModelKey !== null ? 1 : 0,
            durationMsTotal: BigInt(Math.max(0, input.durationMs)),
            maxDurationMs: Math.max(0, input.durationMs),
            resultCountTotal: Math.max(0, input.resultCount),
            candidateCountTotal: Math.max(0, input.candidateCount),
            lexicalCandidatesTotal: Math.max(0, input.lexicalCandidateCount),
            vectorCandidatesTotal: Math.max(0, input.vectorCandidateCount),
            topScoreMarginTotal: Math.max(0, input.topScoreMargin ?? 0),
            querySimilarityTotal: Math.max(0, input.querySimilarity ?? 0),
            cachedReferenceCoverageTotal: Math.max(0, input.cachedReferenceCoverage ?? 0),
            candidateAmbiguityTotal: Math.max(0, input.candidateAmbiguity ?? 0),
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
          reuseCachedRefsTotal:
            existing.reuseCachedRefsTotal +
            (countsTowardSkillDecisionMode && baseDecisionMode === "reuse_cached_refs" ? 1 : 0),
          refreshSearchOnlyTotal:
            existing.refreshSearchOnlyTotal +
            (countsTowardSkillDecisionMode && baseDecisionMode === "refresh_search_only" ? 1 : 0),
          refreshWithHelperTotal:
            existing.refreshWithHelperTotal +
            (countsTowardSkillDecisionMode && baseDecisionMode === "refresh_with_helper" ? 1 : 0),
          cacheReuseTotal: existing.cacheReuseTotal + (input.cacheReuseHit ? 1 : 0),
          helperAppliedTotal: existing.helperAppliedTotal + (input.helperApplied ? 1 : 0),
          helperChangedOrderTotal:
            existing.helperChangedOrderTotal + (input.helperChangedOrder ? 1 : 0),
          embeddingQueryTotal:
            existing.embeddingQueryTotal + (input.embeddingModelKey !== null ? 1 : 0),
          durationMsTotal: existing.durationMsTotal + BigInt(Math.max(0, input.durationMs)),
          maxDurationMs: Math.max(existing.maxDurationMs, Math.max(0, input.durationMs)),
          resultCountTotal: existing.resultCountTotal + Math.max(0, input.resultCount),
          candidateCountTotal: existing.candidateCountTotal + Math.max(0, input.candidateCount),
          lexicalCandidatesTotal:
            existing.lexicalCandidatesTotal + Math.max(0, input.lexicalCandidateCount),
          vectorCandidatesTotal:
            existing.vectorCandidatesTotal + Math.max(0, input.vectorCandidateCount),
          topScoreMarginTotal:
            existing.topScoreMarginTotal + Math.max(0, input.topScoreMargin ?? 0),
          querySimilarityTotal:
            existing.querySimilarityTotal + Math.max(0, input.querySimilarity ?? 0),
          cachedReferenceCoverageTotal:
            existing.cachedReferenceCoverageTotal + Math.max(0, input.cachedReferenceCoverage ?? 0),
          candidateAmbiguityTotal:
            existing.candidateAmbiguityTotal + Math.max(0, input.candidateAmbiguity ?? 0),
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
    const decodedDecisionMode = decodeDecisionMode(row.decisionMode);
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
      decisionMode: decodedDecisionMode.decisionMode,
      policyState: decodedDecisionMode.policyState,
      cacheReuseHit: row.cacheReuseHit,
      helperApplied: row.helperApplied,
      helperChangedOrder: row.helperChangedOrder,
      candidateCount: row.candidateCount,
      topScoreMargin: row.topScoreMargin,
      querySimilarity: row.querySimilarity,
      cachedReferenceCoverage: row.cachedReferenceCoverage,
      candidateAmbiguity: row.candidateAmbiguity,
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
