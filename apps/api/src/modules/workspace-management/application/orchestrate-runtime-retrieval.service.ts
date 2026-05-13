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
import { SkillRetrievalPolicyService } from "./skill-retrieval-policy.service";
import {
  SkillRetrievalStateService,
  type SkillRetrievalDecisionMode,
  type SkillRetrievalState
} from "./skill-retrieval-state.service";
import {
  KNOWLEDGE_VECTOR_INDEX,
  type KnowledgeVectorIndex,
  type KnowledgeVectorSearchHit
} from "./knowledge-vector-index";
import { ReadAssistantKnowledgeService } from "./read-assistant-knowledge.service";

/**
 * ADR-094 — `MAX_CONTEXT_ITEMS` and `MAX_ITEM_CHARS` are no longer in-file
 * literals; they are derived from per-plan retrieval policy. The remaining
 * constants below are unrelated technical caps (skill window cap, rendered
 * block hard cap, per-source pre-rerank result count, vector cutoff).
 */
const MAX_SKILL_FETCHED_ITEM_CHARS = 2_400;
const MAX_RENDERED_BLOCK_CHARS = 6_000;
const MAX_PER_SOURCE_RESULTS = 3;
const MIN_SKILL_VECTOR_SCORE = 0.18;
/**
 * ADR-094 — minimum number of context items the orchestrated block can hold,
 * even on the most restrictive plan. Anything below this would defeat the
 * point of orchestration. Effective limit is `max(policy.maxMaxResults, MIN_CONTEXT_ITEMS)`.
 */
const MIN_CONTEXT_ITEMS = 4;

type RuntimeRetrievalInput = {
  assistantId: string;
  query: string;
  locale: string | null;
  retrievalPlan: RuntimeRetrievalPlan;
  sourcePolicy: {
    mode: "default" | "active_skill";
    state: OrchestratedPolicyState;
    allowedKnowledgeSearchSources: Array<
      "document" | "memory" | "chat" | "subscription" | "global"
    >;
    allowedKnowledgeFetchSources: Array<"document" | "memory" | "chat" | "subscription" | "global">;
  } | null;
  conversation: {
    channel: string;
    surfaceThreadKey: string;
  } | null;
};

type OrchestratedRetrievalTelemetrySource = "skill" | "document" | "product" | "web";

type OrchestratedPolicyState =
  | "default"
  | "skill_only"
  | "escalated_to_user"
  | "escalated_to_web"
  | "escalated_to_product"
  | "ordinary_personal_first"
  | "ordinary_product_first"
  | "ordinary_web_first"
  | "ordinary_mixed_ambiguous";

type StagedContextItem = {
  item: RuntimeRetrievedKnowledgeContextItem;
  stagePriority: number;
};

type SkillChunkRow = {
  id: string;
  sourceKind: "skill_document" | "skill_knowledge_card";
  sourceId: string;
  skillId: string;
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
  decisionMode: SkillRetrievalDecisionMode;
  cacheReuseHit: boolean;
  helperApplied: boolean;
  helperChangedOrder: boolean;
  embeddingModelKey: string | null;
  helperModelKey: string | null;
  helperProviderKey: string | null;
  helperInputTokens: number | null;
  helperOutputTokens: number | null;
  helperTotalTokens: number | null;
  retrievalMode: "lexical" | "hybrid";
  candidateCount: number;
  topScoreMargin: number | null;
  querySimilarityToLastTurn: number | null;
  cachedReferenceCoverage: number | null;
  candidateAmbiguity: number | null;
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
    private readonly skillRetrievalPolicyService: SkillRetrievalPolicyService,
    private readonly skillRetrievalStateService: SkillRetrievalStateService,
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
    const sourcePolicy = this.parseSourcePolicy(row?.sourcePolicy);
    if (assistantId === null || query === null || retrievalPlan === null) {
      throw new BadRequestException("assistantId, query, and retrievalPlan are required.");
    }
    const conversation = this.parseConversation(row?.conversation);
    return { assistantId, query, locale, retrievalPlan, sourcePolicy, conversation };
  }

  async execute(input: RuntimeRetrievalInput): Promise<RuntimeRetrievedKnowledgeContext> {
    const workspaceId = await this.resolveAssistantWorkspaceId(input.assistantId);
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    const maxContextItems = Math.max(retrievalPolicy.maxMaxResults, MIN_CONTEXT_ITEMS);
    const maxItemChars = retrievalPolicy.fetchMaxChars;
    const stagedItems: StagedContextItem[] = [];
    if (this.isActiveSkillTurn(input)) {
      let policyState: OrchestratedPolicyState = "skill_only";
      let skillItems: RuntimeRetrievedKnowledgeContextItem[] = [];
      let skillResult: SkillReferenceSearchResult | null = null;
      let skillDurationMs = 0;
      if (input.retrievalPlan.useSkills) {
        const skillStartedAt = Date.now();
        skillResult = await this.executeSkillReferenceSearch(input, workspaceId);
        skillDurationMs = Date.now() - skillStartedAt;
        skillItems = skillResult.items;
        stagedItems.push(...skillItems.map((item) => ({ item, stagePriority: 0 })));
      }
      const skillCoverageInsufficient = skillItems.length === 0;
      const shouldEscalateToUser =
        skillCoverageInsufficient && input.retrievalPlan.useUserKnowledge;
      if (shouldEscalateToUser) {
        policyState = "escalated_to_user";
        stagedItems.push(
          ...(
            await this.withTelemetry({
              workspaceId,
              assistantId: input.assistantId,
              source: "document",
              policyState,
              execute: async () => [
                ...(await this.searchKnowledgeSource(
                  input,
                  "document",
                  "user_document",
                  maxItemChars
                )),
                ...(await this.searchKnowledgeSource(
                  input,
                  "memory",
                  "user_document",
                  maxItemChars
                )),
                ...(await this.searchKnowledgeSource(input, "chat", "user_document", maxItemChars))
              ]
            })
          ).map((item) => ({ item, stagePriority: 1 }))
        );
      }
      if (input.retrievalPlan.useWeb) {
        policyState = "escalated_to_web";
        await this.recordTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          source: "web",
          durationMs: 0,
          resultCount: 0,
          outcome: "empty",
          errorCode: "web_reference_not_executed",
          policyState
        });
      }
      if (input.retrievalPlan.useProductKnowledge) {
        policyState = "escalated_to_product";
        stagedItems.push(
          ...(
            await this.withTelemetry({
              workspaceId,
              assistantId: input.assistantId,
              source: "product",
              policyState,
              execute: async () => [
                ...(await this.searchKnowledgeSource(input, "global", "product_kb", maxItemChars)),
                ...(await this.searchKnowledgeSource(
                  input,
                  "subscription",
                  "product_kb",
                  maxItemChars
                ))
              ]
            })
          ).map((item) => ({ item, stagePriority: 3 }))
        );
      }
      if (skillResult !== null) {
        await this.recordSkillTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          result: skillResult,
          durationMs: skillDurationMs,
          policyState
        });
      }
    } else {
      const ordinaryPolicyState = this.resolveOrdinaryPolicyState(
        input.retrievalPlan.ordinarySourcePriorityMode
      );
      const stagePriorities = this.resolveOrdinaryStagePriorities(
        input.retrievalPlan.ordinarySourcePriorityMode
      );
      if (input.retrievalPlan.useSkills) {
        const skillStartedAt = Date.now();
        const skillResult = await this.executeSkillReferenceSearch(input, workspaceId);
        const skillDurationMs = Date.now() - skillStartedAt;
        stagedItems.push(
          ...skillResult.items.map((item) => ({ item, stagePriority: stagePriorities.skill }))
        );
        await this.recordSkillTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          result: skillResult,
          durationMs: skillDurationMs,
          policyState: ordinaryPolicyState
        });
      }
      if (input.retrievalPlan.useUserKnowledge) {
        stagedItems.push(
          ...(
            await this.withTelemetry({
              workspaceId,
              assistantId: input.assistantId,
              source: "document",
              policyState: ordinaryPolicyState,
              execute: async () => [
                ...(await this.searchKnowledgeSource(
                  input,
                  "document",
                  "user_document",
                  maxItemChars
                )),
                ...(await this.searchKnowledgeSource(
                  input,
                  "memory",
                  "user_document",
                  maxItemChars
                )),
                ...(await this.searchKnowledgeSource(input, "chat", "user_document", maxItemChars))
              ]
            })
          ).map((item) => ({ item, stagePriority: stagePriorities.user }))
        );
      }
      if (input.retrievalPlan.useProductKnowledge) {
        stagedItems.push(
          ...(
            await this.withTelemetry({
              workspaceId,
              assistantId: input.assistantId,
              source: "product",
              policyState: ordinaryPolicyState,
              execute: async () => [
                ...(await this.searchKnowledgeSource(input, "global", "product_kb", maxItemChars)),
                ...(await this.searchKnowledgeSource(
                  input,
                  "subscription",
                  "product_kb",
                  maxItemChars
                ))
              ]
            })
          ).map((item) => ({ item, stagePriority: stagePriorities.product }))
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
          errorCode: "web_reference_not_executed",
          policyState: ordinaryPolicyState
        });
      }
    }

    const selected = this.selectContextItems(stagedItems, maxContextItems);
    const renderedBlock = this.renderContextBlock(selected);
    return {
      items: selected,
      renderedBlock
    };
  }

  /**
   * ADR-094 — orchestrated retrieval first asks `searchKnowledge`, which now
   * already inlines content for short / medium single-hit documents
   * (`inlinedDocument` / `inlinedSection`). We use that inline payload
   * verbatim when present and only fall back to a separate `fetch` call when
   * the search did not inline anything (multi-hit branches and
   * memory/chat sources).
   */
  private async searchKnowledgeSource(
    input: RuntimeRetrievalInput,
    source: "document" | "memory" | "chat" | "global" | "subscription",
    label: RuntimeRetrievedKnowledgeSourceLabel,
    maxItemChars: number
  ): Promise<RuntimeRetrievedKnowledgeContextItem[]> {
    if (!this.isSearchSourceAllowedByPolicy(input, source)) {
      throw new BadRequestException(`Knowledge source "${source}" is blocked by the turn policy.`);
    }
    const hits = await this.readAssistantKnowledgeService.search({
      assistantId: input.assistantId,
      source,
      query: input.query,
      maxResults: MAX_PER_SOURCE_RESULTS
    });
    const items: RuntimeRetrievedKnowledgeContextItem[] = [];
    for (const hit of hits.slice(0, MAX_PER_SOURCE_RESULTS)) {
      let resolvedContent: string | null = null;
      let resolvedTitle: string | null = hit.title;
      let resolvedLocator: string | null = hit.locator;
      let smartMetadata: Record<string, unknown> | null = null;

      if (hit.inlinedDocument !== undefined) {
        resolvedContent = hit.inlinedDocument.text;
        smartMetadata = {
          smartInlineKind: "document",
          inlinedChars: hit.inlinedDocument.chars,
          inlinedTruncated: hit.inlinedDocument.truncated
        };
      } else if (hit.inlinedSection !== undefined) {
        const summary = hit.documentSummary;
        resolvedContent =
          summary !== undefined && summary.text.length > 0
            ? `${hit.inlinedSection.text}\n\n[summary of remaining sections]\n${summary.text}`
            : hit.inlinedSection.text;
        smartMetadata = {
          smartInlineKind: summary !== undefined ? "section_with_summary" : "section",
          inlinedChars: hit.inlinedSection.chars,
          sectionRadius: hit.inlinedSection.radius,
          inlinedTruncated: hit.inlinedSection.truncated,
          ...(summary !== undefined ? { summaryChars: summary.chars } : {})
        };
      } else {
        const fetched = await this.readAssistantKnowledgeService.fetch({
          assistantId: input.assistantId,
          source,
          referenceId: hit.referenceId,
          mode: "section",
          radius: null
        });
        resolvedContent =
          this.asNonEmptyString(fetched?.content) ?? this.asNonEmptyString(hit.snippet);
        if (fetched !== null) {
          resolvedTitle = fetched.title ?? hit.title;
          resolvedLocator = fetched.locator ?? hit.locator;
        }
      }

      if (resolvedContent === null) {
        continue;
      }

      items.push({
        label,
        referenceId: hit.referenceId,
        title: resolvedTitle,
        locator: resolvedLocator,
        content: this.truncate(resolvedContent, maxItemChars),
        score: hit.score,
        metadata: {
          ...(hit.metadata ?? {}),
          source,
          ...(smartMetadata ?? {})
        }
      });
    }
    return items;
  }

  private isSearchSourceAllowedByPolicy(
    input: RuntimeRetrievalInput,
    source: "document" | "memory" | "chat" | "global" | "subscription"
  ): boolean {
    if (input.sourcePolicy === null) {
      return true;
    }
    return input.sourcePolicy.allowedKnowledgeSearchSources.includes(source);
  }

  private async recordSkillTelemetry(input: {
    workspaceId: string | null;
    assistantId: string;
    result: SkillReferenceSearchResult;
    durationMs: number;
    policyState: OrchestratedPolicyState;
  }): Promise<void> {
    await this.recordTelemetry({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      source: "skill",
      durationMs: input.durationMs,
      resultCount: input.result.items.length,
      outcome: input.result.items.length > 0 ? "success" : "empty",
      errorCode: null,
      retrievalMode: input.result.retrievalMode,
      lexicalCandidateCount: input.result.lexicalCandidateCount,
      vectorCandidateCount: input.result.vectorCandidateCount,
      decisionMode: input.result.decisionMode,
      cacheReuseHit: input.result.cacheReuseHit,
      helperApplied: input.result.helperApplied,
      helperChangedOrder: input.result.helperChangedOrder,
      embeddingModelKey: input.result.embeddingModelKey,
      helperModelKey: input.result.helperModelKey,
      helperProviderKey: input.result.helperProviderKey,
      helperInputTokens: input.result.helperInputTokens,
      helperOutputTokens: input.result.helperOutputTokens,
      helperTotalTokens: input.result.helperTotalTokens,
      candidateCount: input.result.candidateCount,
      topScoreMargin: input.result.topScoreMargin,
      querySimilarityToLastTurn: input.result.querySimilarityToLastTurn,
      cachedReferenceCoverage: input.result.cachedReferenceCoverage,
      candidateAmbiguity: input.result.candidateAmbiguity,
      policyState: input.policyState
    });
    if (input.result.fetchedChars > 0) {
      await this.recordFetchTelemetry({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        source: "skill",
        retrievalMode: input.result.retrievalMode,
        durationMs: input.durationMs,
        fetchDepth: input.result.fetchDepth,
        fetchedChars: input.result.fetchedChars,
        embeddingModelKey: input.result.embeddingModelKey,
        modeUsed: "orchestrate_inline",
        bytesReturned: input.result.fetchedChars
      });
    }
  }

  private isActiveSkillTurn(input: RuntimeRetrievalInput): boolean {
    return (
      input.sourcePolicy?.mode === "active_skill" ||
      (input.retrievalPlan.useSkills && input.retrievalPlan.selectedSkillIds.length > 0)
    );
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
        decisionMode: result.decisionMode,
        cacheReuseHit: result.cacheReuseHit,
        helperApplied: result.helperApplied,
        helperChangedOrder: result.helperChangedOrder,
        embeddingModelKey: result.embeddingModelKey,
        helperModelKey: result.helperModelKey,
        helperProviderKey: result.helperProviderKey,
        helperInputTokens: result.helperInputTokens,
        helperOutputTokens: result.helperOutputTokens,
        helperTotalTokens: result.helperTotalTokens,
        candidateCount: result.candidateCount,
        topScoreMargin: result.topScoreMargin,
        querySimilarityToLastTurn: result.querySimilarityToLastTurn,
        cachedReferenceCoverage: result.cachedReferenceCoverage,
        candidateAmbiguity: result.candidateAmbiguity,
        policyState: "default"
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
          embeddingModelKey: result.embeddingModelKey,
          modeUsed: "orchestrate_inline",
          bytesReturned: result.fetchedChars
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
        errorCode: this.resolveTelemetryErrorCode(error),
        policyState: "default"
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
    const activeSkillId = enabledSkillIds.length === 1 ? enabledSkillIds[0]! : null;
    const retrievalChatContext = await this.skillRetrievalStateService.resolveChatContext({
      assistantId: input.assistantId,
      conversation: input.conversation
    });
    const queryFingerprint = this.skillRetrievalStateService.buildQueryFingerprint(input.query);
    const reuseDecision = this.skillRetrievalPolicyService.decideBeforeSearch({
      activeSkillId,
      currentUserMessageId: retrievalChatContext?.currentUserMessageId ?? null,
      queryFingerprint,
      state: retrievalChatContext?.state ?? null
    });
    if (
      activeSkillId !== null &&
      retrievalChatContext !== null &&
      retrievalChatContext.state !== null &&
      reuseDecision?.mode === "reuse_cached_refs"
    ) {
      const reused = await this.reuseSkillReferenceState({
        activeSkillId,
        locale: input.locale,
        retrievalPolicy: await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
          input.assistantId
        ),
        state: retrievalChatContext.state
      });
      if (reused !== null) {
        await this.persistSkillRetrievalState({
          chatId: retrievalChatContext.chatId,
          currentUserMessageId: retrievalChatContext.currentUserMessageId,
          currentUserMessageIndex: retrievalChatContext.currentUserMessageIndex,
          activeSkillId,
          queryFingerprint,
          items: reused.items,
          candidateReferenceIds: retrievalChatContext.state.lastTopReferenceIds,
          decisionMode: reuseDecision.mode,
          helperApplied: false,
          helperChangedOrder: false,
          previousState: retrievalChatContext.state
        });
        return {
          ...reused,
          decisionMode: reuseDecision.mode,
          cacheReuseHit: true,
          candidateCount: reuseDecision.candidateCount,
          topScoreMargin: reuseDecision.topScoreMargin,
          querySimilarityToLastTurn: reuseDecision.querySimilarityToLastTurn,
          cachedReferenceCoverage: reuseDecision.cachedReferenceCoverage,
          candidateAmbiguity: reuseDecision.candidateAmbiguity
        };
      }
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
        workspaceId: null,
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
    const retrievalDecision = this.skillRetrievalPolicyService.decideAfterSearch({
      activeSkillId,
      queryFingerprint,
      state: retrievalChatContext?.state ?? null,
      candidates: selected.map((candidate) => ({
        referenceId: candidate.referenceId,
        score: candidate.score
      }))
    });
    let helperRanking = null;
    let helperChangedOrder = false;
    const selectedBeforeHelper = selected.map((candidate) => candidate.referenceId);
    if (retrievalDecision.mode === "refresh_with_helper") {
      helperRanking = await this.knowledgeRetrievalHelperService.rerankCandidates({
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
    }
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
      helperChangedOrder = selected.some(
        (candidate, index) => candidate.referenceId !== selectedBeforeHelper[index]
      );
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
    if (retrievalChatContext !== null && activeSkillId !== null) {
      await this.persistSkillRetrievalState({
        chatId: retrievalChatContext.chatId,
        currentUserMessageId: retrievalChatContext.currentUserMessageId,
        currentUserMessageIndex: retrievalChatContext.currentUserMessageIndex,
        activeSkillId,
        queryFingerprint,
        items,
        candidateReferenceIds: selected.map((candidate) => candidate.referenceId),
        decisionMode: retrievalDecision.mode,
        helperApplied: helperRanking !== null,
        helperChangedOrder,
        previousState: retrievalChatContext.state
      });
    }
    return {
      items,
      lexicalCandidateCount: rows.length,
      vectorCandidateCount,
      decisionMode: retrievalDecision.mode,
      cacheReuseHit: false,
      helperApplied: helperRanking !== null,
      helperChangedOrder,
      embeddingModelKey,
      helperModelKey: helperRanking?.modelKey ?? null,
      helperProviderKey: helperRanking?.providerKey ?? null,
      helperInputTokens: helperRanking?.usage?.inputTokens ?? null,
      helperOutputTokens: helperRanking?.usage?.outputTokens ?? null,
      helperTotalTokens: helperRanking?.usage?.totalTokens ?? null,
      retrievalMode,
      candidateCount: selected.length,
      topScoreMargin: retrievalDecision.topScoreMargin,
      querySimilarityToLastTurn: retrievalDecision.querySimilarityToLastTurn,
      cachedReferenceCoverage: retrievalDecision.cachedReferenceCoverage,
      candidateAmbiguity: retrievalDecision.candidateAmbiguity,
      fetchDepth: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchDepth, 0),
      fetchedChars: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchedChars, 0)
    };
  }

  private async withTelemetry(input: {
    workspaceId: string | null;
    assistantId: string;
    source: OrchestratedRetrievalTelemetrySource;
    policyState: OrchestratedPolicyState;
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
        errorCode: null,
        policyState: input.policyState
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
        errorCode: this.resolveTelemetryErrorCode(error),
        policyState: input.policyState
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
    decisionMode?: SkillRetrievalDecisionMode;
    cacheReuseHit?: boolean;
    helperApplied?: boolean;
    helperChangedOrder?: boolean;
    embeddingModelKey?: string | null;
    helperModelKey?: string | null;
    helperProviderKey?: string | null;
    helperInputTokens?: number | null;
    helperOutputTokens?: number | null;
    helperTotalTokens?: number | null;
    candidateCount?: number;
    topScoreMargin?: number | null;
    querySimilarityToLastTurn?: number | null;
    cachedReferenceCoverage?: number | null;
    candidateAmbiguity?: number | null;
    policyState: OrchestratedPolicyState;
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
      cacheReuseHit: input.cacheReuseHit ?? false,
      helperApplied: input.helperApplied ?? false,
      helperChangedOrder: input.helperChangedOrder ?? false,
      embeddingModelKey: input.embeddingModelKey ?? null,
      helperModelKey: input.helperModelKey ?? null,
      helperProviderKey: input.helperProviderKey ?? null,
      helperInputTokens: input.helperInputTokens ?? null,
      helperOutputTokens: input.helperOutputTokens ?? null,
      helperTotalTokens: input.helperTotalTokens ?? null,
      candidateCount: input.candidateCount ?? input.resultCount,
      topScoreMargin: input.topScoreMargin ?? null,
      querySimilarityToLastTurn: input.querySimilarityToLastTurn ?? null,
      cachedReferenceCoverage: input.cachedReferenceCoverage ?? null,
      candidateAmbiguity: input.candidateAmbiguity ?? null,
      policyState: input.policyState,
      outcome: input.outcome,
      errorCode: input.errorCode,
      // ADR-094 — orchestrator aggregate search rows are per-source stage
      // signals (latency / candidate counts), not content-bearing responses.
      // The actual smart-inline / snippet truth lives on the upstream
      // ReadAssistantKnowledgeService.search* rows; here we tag as
      // `snippet_only` with no bytes returned so dashboards do not see NULL on
      // the orchestrator stage.
      modeUsed: "snippet_only",
      bytesReturned: 0,
      ...(input.source === "skill" && input.decisionMode !== undefined
        ? { decisionMode: input.decisionMode }
        : {})
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
    /** ADR-094 — short tag for the orchestrate-side inline branch. */
    modeUsed?: string | null;
    /** ADR-094 — chars the orchestrate seam folded into the prompt block. */
    bytesReturned?: number | null;
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
      embeddingModelKey: input.embeddingModelKey,
      modeUsed: input.modeUsed ?? null,
      bytesReturned: input.bytesReturned ?? input.fetchedChars
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

  private resolveOrdinaryPolicyState(
    mode: RuntimeRetrievalPlan["ordinarySourcePriorityMode"]
  ): OrchestratedPolicyState {
    switch (mode) {
      case "personal_first":
        return "ordinary_personal_first";
      case "product_first":
        return "ordinary_product_first";
      case "web_first":
        return "ordinary_web_first";
      case "mixed_ambiguous":
        return "ordinary_mixed_ambiguous";
      default:
        return "default";
    }
  }

  private resolveOrdinaryStagePriorities(
    mode: RuntimeRetrievalPlan["ordinarySourcePriorityMode"]
  ): { skill: number; user: number; product: number } {
    switch (mode) {
      case "product_first":
        return { skill: 0, user: 2, product: 1 };
      case "web_first":
        return { skill: 0, user: 2, product: 3 };
      case "mixed_ambiguous":
        return { skill: 0, user: 1, product: 2 };
      case "personal_first":
      case "not_applicable":
      default:
        return { skill: 0, user: 1, product: 2 };
    }
  }

  private selectContextItems(
    items: StagedContextItem[],
    maxContextItems: number
  ): RuntimeRetrievedKnowledgeContextItem[] {
    const seen = new Set<string>();
    return [...items]
      .sort((left, right) => {
        if (left.stagePriority !== right.stagePriority) {
          return left.stagePriority - right.stagePriority;
        }
        return (right.item.score ?? 0) - (left.item.score ?? 0);
      })
      .filter(({ item }) => {
        const key = `${item.label}:${item.referenceId}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map(({ item }) => item)
      .slice(0, maxContextItems);
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

  private parseSourcePolicy(value: unknown): RuntimeRetrievalInput["sourcePolicy"] {
    if (value === undefined || value === null) {
      return null;
    }
    const row = this.asObject(value);
    const mode =
      row?.mode === "active_skill" ? "active_skill" : row?.mode === "default" ? "default" : null;
    const state = this.asPolicyState(row?.state);
    const allowedKnowledgeSearchSources = this.asKnowledgePolicySources(
      row?.allowedKnowledgeSearchSources
    );
    const allowedKnowledgeFetchSources = this.asKnowledgePolicySources(
      row?.allowedKnowledgeFetchSources
    );
    if (
      mode === null ||
      state === null ||
      allowedKnowledgeSearchSources === null ||
      allowedKnowledgeFetchSources === null
    ) {
      throw new BadRequestException("sourcePolicy is invalid.");
    }
    return {
      mode,
      state,
      allowedKnowledgeSearchSources,
      allowedKnowledgeFetchSources
    };
  }

  private parseConversation(value: unknown): {
    channel: string;
    surfaceThreadKey: string;
  } | null {
    const row = this.asObject(value);
    const channel = this.asNonEmptyString(row?.channel);
    const surfaceThreadKey = this.asNonEmptyString(row?.surfaceThreadKey);
    if (channel === null || surfaceThreadKey === null) {
      return null;
    }
    return {
      channel,
      surfaceThreadKey
    };
  }

  private asPolicyState(value: unknown): OrchestratedPolicyState | null {
    switch (value) {
      case "default":
      case "skill_only":
      case "escalated_to_user":
      case "escalated_to_web":
      case "escalated_to_product":
      case "ordinary_personal_first":
      case "ordinary_product_first":
      case "ordinary_web_first":
      case "ordinary_mixed_ambiguous":
        return value;
      default:
        return null;
    }
  }

  private asKnowledgePolicySources(
    value: unknown
  ): Array<"document" | "memory" | "chat" | "subscription" | "global"> | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const sources = value.filter(
      (entry): entry is "document" | "memory" | "chat" | "subscription" | "global" =>
        entry === "document" ||
        entry === "memory" ||
        entry === "chat" ||
        entry === "subscription" ||
        entry === "global"
    );
    if (sources.length !== value.length) {
      return null;
    }
    return sources;
  }

  private async persistSkillRetrievalState(input: {
    chatId: string;
    currentUserMessageId: string;
    currentUserMessageIndex: number;
    activeSkillId: string;
    queryFingerprint: string;
    items: RuntimeRetrievedKnowledgeContextItem[];
    candidateReferenceIds: string[];
    decisionMode: SkillRetrievalDecisionMode;
    helperApplied: boolean;
    helperChangedOrder: boolean;
    previousState: SkillRetrievalState | null;
  }): Promise<void> {
    const topItems = input.items
      .filter((item) => item.label === "skill_reference")
      .slice(0, MAX_PER_SOURCE_RESULTS);
    await this.skillRetrievalStateService.persistState(input.chatId, {
      activeSkillId: input.activeSkillId,
      lastUserMessageId: input.currentUserMessageId,
      lastUserQueryFingerprint: input.queryFingerprint,
      lastTopReferenceIds: topItems.map((item) => item.referenceId),
      lastTopReferenceScores: topItems.map((item) => item.score ?? 0),
      lastRetrievedAtMessageIndex: input.currentUserMessageIndex,
      lastMode: input.decisionMode,
      lastHelperApplied: input.helperApplied,
      lastHelperChangedOrder: input.helperChangedOrder,
      reuseStreak:
        input.decisionMode === "reuse_cached_refs"
          ? (input.previousState?.reuseStreak ?? 0) + 1
          : 0,
      lastCandidateSetHash: this.skillRetrievalPolicyService.buildCandidateSetHash(
        input.candidateReferenceIds
      )
    });
  }

  private async reuseSkillReferenceState(input: {
    activeSkillId: string;
    locale: string | null;
    retrievalPolicy: {
      fetchMaxChars: number;
      knowledgeFetchWindowRadius: number;
    };
    state: SkillRetrievalState;
  }): Promise<Omit<
    SkillReferenceSearchResult,
    | "decisionMode"
    | "cacheReuseHit"
    | "candidateCount"
    | "topScoreMargin"
    | "querySimilarityToLastTurn"
    | "cachedReferenceCoverage"
    | "candidateAmbiguity"
  > | null> {
    const selected: RankedSkillCandidate[] = [];
    for (const [index, referenceId] of input.state.lastTopReferenceIds.entries()) {
      const row = await this.loadSkillChunkRowByReferenceId(referenceId);
      if (row === null || row.skillId !== input.activeSkillId) {
        continue;
      }
      selected.push({
        row,
        score: input.state.lastTopReferenceScores[index] ?? Math.max(0, 1 - index * 0.01),
        lexicalScore: input.state.lastTopReferenceScores[index] ?? 0,
        vectorScore: null,
        referenceId
      });
      if (selected.length >= MAX_PER_SOURCE_RESULTS) {
        break;
      }
    }
    if (selected.length === 0) {
      return null;
    }
    const fetchedCandidates = await Promise.all(
      selected.map(async (candidate) => ({
        candidate,
        fetched: await this.fetchSkillCandidateWindow(candidate, {
          fetchMaxChars: input.retrievalPolicy.fetchMaxChars,
          windowRadius: input.retrievalPolicy.knowledgeFetchWindowRadius
        })
      }))
    );
    const items = fetchedCandidates.map(({ candidate, fetched }) => ({
      label: "skill_reference" as const,
      referenceId: candidate.referenceId,
      title: `${this.localize(candidate.row.skill.name, input.locale)} / ${candidate.row.sourceTitle}`,
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
        retrievalMode: "lexical",
        semanticGroundingRequired: false,
        vectorScore: null,
        embeddingModelKey: fetched.embeddingModelKey,
        stickyRetrievalReuse: true
      }
    }));
    return {
      items,
      lexicalCandidateCount: 0,
      vectorCandidateCount: 0,
      helperApplied: false,
      helperChangedOrder: false,
      embeddingModelKey: null,
      helperModelKey: null,
      helperProviderKey: null,
      helperInputTokens: null,
      helperOutputTokens: null,
      helperTotalTokens: null,
      retrievalMode: "lexical",
      fetchDepth: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchDepth, 0),
      fetchedChars: fetchedCandidates.reduce((total, item) => total + item.fetched.fetchedChars, 0)
    };
  }

  private async loadSkillChunkRowByReferenceId(referenceId: string): Promise<SkillChunkRow | null> {
    const parsed = this.parseSkillReferenceId(referenceId);
    if (parsed === null) {
      return null;
    }
    if (parsed.sourceKind === "skill_document") {
      const row = await this.prisma.skillDocumentChunk.findFirst({
        where: {
          skillId: parsed.skillId,
          skillDocumentId: parsed.sourceId,
          sourceVersion: parsed.sourceVersion,
          chunkIndex: parsed.chunkIndex,
          skillDocument: { status: "ready" },
          skill: { status: "active", archivedAt: null }
        },
        include: {
          skillDocument: {
            select: {
              displayName: true,
              originalFilename: true,
              mimeType: true
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
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        sourceKind: "skill_document",
        sourceId: row.skillDocumentId,
        skillId: row.skillId,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex,
        locator: row.locator,
        content: row.content,
        embeddingModelKey: row.embeddingModelKey,
        sourceTitle: row.skillDocument.displayName ?? row.skillDocument.originalFilename,
        mimeType: row.skillDocument.mimeType,
        skill: row.skill
      };
    }
    const row = await this.prisma.skillKnowledgeCardChunk.findFirst({
      where: {
        skillId: parsed.skillId,
        skillKnowledgeCardId: parsed.sourceId,
        sourceVersion: parsed.sourceVersion,
        chunkIndex: parsed.chunkIndex,
        knowledgeCard: { status: "ready", lifecycleStatus: "active" },
        skill: { status: "active", archivedAt: null }
      },
      include: {
        knowledgeCard: {
          select: {
            title: true
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
    if (row === null) {
      return null;
    }
    return {
      id: row.id,
      sourceKind: "skill_knowledge_card",
      sourceId: row.skillKnowledgeCardId,
      skillId: row.skillId,
      sourceVersion: row.sourceVersion,
      chunkIndex: row.chunkIndex,
      locator: row.locator,
      content: row.content,
      embeddingModelKey: row.embeddingModelKey,
      sourceTitle: row.knowledgeCard.title,
      mimeType: "text/markdown",
      skill: row.skill
    };
  }

  private parseSkillReferenceId(referenceId: string): {
    skillId: string;
    sourceKind: "skill_document" | "skill_knowledge_card";
    sourceId: string;
    sourceVersion: number;
    chunkIndex: number;
  } | null {
    const parts = referenceId.split(":");
    if (parts.length !== 6 || parts[0] !== "skill") {
      return null;
    }
    const sourceKind =
      parts[2] === "skill_document" || parts[2] === "skill_knowledge_card" ? parts[2] : null;
    const sourceVersion = Number.parseInt(parts[4] ?? "", 10);
    const chunkIndex = Number.parseInt(parts[5] ?? "", 10);
    if (
      sourceKind === null ||
      !Number.isInteger(sourceVersion) ||
      !Number.isInteger(chunkIndex) ||
      !parts[1] ||
      !parts[3]
    ) {
      return null;
    }
    return {
      skillId: parts[1],
      sourceKind,
      sourceId: parts[3],
      sourceVersion,
      chunkIndex
    };
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
    const ordinarySourcePriorityMode =
      row.ordinarySourcePriorityMode === "personal_first" ||
      row.ordinarySourcePriorityMode === "product_first" ||
      row.ordinarySourcePriorityMode === "web_first" ||
      row.ordinarySourcePriorityMode === "mixed_ambiguous" ||
      row.ordinarySourcePriorityMode === "not_applicable"
        ? row.ordinarySourcePriorityMode
        : row.useSkills
          ? "not_applicable"
          : "mixed_ambiguous";
    return {
      useSkills: row.useSkills,
      selectedSkillIds: row.selectedSkillIds
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 3),
      useUserKnowledge: row.useUserKnowledge,
      useProductKnowledge: row.useProductKnowledge,
      useWeb: row.useWeb,
      ordinarySourcePriorityMode: row.useSkills ? "not_applicable" : ordinarySourcePriorityMode,
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
      decisionMode: "refresh_search_only",
      cacheReuseHit: false,
      helperApplied: false,
      helperChangedOrder: false,
      embeddingModelKey: null,
      helperModelKey: null,
      helperProviderKey: null,
      helperInputTokens: null,
      helperOutputTokens: null,
      helperTotalTokens: null,
      retrievalMode: "lexical",
      candidateCount: 0,
      topScoreMargin: null,
      querySimilarityToLastTurn: null,
      cachedReferenceCoverage: null,
      candidateAmbiguity: null,
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
