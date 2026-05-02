import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  RuntimeRetrievedKnowledgeContext,
  RuntimeRetrievedKnowledgeContextItem,
  RuntimeRetrievedKnowledgeSourceLabel,
  RuntimeRetrievalPlan
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";
import { KnowledgeRetrievalObservabilityService } from "./knowledge-retrieval-observability.service";
import { KnowledgeRetrievalHelperService } from "./knowledge-retrieval-helper.service";
import {
  KNOWLEDGE_VECTOR_INDEX,
  type KnowledgeVectorIndex,
  type KnowledgeVectorSearchHit
} from "./knowledge-vector-index";
import { ReadAssistantKnowledgeService } from "./read-assistant-knowledge.service";

const MAX_CONTEXT_ITEMS = 6;
const MAX_ITEM_CHARS = 1_200;
const MAX_SKILL_FETCHED_ITEM_CHARS = 2_400;
const MAX_RENDERED_BLOCK_CHARS = 6_000;
const MAX_PER_SOURCE_RESULTS = 3;
const MIN_SKILL_VECTOR_SCORE = 0.18;

type RuntimeRetrievalInput = {
  assistantId: string;
  query: string;
  locale: string | null;
  retrievalPlan: RuntimeRetrievalPlan;
};

type OrchestratedRetrievalTelemetrySource = "skill" | "document" | "product" | "web";

type SkillChunkRow = {
  id: string;
  sourceKind: "skill_document" | "skill_knowledge_card";
  sourceId: string;
  skillId: string;
  workspaceId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey?: string | null;
  sourceTitle: string;
  mimeType: string;
  skill: {
    id: string;
    name: unknown;
    category: string;
  };
};

type RankedSkillCandidate = {
  row: SkillChunkRow;
  score: number;
  lexicalScore: number;
  vectorScore: number | null;
  referenceId: string;
};

type SkillReferenceSearchResult = {
  items: RuntimeRetrievedKnowledgeContextItem[];
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  helperApplied: boolean;
  embeddingModelKey: string | null;
  helperModelKey: string | null;
  helperProviderKey: string | null;
  helperInputTokens: number | null;
  helperOutputTokens: number | null;
  helperTotalTokens: number | null;
  retrievalMode: "lexical" | "hybrid";
  fetchDepth: number;
  fetchedChars: number;
};

type SkillFetchedContent = {
  content: string;
  fetchDepth: number;
  fetchedChars: number;
  windowStartChunkIndex: number;
  windowEndChunkIndex: number;
  embeddingModelKey: string | null;
};

@Injectable()
export class OrchestrateRuntimeRetrievalService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly readAssistantKnowledgeService: ReadAssistantKnowledgeService,
    private readonly knowledgeRetrievalObservabilityService: KnowledgeRetrievalObservabilityService,
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService,
    private readonly knowledgeRetrievalHelperService: KnowledgeRetrievalHelperService,
    @Inject(KNOWLEDGE_VECTOR_INDEX)
    private readonly knowledgeVectorIndex: KnowledgeVectorIndex
  ) {}

  parseInput(body: unknown): RuntimeRetrievalInput {
    const row = this.asObject(body);
    const assistantId = this.asNonEmptyString(row?.assistantId);
    const query = this.asNonEmptyString(row?.query);
    const locale =
      row?.locale === null || row?.locale === undefined ? null : this.asNonEmptyString(row.locale);
    const retrievalPlan = this.parseRetrievalPlan(row?.retrievalPlan);
    if (assistantId === null || query === null || retrievalPlan === null) {
      throw new BadRequestException("assistantId, query, and retrievalPlan are required.");
    }
    return { assistantId, query, locale, retrievalPlan };
  }

  async execute(input: RuntimeRetrievalInput): Promise<RuntimeRetrievedKnowledgeContext> {
    const workspaceId = await this.resolveAssistantWorkspaceId(input.assistantId);
    const items: RuntimeRetrievedKnowledgeContextItem[] = [];
    if (input.retrievalPlan.useSkills) {
      items.push(...(await this.searchSkillReferences(input, workspaceId)));
    }
    if (input.retrievalPlan.useUserKnowledge) {
      items.push(
        ...(await this.withTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          source: "document",
          execute: async () => [
            ...(await this.searchKnowledgeSource(input, "document", "user_document")),
            ...(await this.searchKnowledgeSource(input, "memory", "user_document")),
            ...(await this.searchKnowledgeSource(input, "chat", "user_document"))
          ]
        }))
      );
    }
    if (input.retrievalPlan.useProductKnowledge) {
      items.push(
        ...(await this.withTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          source: "product",
          execute: async () => [
            ...(await this.searchKnowledgeSource(input, "global", "product_reference")),
            ...(await this.searchKnowledgeSource(input, "preset", "product_reference")),
            ...(await this.searchKnowledgeSource(input, "subscription", "product_reference"))
          ]
        }))
      );
    }
    if (input.retrievalPlan.useWeb) {
      await this.recordTelemetry({
        workspaceId,
        assistantId: input.assistantId,
        source: "web",
        durationMs: 0,
        resultCount: 0,
        outcome: "empty",
        errorCode: "web_reference_not_executed"
      });
    }

    const selected = this.selectContextItems(items);
    const renderedBlock = this.renderContextBlock(selected);
    return {
      items: selected,
      renderedBlock
    };
  }

  private async searchKnowledgeSource(
    input: RuntimeRetrievalInput,
    source: "document" | "memory" | "chat" | "global" | "preset" | "subscription",
    label: RuntimeRetrievedKnowledgeSourceLabel
  ): Promise<RuntimeRetrievedKnowledgeContextItem[]> {
    const hits = await this.readAssistantKnowledgeService.search({
      assistantId: input.assistantId,
      source,
      query: input.query,
      maxResults: MAX_PER_SOURCE_RESULTS
    });
    const items: RuntimeRetrievedKnowledgeContextItem[] = [];
    for (const hit of hits.slice(0, MAX_PER_SOURCE_RESULTS)) {
      const fetched = await this.readAssistantKnowledgeService.fetch({
        assistantId: input.assistantId,
        source,
        referenceId: hit.referenceId
      });
      const content = this.asNonEmptyString(fetched?.content) ?? this.asNonEmptyString(hit.snippet);
      if (content === null) {
        continue;
      }
      items.push({
        label,
        referenceId: hit.referenceId,
        title: fetched?.title ?? hit.title,
        locator: fetched?.locator ?? hit.locator,
        content: this.truncate(content, MAX_ITEM_CHARS),
        score: hit.score,
        metadata: {
          ...(hit.metadata ?? {}),
          source
        }
      });
    }
    return items;
  }

  private async searchSkillReferences(
    input: RuntimeRetrievalInput,
    workspaceId: string | null
  ): Promise<RuntimeRetrievedKnowledgeContextItem[]> {
    const startedAt = Date.now();
    try {
      const result = await this.executeSkillReferenceSearch(input, workspaceId);
      await this.recordTelemetry({
        workspaceId,
        assistantId: input.assistantId,
        source: "skill",
        durationMs: Date.now() - startedAt,
        resultCount: result.items.length,
        outcome: result.items.length > 0 ? "success" : "empty",
        errorCode: null,
        retrievalMode: result.retrievalMode,
        lexicalCandidateCount: result.lexicalCandidateCount,
        vectorCandidateCount: result.vectorCandidateCount,
        helperApplied: result.helperApplied,
        embeddingModelKey: result.embeddingModelKey,
        helperModelKey: result.helperModelKey,
        helperProviderKey: result.helperProviderKey,
        helperInputTokens: result.helperInputTokens,
        helperOutputTokens: result.helperOutputTokens,
        helperTotalTokens: result.helperTotalTokens
      });
      if (result.fetchedChars > 0) {
        await this.recordFetchTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          source: "skill",
          retrievalMode: result.retrievalMode,
          durationMs: Date.now() - startedAt,
          fetchDepth: result.fetchDepth,
          fetchedChars: result.fetchedChars,
          embeddingModelKey: result.embeddingModelKey
        });
      }
      return result.items;
    } catch (error) {
      await this.recordTelemetry({
        workspaceId,
        assistantId: input.assistantId,
        source: "skill",
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        outcome: "error",
        errorCode: this.resolveTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  private async executeSkillReferenceSearch(
    input: RuntimeRetrievalInput,
    workspaceId: string | null
  ): Promise<SkillReferenceSearchResult> {
    const enabledSkillIds = await this.resolveEnabledSkillIds(input);
    if (enabledSkillIds.length === 0) {
      return this.emptySkillReferenceSearchResult();
    }
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    const embeddingModelKey =
      await this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey();
    const retrievalModelKey =
      await this.knowledgeModelPolicyService.resolveAdminKnowledgeRetrievalModelKey();
    const terms = this.buildSearchTerms(input.query);
    const rankedByReferenceId = new Map<string, RankedSkillCandidate>();
    const documentRows = await this.prisma.skillDocumentChunk.findMany({
      where: {
        skillId: { in: enabledSkillIds },
        skillDocument: {
          status: "ready"
        },
        skill: {
          status: "active",
          archivedAt: null
        },
        OR: terms.flatMap((term) => [
          { content: { contains: term, mode: "insensitive" } },
          { locator: { contains: term, mode: "insensitive" } }
        ])
      },
      include: {
        skillDocument: {
          select: {
            id: true,
            displayName: true,
            originalFilename: true,
            mimeType: true,
            status: true
          }
        },
        skill: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      },
      orderBy: [
        { skillId: "asc" },
        { skillDocumentId: "asc" },
        { sourceVersion: "desc" },
        { chunkIndex: "asc" }
      ],
      take: retrievalPolicy.lexicalCandidateLimit
    });
    const cardRows = await this.prisma.skillKnowledgeCardChunk.findMany({
      where: {
        skillId: { in: enabledSkillIds },
        knowledgeCard: {
          status: "ready",
          lifecycleStatus: "active"
        },
        skill: {
          status: "active",
          archivedAt: null
        },
        OR: terms.flatMap((term) => [
          { content: { contains: term, mode: "insensitive" } },
          { locator: { contains: term, mode: "insensitive" } }
        ])
      },
      include: {
        knowledgeCard: {
          select: {
            id: true,
            title: true,
            locale: true,
            status: true,
            lifecycleStatus: true
          }
        },
        skill: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      },
      orderBy: [
        { skillId: "asc" },
        { skillKnowledgeCardId: "asc" },
        { sourceVersion: "desc" },
        { chunkIndex: "asc" }
      ],
      take: retrievalPolicy.lexicalCandidateLimit
    });
    const rows: SkillChunkRow[] = [
      ...documentRows.map(
        (row): SkillChunkRow => ({
          id: row.id,
          sourceKind: "skill_document",
          sourceId: row.skillDocumentId,
          skillId: row.skillId,
          workspaceId: row.workspaceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          locator: row.locator,
          content: row.content,
          embeddingModelKey: row.embeddingModelKey,
          sourceTitle: row.skillDocument.displayName ?? row.skillDocument.originalFilename,
          mimeType: row.skillDocument.mimeType,
          skill: row.skill
        })
      ),
      ...cardRows.map(
        (row): SkillChunkRow => ({
          id: row.id,
          sourceKind: "skill_knowledge_card",
          sourceId: row.skillKnowledgeCardId,
          skillId: row.skillId,
          workspaceId: row.workspaceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          locator: row.locator,
          content: row.content,
          embeddingModelKey: row.embeddingModelKey,
          sourceTitle: row.knowledgeCard.title,
          mimeType: "text/markdown",
          skill: row.skill
        })
      )
    ];
    for (const row of rows) {
      const score = this.scoreSkillRow(row, input.query);
      if (score <= 0) {
        continue;
      }
      this.upsertSkillCandidate(rankedByReferenceId, {
        row,
        score,
        lexicalScore: score,
        vectorScore: null,
        referenceId: this.buildSkillReferenceId(row)
      });
    }

    let vectorCandidateCount = 0;
    let retrievalMode: "lexical" | "hybrid" = "lexical";
    const queryEmbedding =
      workspaceId === null || !retrievalPolicy.embeddingSearchEnabled || embeddingModelKey === null
        ? null
        : ((
            await this.knowledgeEmbeddingService.generateEmbeddings({
              modelKey: embeddingModelKey,
              texts: [input.query]
            })
          )[0] ?? null);
    if (workspaceId !== null && queryEmbedding !== null && embeddingModelKey !== null) {
      retrievalMode = "hybrid";
      const vectorHits = await this.knowledgeVectorIndex.searchNearest({
        workspaceId,
        embeddingModelKey,
        queryVector: queryEmbedding,
        limit: retrievalPolicy.vectorCandidateLimit,
        sourceTypes: ["skill_document", "skill_knowledge_card"],
        skillIds: enabledSkillIds
      });
      vectorCandidateCount = vectorHits.length;
      await this.mergeSkillVectorHits({
        vectorHits,
        enabledSkillIds,
        query: input.query,
        rankedByReferenceId
      });
    }

    const semanticGroundingRequired =
      retrievalPolicy.embeddingSearchEnabled && embeddingModelKey !== null;

    const helperCandidateLimit = Math.max(
      MAX_PER_SOURCE_RESULTS,
      Math.min(retrievalPolicy.helperCandidateLimit, 8)
    );
    let selected = this.selectSkillCandidates(
      [...rankedByReferenceId.values()]
        .filter((candidate) => !semanticGroundingRequired || candidate.vectorScore !== null)
        .sort((left, right) => right.score - left.score),
      helperCandidateLimit
    );
    const helperRanking = await this.knowledgeRetrievalHelperService.rerankCandidates({
      assistantId: input.assistantId,
      query: input.query,
      retrievalModelKey,
      candidates: selected.map((candidate) => ({
        referenceId: candidate.referenceId,
        title: `${this.localize(candidate.row.skill.name, input.locale)} / ${
          candidate.row.sourceTitle
        }`,
        locator: candidate.row.locator,
        snippet: this.buildSnippet(candidate.row.content, terms)
      }))
    });
    if (helperRanking !== null) {
      const helperRankIndex = new Map(
        helperRanking.rankedReferenceIds.map((referenceId, index) => [referenceId, index])
      );
      selected = [...selected].sort((left, right) => {
        const leftRank = helperRankIndex.get(left.referenceId);
        const rightRank = helperRankIndex.get(right.referenceId);
        if (leftRank !== undefined || rightRank !== undefined) {
          if (leftRank === undefined) {
            return 1;
          }
          if (rightRank === undefined) {
            return -1;
          }
          return leftRank - rightRank;
        }
        return right.score - left.score;
      });
    }

    const fetchedCandidates = await Promise.all(
      selected.slice(0, MAX_PER_SOURCE_RESULTS).map(async (candidate) => ({
        candidate,
        fetched: await this.fetchSkillCandidateWindow(candidate, {
          fetchMaxChars: retrievalPolicy.fetchMaxChars,
          windowRadius: retrievalPolicy.knowledgeFetchWindowRadius
        })
      }))
    );
    const items = fetchedCandidates.map(({ candidate, fetched }) => ({
      label: "skill_reference" as const,
      referenceId: this.buildSkillReferenceId(candidate.row),
      title: `${this.localize(candidate.row.skill.name, input.locale)} / ${
        candidate.row.sourceTitle
      }`,
      locator: candidate.row.locator,
      content: this.truncate(fetched.content, MAX_SKILL_FETCHED_ITEM_CHARS),
      score: candidate.score,
      metadata: {
        skillId: candidate.row.skillId,
        skillCategory: candidate.row.skill.category,
        skillSourceType: candidate.row.sourceKind,
        skillSourceId: candidate.row.sourceId,
        sourceVersion: candidate.row.sourceVersion,
        chunkIndex: candidate.row.chunkIndex,
        windowStartChunkIndex: fetched.windowStartChunkIndex,
        windowEndChunkIndex: fetched.windowEndChunkIndex,
        windowChunkCount: fetched.fetchDepth,
        mimeType: candidate.row.mimeType,
        retrievalMode,
        semanticGroundingRequired,
        vectorScore: candidate.vectorScore,
        embeddingModelKey: fetched.embeddingModelKey
      }
    }));
    return {
      items,
      lexicalCandidateCount: rows.length,
      vectorCandidateCount,
      helperApplied: helperRanking !== null,
      embeddingModelKey,
      helperModelKey: helperRanking?.modelKey ?? null,
      helperProviderKey: helperRanking?.providerKey ?? null,
      helperInputTokens: helperRanking?.usage?.inputTokens ?? null,
      helperOutputTokens: helperRanking?.usage?.outputTokens ?? null,
      helperTotalTokens: helperRanking?.usage?.totalTokens ?? null,
      retrievalMode,
      fetchDepth: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchDepth, 0),
      fetchedChars: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchedChars, 0)
    };
  }

  private async withTelemetry(input: {
    workspaceId: string | null;
    assistantId: string;
    source: OrchestratedRetrievalTelemetrySource;
    execute: () => Promise<RuntimeRetrievedKnowledgeContextItem[]>;
  }): Promise<RuntimeRetrievedKnowledgeContextItem[]> {
    const startedAt = Date.now();
    try {
      const items = await input.execute();
      await this.recordTelemetry({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        source: input.source,
        durationMs: Date.now() - startedAt,
        resultCount: items.length,
        outcome: items.length > 0 ? "success" : "empty",
        errorCode: null
      });
      return items;
    } catch (error) {
      await this.recordTelemetry({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        source: input.source,
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        outcome: "error",
        errorCode: this.resolveTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  private async recordTelemetry(input: {
    workspaceId: string | null;
    assistantId: string;
    source: OrchestratedRetrievalTelemetrySource;
    durationMs: number;
    resultCount: number;
    outcome: "success" | "empty" | "error";
    errorCode: string | null;
    retrievalMode?: "lexical" | "hybrid";
    lexicalCandidateCount?: number;
    vectorCandidateCount?: number;
    helperApplied?: boolean;
    embeddingModelKey?: string | null;
    helperModelKey?: string | null;
    helperProviderKey?: string | null;
    helperInputTokens?: number | null;
    helperOutputTokens?: number | null;
    helperTotalTokens?: number | null;
  }): Promise<void> {
    if (input.workspaceId === null) {
      return;
    }
    await this.knowledgeRetrievalObservabilityService.recordSearch({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      source: input.source,
      retrievalMode: input.retrievalMode ?? "hybrid",
      durationMs: input.durationMs,
      resultCount: input.resultCount,
      lexicalCandidateCount: input.lexicalCandidateCount ?? input.resultCount,
      vectorCandidateCount: input.vectorCandidateCount ?? 0,
      helperApplied: input.helperApplied ?? false,
      embeddingModelKey: input.embeddingModelKey ?? null,
      helperModelKey: input.helperModelKey ?? null,
      helperProviderKey: input.helperProviderKey ?? null,
      helperInputTokens: input.helperInputTokens ?? null,
      helperOutputTokens: input.helperOutputTokens ?? null,
      helperTotalTokens: input.helperTotalTokens ?? null,
      outcome: input.outcome,
      errorCode: input.errorCode
    });
  }

  private async recordFetchTelemetry(input: {
    workspaceId: string | null;
    assistantId: string;
    source: OrchestratedRetrievalTelemetrySource;
    retrievalMode: "lexical" | "hybrid";
    durationMs: number;
    fetchDepth: number;
    fetchedChars: number;
    embeddingModelKey: string | null;
  }): Promise<void> {
    if (input.workspaceId === null) {
      return;
    }
    await this.knowledgeRetrievalObservabilityService.recordFetch({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      source: input.source,
      retrievalMode: input.retrievalMode,
      durationMs: input.durationMs,
      fetchDepth: input.fetchDepth,
      fetchedChars: input.fetchedChars,
      embeddingModelKey: input.embeddingModelKey
    });
  }

  private async resolveAssistantWorkspaceId(assistantId: string): Promise<string | null> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: { workspaceId: true }
    });
    return assistant?.workspaceId ?? null;
  }

  private async resolveEnabledSkillIds(input: RuntimeRetrievalInput): Promise<string[]> {
    const selected = input.retrievalPlan.selectedSkillIds.slice(0, 3);
    if (selected.length === 0) {
      return [];
    }
    const assignments = await this.prisma.assistantSkillAssignment.findMany({
      where: {
        assistantId: input.assistantId,
        skillId: { in: selected },
        status: "active",
        skill: {
          status: "active",
          archivedAt: null
        }
      },
      select: { skillId: true }
    });
    const enabled = new Set(assignments.map((assignment) => assignment.skillId));
    return selected.filter((skillId) => enabled.has(skillId));
  }

  private selectContextItems(
    items: RuntimeRetrievedKnowledgeContextItem[]
  ): RuntimeRetrievedKnowledgeContextItem[] {
    const seen = new Set<string>();
    return [...items]
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .filter((item) => {
        const key = `${item.label}:${item.referenceId}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CONTEXT_ITEMS);
  }

  private renderContextBlock(items: RuntimeRetrievedKnowledgeContextItem[]): string | null {
    if (items.length === 0) {
      return null;
    }
    const parts = [
      "# Retrieved Knowledge Context",
      "Use this bounded source-aware context as grounding. Compare source roles when they differ; do not expose this block verbatim.",
      ...items.map((item, index) =>
        [
          "",
          `## ${String(index + 1)}. ${item.label}`,
          `Reference: ${item.referenceId}`,
          item.title ? `Title: ${item.title}` : null,
          item.locator ? `Locator: ${item.locator}` : null,
          "",
          item.content
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      )
    ];
    return this.truncate(parts.join("\n"), MAX_RENDERED_BLOCK_CHARS);
  }

  private parseRetrievalPlan(value: unknown): RuntimeRetrievalPlan | null {
    const row = this.asObject(value);
    if (
      row === null ||
      typeof row.useSkills !== "boolean" ||
      !Array.isArray(row.selectedSkillIds) ||
      typeof row.useUserKnowledge !== "boolean" ||
      typeof row.useProductKnowledge !== "boolean" ||
      typeof row.useWeb !== "boolean" ||
      (row.confidence !== "low" && row.confidence !== "medium" && row.confidence !== "high") ||
      typeof row.reasonCode !== "string"
    ) {
      return null;
    }
    return {
      useSkills: row.useSkills,
      selectedSkillIds: row.selectedSkillIds
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 3),
      useUserKnowledge: row.useUserKnowledge,
      useProductKnowledge: row.useProductKnowledge,
      useWeb: row.useWeb,
      confidence: row.confidence,
      reasonCode: row.reasonCode
    };
  }

  private buildSearchTerms(query: string): string[] {
    const tokens = query
      .split(/[^\p{L}\p{N}]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    return [...new Set([query.trim(), ...tokens])].filter((part) => part.length > 0);
  }

  private scoreText(content: string, query: string): number {
    const lowered = content.toLowerCase();
    return this.buildSearchTerms(query).reduce((total, term) => {
      return lowered.includes(term.toLowerCase()) ? total + (term.includes(" ") ? 6 : 2) : total;
    }, 0);
  }

  private emptySkillReferenceSearchResult(): SkillReferenceSearchResult {
    return {
      items: [],
      lexicalCandidateCount: 0,
      vectorCandidateCount: 0,
      helperApplied: false,
      embeddingModelKey: null,
      helperModelKey: null,
      helperProviderKey: null,
      helperInputTokens: null,
      helperOutputTokens: null,
      helperTotalTokens: null,
      retrievalMode: "lexical",
      fetchDepth: 0,
      fetchedChars: 0
    };
  }

  private async mergeSkillVectorHits(input: {
    vectorHits: KnowledgeVectorSearchHit[];
    enabledSkillIds: string[];
    query: string;
    rankedByReferenceId: Map<string, RankedSkillCandidate>;
  }): Promise<void> {
    const vectorScoresByReferenceId = new Map<string, number>();
    for (const hit of input.vectorHits) {
      if (hit.score < MIN_SKILL_VECTOR_SCORE) {
        continue;
      }
      const sourceKind =
        hit.sourceType === "skill_knowledge_card" ? "skill_knowledge_card" : "skill_document";
      const referenceId = `skill:${hit.skillId ?? "unknown"}:${sourceKind}:${hit.sourceId}:${String(hit.sourceVersion)}:${String(hit.chunkIndex)}`;
      vectorScoresByReferenceId.set(
        referenceId,
        Math.max(vectorScoresByReferenceId.get(referenceId) ?? 0, hit.score)
      );
    }
    if (vectorScoresByReferenceId.size === 0) {
      return;
    }
    const documentHits = input.vectorHits.filter((hit) => hit.sourceType === "skill_document");
    const cardHits = input.vectorHits.filter((hit) => hit.sourceType === "skill_knowledge_card");
    const documentRows = await this.prisma.skillDocumentChunk.findMany({
      where: {
        skillId: { in: input.enabledSkillIds },
        skillDocument: { status: "ready" },
        skill: {
          status: "active",
          archivedAt: null
        },
        OR: documentHits.map((hit) => ({
          skillDocumentId: hit.sourceId,
          sourceVersion: hit.sourceVersion,
          chunkIndex: hit.chunkIndex
        }))
      },
      include: {
        skillDocument: {
          select: {
            id: true,
            displayName: true,
            originalFilename: true,
            mimeType: true,
            status: true
          }
        },
        skill: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      }
    });
    const cardRows = await this.prisma.skillKnowledgeCardChunk.findMany({
      where: {
        skillId: { in: input.enabledSkillIds },
        knowledgeCard: { status: "ready", lifecycleStatus: "active" },
        skill: {
          status: "active",
          archivedAt: null
        },
        OR: cardHits.map((hit) => ({
          skillKnowledgeCardId: hit.sourceId,
          sourceVersion: hit.sourceVersion,
          chunkIndex: hit.chunkIndex
        }))
      },
      include: {
        knowledgeCard: {
          select: {
            id: true,
            title: true,
            status: true,
            lifecycleStatus: true
          }
        },
        skill: {
          select: {
            id: true,
            name: true,
            category: true
          }
        }
      }
    });
    const rows: SkillChunkRow[] = [
      ...documentRows.map(
        (row): SkillChunkRow => ({
          id: row.id,
          sourceKind: "skill_document",
          sourceId: row.skillDocumentId,
          skillId: row.skillId,
          workspaceId: row.workspaceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          locator: row.locator,
          content: row.content,
          embeddingModelKey: row.embeddingModelKey,
          sourceTitle: row.skillDocument.displayName ?? row.skillDocument.originalFilename,
          mimeType: row.skillDocument.mimeType,
          skill: row.skill
        })
      ),
      ...cardRows.map(
        (row): SkillChunkRow => ({
          id: row.id,
          sourceKind: "skill_knowledge_card",
          sourceId: row.skillKnowledgeCardId,
          skillId: row.skillId,
          workspaceId: row.workspaceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          locator: row.locator,
          content: row.content,
          embeddingModelKey: row.embeddingModelKey,
          sourceTitle: row.knowledgeCard.title,
          mimeType: "text/markdown",
          skill: row.skill
        })
      )
    ];
    for (const row of rows) {
      const referenceId = this.buildSkillReferenceId(row);
      const vectorScore = vectorScoresByReferenceId.get(referenceId);
      if (vectorScore === undefined) {
        continue;
      }
      const lexicalScore = this.scoreSkillRow(row, input.query);
      this.upsertSkillCandidate(input.rankedByReferenceId, {
        row,
        score: vectorScore * 42 + lexicalScore * 0.35,
        lexicalScore,
        vectorScore,
        referenceId
      });
    }
  }

  private scoreSkillRow(row: SkillChunkRow, query: string): number {
    return (
      this.scoreText(row.content, query) +
      this.scoreText(row.locator ?? "", query) * 0.6 +
      this.scoreText(row.sourceTitle, query) * 1.2 +
      this.scoreText(this.localize(row.skill.name, null), query) * 1.4 +
      (row.sourceTitle ? 3 : 0)
    );
  }

  private upsertSkillCandidate(
    candidates: Map<string, RankedSkillCandidate>,
    candidate: RankedSkillCandidate
  ): void {
    const existing = candidates.get(candidate.referenceId);
    if (
      existing === undefined ||
      candidate.score > existing.score ||
      (candidate.score === existing.score && candidate.lexicalScore > existing.lexicalScore)
    ) {
      candidates.set(candidate.referenceId, candidate);
    }
  }

  private selectSkillCandidates(
    candidates: RankedSkillCandidate[],
    maxResults: number
  ): RankedSkillCandidate[] {
    const selected: RankedSkillCandidate[] = [];
    const seenContent = new Set<string>();
    const perDocumentCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const dedupeKey = [
        candidate.row.sourceId,
        this.normalizeSearchText(candidate.row.locator ?? ""),
        this.normalizeSearchText(candidate.row.content).slice(0, 180)
      ].join(":");
      if (seenContent.has(dedupeKey)) {
        continue;
      }
      const documentCount = perDocumentCounts.get(candidate.row.sourceId) ?? 0;
      if (documentCount >= 2) {
        continue;
      }
      seenContent.add(dedupeKey);
      perDocumentCounts.set(candidate.row.sourceId, documentCount + 1);
      selected.push(candidate);
      if (selected.length >= maxResults) {
        break;
      }
    }
    return selected;
  }

  private async fetchSkillCandidateWindow(
    candidate: RankedSkillCandidate,
    policy: { fetchMaxChars: number; windowRadius: number }
  ): Promise<SkillFetchedContent> {
    const row = candidate.row;
    const surroundingRows =
      row.sourceKind === "skill_knowledge_card"
        ? ((await this.prisma.skillKnowledgeCardChunk.findMany({
            where: {
              skillKnowledgeCardId: row.sourceId,
              skillId: row.skillId,
              sourceVersion: row.sourceVersion,
              chunkIndex: {
                gte: Math.max(0, row.chunkIndex - policy.windowRadius),
                lte: row.chunkIndex + policy.windowRadius
              },
              knowledgeCard: { status: "ready", lifecycleStatus: "active" },
              skill: {
                status: "active",
                archivedAt: null
              }
            },
            orderBy: [{ chunkIndex: "asc" }]
          })) as Array<
            Pick<
              SkillChunkRow,
              "chunkIndex" | "content" | "embeddingModelKey" | "locator" | "sourceVersion"
            >
          >)
        : ((await this.prisma.skillDocumentChunk.findMany({
            where: {
              skillDocumentId: row.sourceId,
              skillId: row.skillId,
              sourceVersion: row.sourceVersion,
              chunkIndex: {
                gte: Math.max(0, row.chunkIndex - policy.windowRadius),
                lte: row.chunkIndex + policy.windowRadius
              },
              skillDocument: { status: "ready" },
              skill: {
                status: "active",
                archivedAt: null
              }
            },
            orderBy: [{ chunkIndex: "asc" }]
          })) as Array<
            Pick<
              SkillChunkRow,
              "chunkIndex" | "content" | "embeddingModelKey" | "locator" | "sourceVersion"
            >
          >);
    const windowRows = surroundingRows.length > 0 ? surroundingRows : [row];
    const content = windowRows
      .map((entry) => entry.content.trim())
      .filter((entry) => entry.length > 0)
      .join("\n\n---\n\n")
      .slice(0, Math.max(MAX_SKILL_FETCHED_ITEM_CHARS, policy.fetchMaxChars));
    return {
      content: content.length > 0 ? content : row.content,
      fetchDepth: windowRows.length,
      fetchedChars: content.length > 0 ? content.length : row.content.length,
      windowStartChunkIndex: windowRows[0]?.chunkIndex ?? row.chunkIndex,
      windowEndChunkIndex: windowRows[windowRows.length - 1]?.chunkIndex ?? row.chunkIndex,
      embeddingModelKey:
        windowRows.find((entry) => typeof entry.embeddingModelKey === "string")
          ?.embeddingModelKey ??
        row.embeddingModelKey ??
        null
    };
  }

  private buildSkillReferenceId(row: SkillChunkRow): string {
    return `skill:${row.skillId}:${row.sourceKind}:${row.sourceId}:${String(row.sourceVersion)}:${String(row.chunkIndex)}`;
  }

  private buildSnippet(content: string, terms: string[]): string | null {
    const normalized = this.truncate(content, 320);
    if (normalized.length === 0) {
      return null;
    }
    const lowered = normalized.toLowerCase();
    const matchIndex =
      terms
        .map((term) => lowered.indexOf(term.toLowerCase()))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? 0;
    const start = Math.max(0, matchIndex - 120);
    const end = Math.min(normalized.length, start + 320);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < normalized.length ? "..." : "";
    return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
  }

  private normalizeSearchText(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  private localize(value: unknown, locale: string | null): string {
    const row = this.asObject(value);
    if (row === null) {
      return "Skill";
    }
    const preferredLocale = locale?.trim();
    const preferred =
      preferredLocale && typeof row[preferredLocale] === "string"
        ? (row[preferredLocale] as string)
        : null;
    const language = preferredLocale?.split("-")[0] ?? null;
    const languageMatch =
      language && typeof row[language] === "string" ? (row[language] as string) : null;
    const english = typeof row.en === "string" ? row.en : null;
    const first = Object.values(row).find((entry): entry is string => typeof entry === "string");
    return (
      preferred?.trim() || languageMatch?.trim() || english?.trim() || first?.trim() || "Skill"
    );
  }

  private truncate(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxChars
      ? normalized
      : `${normalized.slice(0, maxChars - 3).trim()}...`;
  }

  private resolveTelemetryErrorCode(error: unknown): string {
    if (error instanceof BadRequestException) {
      return "bad_request";
    }
    return error instanceof Error && error.name.trim().length > 0
      ? error.name.trim()
      : "retrieval_error";
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
