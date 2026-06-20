import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_KNOWLEDGE_FETCH_MODES,
  type PersaiRuntimeKnowledgeFetchMode,
  type RuntimeKnowledgeDocument,
  type RuntimeKnowledgeDocumentSummary,
  type RuntimeKnowledgeInlinedDocument,
  type RuntimeKnowledgeInlinedSection,
  type RuntimeKnowledgeSearchHit
} from "@persai/runtime-contract";
import { type AdminKnowledgeRetrievalPolicyState } from "./admin-knowledge-retrieval-policy";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";
import { KnowledgeRetrievalObservabilityService } from "./knowledge-retrieval-observability.service";
import { KnowledgeRetrievalHelperService } from "./knowledge-retrieval-helper.service";
import { KNOWLEDGE_VECTOR_INDEX, type KnowledgeVectorIndex } from "./knowledge-vector-index";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const DEFAULT_KNOWLEDGE_SEARCH_MAX_RESULTS = 5;
const MAX_KNOWLEDGE_SEARCH_MAX_RESULTS = 8;
const KNOWLEDGE_FETCH_MAX_CHARS = 6_000;
const KNOWLEDGE_SEARCH_SNIPPET_MAX_CHARS = 320;
const KNOWLEDGE_SEARCH_SEMANTIC_CONTENT_MAX_CHARS = 2_000;
const SUPPORTED_KNOWLEDGE_SOURCES = [
  "document",
  "memory",
  "chat",
  "subscription",
  "global",
  "skill"
] as const;
const NON_PRODUCT_TOOL_CODES = new Set(["memory_search", "memory_get", "cron"]);

type SearchSourceRow = {
  knowledgeSourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey?: string | null;
  knowledgeSource: {
    id: string;
    namespace: string;
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
};

type GlobalSearchSourceRow = {
  globalKnowledgeSourceId: string;
  scope: "product";
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey?: string | null;
  globalKnowledgeSource: {
    id: string;
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
};

type ProductKnowledgeTextEntrySearchRow = {
  textEntryId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey?: string | null;
  textEntry: {
    id: string;
    title: string;
    category: string | null;
    locale: string | null;
    lifecycleStatus: string;
    status: string;
  };
};

type SkillSearchChunkRow = {
  sourceKind: "skill_document" | "skill_knowledge_card";
  sourceId: string;
  skillId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey: string | null;
  sourceTitle: string;
  mimeType: string;
  skillName: unknown;
  skillCategory: string;
};

type SkillDocumentChunkWithRelations = {
  skillDocumentId: string;
  skillId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey: string | null;
  skillDocument: {
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
  skill: {
    name: unknown;
    category: string;
  };
};

type SkillCardChunkWithRelations = {
  skillKnowledgeCardId: string;
  skillId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey: string | null;
  knowledgeCard: {
    title: string;
  };
  skill: {
    name: unknown;
    category: string;
  };
};

type UploadedGlobalSearchExecution = {
  hits: RuntimeKnowledgeSearchHit[];
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  retrievalMode: "lexical" | "hybrid";
  embeddingModelKey: string | null;
};

type MemoryRegistryRow = {
  id: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: "core" | "contextual";
  kind: "fact" | "preference" | "open_loop" | null;
  createdAt: Date;
};

type ChatThreadRow = {
  id: string;
  surface: "web" | "telegram";
  surfaceThreadKey: string;
  title: string | null;
  archivedAt: Date | null;
};

type ChatMessageRow = {
  id: string;
  chatId: string;
  author: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  chat: ChatThreadRow;
};

type ChatMessageWindowRow = Pick<ChatMessageRow, "id" | "author" | "content" | "createdAt">;

type TextKnowledgeSource = "subscription" | "global";

type TextKnowledgeDocumentRow = {
  referenceId: string;
  source: TextKnowledgeSource;
  title: string;
  locator: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
};

type SmartInlineSectionRow = {
  chunkIndex: number;
  locator: string | null;
  content: string;
};

type AssistantKnowledgeContextRow = {
  id: string;
  userId: string;
  workspaceId: string;
  applyAppliedVersionId: string | null;
  governance: {
    assistantPlanOverrideCode: string | null;
    quotaPlanCode: string | null;
  } | null;
};

type PlanCatalogKnowledgeRow = {
  code: string;
  displayName: string;
  description: string | null;
  status: "active" | "inactive";
  isTrialPlan: boolean;
  trialDurationDays: number | null;
  updatedAt: Date;
  entitlement: {
    schemaVersion: number;
    capabilities: unknown;
    toolClasses: unknown;
    channelsAndSurfaces: unknown;
    limitsPermissions: unknown;
  } | null;
  toolActivations: Array<{
    activationStatus: "active" | "inactive";
    dailyCallLimit: number | null;
    tool: {
      code: string;
      displayName: string;
      description: string | null;
      toolClass: string;
      capabilityGroup: string;
    };
  }>;
};

type SearchQueryInfo = {
  rawQuery: string;
  normalizedQuery: string;
  tokens: string[];
  searchTerms: string[];
  charTrigrams: Set<string>;
  tokenBigrams: Set<string>;
};

type SearchFieldWeights = {
  title: number;
  filename: number;
  locator: number;
  content: number;
  metadata: number;
};

type RankedSearchCandidate<Row> = {
  row: Row;
  score: number;
  lexicalScore: number;
  /**
   * Number of whole-token exact matches encountered while ranking this
   * candidate (across title/filename/locator/content/metadata fields).
   * Fuzzy/trigram-only matches do NOT count here. Used by the relevance
   * floor (`passesRelevanceFloor`) to keep weak single-token fuzzy hits
   * out of `knowledge_search` results without changing scoring or
   * ranking order.
   */
  exactTokenHits: number;
  dedupeKey: string;
  groupKey: string | null;
  groupLimit: number | null;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

/**
 * ADR-094 — knowledge_fetch mode parsing. The default is `"section"`. That
 * default is part of the permanent contract (matches pre-ADR-094 behaviour
 * shape so existing skill calls keep working without explicit `mode`), not a
 * legacy fallback that ever needs to be removed.
 */
function parseKnowledgeFetchMode(value: unknown): PersaiRuntimeKnowledgeFetchMode {
  if (value === undefined || value === null) {
    return "section";
  }
  if (typeof value !== "string") {
    throw new BadRequestException(
      'mode must be one of "short", "section", or "full" when provided.'
    );
  }
  const normalized = value.trim().toLowerCase();
  if ((PERSAI_RUNTIME_KNOWLEDGE_FETCH_MODES as readonly string[]).includes(normalized)) {
    return normalized as PersaiRuntimeKnowledgeFetchMode;
  }
  throw new BadRequestException('mode must be one of "short", "section", or "full" when provided.');
}

/**
 * ADR-094 — optional radius for `mode = "section"`. Rejects 0 and negatives.
 * Positive values are clamped against the plan policy in
 * `resolveDocumentFetchPlan` / `resolveChatFetchPlan`.
 */
function parseKnowledgeFetchRadius(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("radius must be a positive integer when provided.");
  }
  return value;
}

const SHORT_MODE_DOC_RADIUS = 0;
const SHORT_MODE_CHAT_RADIUS = 3;
/** Hard upper bound on radius to keep query fan-out predictable. */
const MAX_DOCUMENT_FETCH_RADIUS = 32;
const MAX_CHAT_FETCH_RADIUS = 200;
const TRUNCATION_MARKER = "\n\n[... content truncated due to plan / admin cap ...]";

type DocumentFetchPlan = {
  radius: number;
  charLimit: number;
  modeUsed: PersaiRuntimeKnowledgeFetchMode;
  isFull: boolean;
};

type ChatFetchPlan = {
  radius: number;
  messageLimit: number;
  charLimit: number;
  modeUsed: PersaiRuntimeKnowledgeFetchMode;
  isFull: boolean;
};

type RetrievalPolicySnapshot = {
  knowledgeFetchWindowRadius: number;
  chatFetchWindowRadius: number;
  chatSectionDefaultRadius: number;
  fetchMaxChars: number;
  fetchFullModeMaxChars: number;
  fetchFullModeMaxChatMessages: number;
};

type AdminSmartLimitsSnapshot = {
  fetchFullModeAbsoluteMaxChars: number;
  fetchFullModeAbsoluteMaxChatMessages: number;
};

function resolveDocumentFetchPlan(
  mode: PersaiRuntimeKnowledgeFetchMode,
  radiusInput: number | null,
  retrievalPolicy: RetrievalPolicySnapshot,
  adminLimits: AdminSmartLimitsSnapshot
): DocumentFetchPlan {
  if (mode === "short") {
    return {
      radius: SHORT_MODE_DOC_RADIUS,
      charLimit: retrievalPolicy.fetchMaxChars,
      modeUsed: "short",
      isFull: false
    };
  }
  if (mode === "full") {
    const charLimit = Math.min(
      retrievalPolicy.fetchFullModeMaxChars,
      adminLimits.fetchFullModeAbsoluteMaxChars
    );
    return {
      radius: MAX_DOCUMENT_FETCH_RADIUS,
      charLimit,
      modeUsed: "full",
      isFull: true
    };
  }
  const requested = radiusInput ?? retrievalPolicy.knowledgeFetchWindowRadius;
  return {
    radius: Math.min(Math.max(requested, 1), MAX_DOCUMENT_FETCH_RADIUS),
    charLimit: retrievalPolicy.fetchMaxChars,
    modeUsed: "section",
    isFull: false
  };
}

function resolveChatFetchPlan(
  mode: PersaiRuntimeKnowledgeFetchMode,
  radiusInput: number | null,
  retrievalPolicy: RetrievalPolicySnapshot,
  adminLimits: AdminSmartLimitsSnapshot
): ChatFetchPlan {
  if (mode === "short") {
    return {
      radius: SHORT_MODE_CHAT_RADIUS,
      messageLimit: SHORT_MODE_CHAT_RADIUS * 2 + 1,
      charLimit: retrievalPolicy.fetchMaxChars,
      modeUsed: "short",
      isFull: false
    };
  }
  if (mode === "full") {
    const messageLimit = Math.min(
      retrievalPolicy.fetchFullModeMaxChatMessages,
      adminLimits.fetchFullModeAbsoluteMaxChatMessages
    );
    const charLimit = Math.min(
      retrievalPolicy.fetchFullModeMaxChars,
      adminLimits.fetchFullModeAbsoluteMaxChars
    );
    return {
      radius: MAX_CHAT_FETCH_RADIUS,
      messageLimit,
      charLimit,
      modeUsed: "full",
      isFull: true
    };
  }
  const requested = radiusInput ?? retrievalPolicy.chatSectionDefaultRadius;
  const radius = Math.min(Math.max(requested, 1), MAX_CHAT_FETCH_RADIUS);
  return {
    radius,
    messageLimit: radius * 2 + 1,
    charLimit: retrievalPolicy.fetchMaxChars,
    modeUsed: "section",
    isFull: false
  };
}

/**
 * Plan-bundled and admin-curated text documents are stored whole (no chunk
 * window). The plan therefore reduces to "how many chars to keep before we
 * mark the doc as truncated".
 */
function resolveTextDocumentFetchPlan(
  mode: PersaiRuntimeKnowledgeFetchMode,
  retrievalPolicy: RetrievalPolicySnapshot,
  adminLimits: AdminSmartLimitsSnapshot
): { charLimit: number; modeUsed: PersaiRuntimeKnowledgeFetchMode } {
  if (mode === "short") {
    return {
      charLimit: Math.min(retrievalPolicy.fetchMaxChars, 1_500),
      modeUsed: "short"
    };
  }
  if (mode === "full") {
    return {
      charLimit: Math.min(
        retrievalPolicy.fetchFullModeMaxChars,
        adminLimits.fetchFullModeAbsoluteMaxChars
      ),
      modeUsed: "full"
    };
  }
  return {
    charLimit: retrievalPolicy.fetchMaxChars,
    modeUsed: "section"
  };
}

function applyTruncationMarker(
  content: string,
  charLimit: number
): { content: string; truncated: boolean } {
  if (content.length <= charLimit) {
    return { content, truncated: false };
  }
  const reserveForMarker = TRUNCATION_MARKER.length;
  const head = content.slice(0, Math.max(0, charLimit - reserveForMarker));
  return {
    content: `${head}${TRUNCATION_MARKER}`,
    truncated: true
  };
}

/**
 * ADR-094 — classify a search response for the durable
 * `KnowledgeRetrievalEvent.modeUsed` / `bytesReturned` columns. Returns the
 * inline branch that actually fired (or `snippet_only` when no inline content
 * was attached) so operators can see which smart-search shape served each
 * search request.
 */
function resolveSmartSearchTelemetry(hits: RuntimeKnowledgeSearchHit[]): {
  modeUsed: string;
  bytesReturned: number;
} {
  if (hits.length === 0) {
    return { modeUsed: "snippet_only", bytesReturned: 0 };
  }
  const hit = hits[0]!;
  if (hit.inlinedDocument !== undefined) {
    return { modeUsed: "smart_inline_full", bytesReturned: hit.inlinedDocument.chars };
  }
  if (hit.inlinedSection !== undefined) {
    const sectionChars = hit.inlinedSection.chars;
    if (hit.documentSummary !== undefined) {
      return {
        modeUsed: "smart_inline_summary",
        bytesReturned: sectionChars + hit.documentSummary.chars
      };
    }
    return { modeUsed: "smart_inline_section", bytesReturned: sectionChars };
  }
  return { modeUsed: "snippet_only", bytesReturned: 0 };
}

function tokenizeWords(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2);
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(tokenizeWords(query))];
}

function buildTokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function hasFuzzyTokenMatch(words: string[], token: string): boolean {
  if (token.length < 4) {
    return false;
  }
  return words.some((word) => word.startsWith(token) || token.startsWith(word));
}

function hasTokenWindow(words: string[], queryTokens: string[], windowSize: number): boolean {
  if (words.length === 0 || queryTokens.length === 0) {
    return false;
  }
  const uniqueTokens = [...new Set(queryTokens)];
  if (uniqueTokens.length === 1) {
    const onlyToken = uniqueTokens[0];
    return onlyToken === undefined ? false : words.includes(onlyToken);
  }

  for (let start = 0; start < words.length; start += 1) {
    const window = words.slice(start, start + windowSize);
    if (uniqueTokens.every((token) => window.includes(token))) {
      return true;
    }
  }
  return false;
}

function buildCharNgramSet(text: string, size: number): Set<string> {
  const normalized = normalizeSearchText(text);
  if (normalized.length === 0) {
    return new Set<string>();
  }
  if (normalized.length <= size) {
    return new Set<string>([normalized]);
  }
  const grams = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.add(normalized.slice(index, index + size));
  }
  return grams;
}

function buildTokenGramSet(tokens: string[], size: number): Set<string> {
  if (tokens.length === 0) {
    return new Set<string>();
  }
  if (tokens.length <= size) {
    return new Set<string>([tokens.join(" ")]);
  }
  const grams = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

function diceCoefficient(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (left.size + right.size);
}

function buildSearchQueryInfo(query: string): SearchQueryInfo {
  const rawQuery = query.trim();
  const normalizedQuery = normalizeSearchText(rawQuery);
  const tokens = tokenizeQuery(rawQuery);
  return {
    rawQuery,
    normalizedQuery,
    tokens,
    searchTerms: tokens.length > 0 ? [rawQuery, ...tokens] : [rawQuery],
    charTrigrams: buildCharNgramSet(rawQuery, 3),
    tokenBigrams: buildTokenGramSet(tokens, 2)
  };
}

function resolveKnowledgeTelemetryErrorCode(error: unknown): string | null {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }
  return null;
}

function resolveMaxResults(
  maxResults: number | null | undefined,
  defaultMaxResults = DEFAULT_KNOWLEDGE_SEARCH_MAX_RESULTS,
  maxMaxResults = MAX_KNOWLEDGE_SEARCH_MAX_RESULTS
): number {
  return Math.min(maxResults ?? defaultMaxResults, maxMaxResults);
}

function scoreFieldMatch(params: {
  text: string | null | undefined;
  query: SearchQueryInfo;
  weight: number;
  lengthNormalize: boolean;
}): { score: number; exactTokenHits: number } {
  const sourceText = params.text?.trim() ?? "";
  if (sourceText.length === 0) {
    return { score: 0, exactTokenHits: 0 };
  }

  const normalized = normalizeSearchText(sourceText);
  const words = tokenizeWords(sourceText);
  const counts = buildTokenCounts(words);
  let score = 0;
  let exactTokenHits = 0;

  if (
    params.query.normalizedQuery.length > 0 &&
    normalized.includes(params.query.normalizedQuery)
  ) {
    score += params.weight * 18;
  }

  if (params.query.tokens.length > 0) {
    let exactMatches = 0;
    let fuzzyMatches = 0;
    for (const token of params.query.tokens) {
      const occurrences = counts.get(token) ?? 0;
      if (occurrences > 0) {
        exactMatches += 1;
        exactTokenHits += 1;
        score += params.weight * 4 * Math.min(3, occurrences);
        continue;
      }
      if (hasFuzzyTokenMatch(words, token)) {
        fuzzyMatches += 1;
        score += params.weight * 1.5;
      }
    }

    if (exactMatches > 0 || fuzzyMatches > 0) {
      const coverage = (exactMatches + fuzzyMatches * 0.6) / params.query.tokens.length;
      score += params.weight * 8 * coverage;
    }
    if (exactMatches === params.query.tokens.length && params.query.tokens.length > 1) {
      score += params.weight * 6;
    }
    if (
      exactMatches > 1 &&
      hasTokenWindow(
        words,
        params.query.tokens,
        Math.min(14, Math.max(6, params.query.tokens.length + 4))
      )
    ) {
      score += params.weight * 5;
    }
  }

  if (params.lengthNormalize) {
    score /= 1 + Math.log1p(Math.max(0, words.length - 12)) / 4;
  }

  return { score, exactTokenHits };
}

function buildRelativeRecencyResolver(params: {
  rows: Array<{ createdAt: Date }>;
  halfLifeDays: number;
  maxBonus: number;
}): (createdAt: Date | null | undefined) => number {
  if (params.rows.length === 0) {
    return () => 0;
  }
  const newestTimestamp = Math.max(...params.rows.map((row) => row.createdAt.getTime()));
  const halfLifeMs = Math.max(1, params.halfLifeDays * 24 * 60 * 60 * 1000);
  return (createdAt) => {
    if (createdAt === null || createdAt === undefined) {
      return 0;
    }
    const ageMs = Math.max(0, newestTimestamp - createdAt.getTime());
    return Math.exp(-ageMs / halfLifeMs) * params.maxBonus;
  };
}

function computeSemanticRerankBonus(params: {
  query: SearchQueryInfo;
  title: string | null | undefined;
  filename: string | null | undefined;
  locator: string | null | undefined;
  content: string;
}): number {
  const titleText = [params.title, params.filename, params.locator]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" ");
  const contentText = normalizeWhitespace(params.content).slice(
    0,
    KNOWLEDGE_SEARCH_SEMANTIC_CONTENT_MAX_CHARS
  );
  const combinedText = [titleText, contentText].filter((value) => value.length > 0).join(" ");
  if (combinedText.length === 0) {
    return 0;
  }

  const combinedWords = tokenizeWords(combinedText);
  const tokenCoverage =
    params.query.tokens.length === 0
      ? 0
      : params.query.tokens.filter((token) => {
          return combinedWords.includes(token) || hasFuzzyTokenMatch(combinedWords, token);
        }).length / params.query.tokens.length;
  const charDice = diceCoefficient(params.query.charTrigrams, buildCharNgramSet(combinedText, 3));
  const titleDice = diceCoefficient(params.query.charTrigrams, buildCharNgramSet(titleText, 3));
  const bigramDice = diceCoefficient(
    params.query.tokenBigrams,
    buildTokenGramSet(combinedWords.slice(0, 120), 2)
  );

  if (tokenCoverage === 0 && titleDice < 0.18 && charDice < 0.16) {
    return 0;
  }

  return tokenCoverage * 10 + titleDice * 16 + charDice * 12 + bigramDice * 10;
}

function rankStructuredCandidate(params: {
  query: SearchQueryInfo;
  title: string | null | undefined;
  filename?: string | null | undefined;
  locator: string | null | undefined;
  content: string;
  metadataText?: string | null | undefined;
  fieldWeights?: Partial<SearchFieldWeights>;
  sourceWeight?: number;
  recencyBonus?: number;
  enableSemanticRerank?: boolean;
}): { lexicalScore: number; score: number; exactTokenHits: number } {
  const weights: SearchFieldWeights = {
    title: 3.4,
    filename: 3.0,
    locator: 2.1,
    content: 1.4,
    metadata: 1.1,
    ...params.fieldWeights
  };

  const titleHit = scoreFieldMatch({
    text: params.title,
    query: params.query,
    weight: weights.title,
    lengthNormalize: false
  });
  const filenameHit = scoreFieldMatch({
    text: params.filename,
    query: params.query,
    weight: weights.filename,
    lengthNormalize: false
  });
  const locatorHit = scoreFieldMatch({
    text: params.locator,
    query: params.query,
    weight: weights.locator,
    lengthNormalize: false
  });
  const contentHit = scoreFieldMatch({
    text: params.content,
    query: params.query,
    weight: weights.content,
    lengthNormalize: true
  });
  const metadataHit = scoreFieldMatch({
    text: params.metadataText,
    query: params.query,
    weight: weights.metadata,
    lengthNormalize: false
  });

  const lexicalScore =
    titleHit.score +
    filenameHit.score +
    locatorHit.score +
    contentHit.score +
    metadataHit.score +
    (params.sourceWeight ?? 0) +
    (params.recencyBonus ?? 0);
  const exactTokenHits =
    titleHit.exactTokenHits +
    filenameHit.exactTokenHits +
    locatorHit.exactTokenHits +
    contentHit.exactTokenHits +
    metadataHit.exactTokenHits;

  if (lexicalScore <= 0) {
    return { lexicalScore, score: lexicalScore, exactTokenHits };
  }

  const semanticBonus =
    params.enableSemanticRerank === true
      ? computeSemanticRerankBonus({
          query: params.query,
          title: params.title,
          filename: params.filename,
          locator: params.locator,
          content: params.content
        })
      : 0;

  return {
    lexicalScore,
    score: lexicalScore + semanticBonus,
    exactTokenHits
  };
}

function trimSnippetWindow(text: string, normalizedTerms: string[]): string {
  const content = normalizeWhitespace(text);
  if (content.length <= KNOWLEDGE_SEARCH_SNIPPET_MAX_CHARS) {
    return content;
  }

  const lowered = content.toLowerCase();
  const matchIndex =
    normalizedTerms
      .map((term) => lowered.indexOf(term))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, matchIndex - 120);
  const end = Math.min(content.length, start + KNOWLEDGE_SEARCH_SNIPPET_MAX_CHARS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function buildSnippet(content: string, terms: string[]): string | null {
  const normalizedContent = normalizeWhitespace(content);
  if (normalizedContent.length === 0) {
    return null;
  }

  const normalizedTerms = [
    ...new Set(terms.map((term) => normalizeSearchText(term)).filter(Boolean))
  ];
  const segments = normalizedContent
    .split(/(?<=[.!?])\s+|\s+---\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const snippetCandidates =
    segments.length === 0
      ? [normalizedContent]
      : segments.flatMap((segment, index) => {
          const pairedSegment =
            index < segments.length - 1 ? `${segment} ${segments[index + 1]}`.trim() : null;
          return pairedSegment === null ? [segment] : [segment, pairedSegment];
        });

  const ranked = snippetCandidates
    .map((candidate, index) => {
      const lowered = candidate.toLowerCase();
      const score = normalizedTerms.reduce((total, term) => {
        if (!lowered.includes(term)) {
          return total;
        }
        return total + (term.includes(" ") ? 6 : 3);
      }, 0);
      return {
        candidate,
        score,
        index
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.candidate.length !== right.candidate.length) {
        return left.candidate.length - right.candidate.length;
      }
      return left.index - right.index;
    });

  return trimSnippetWindow(ranked[0]?.candidate ?? normalizedContent, normalizedTerms);
}

function renderMetadataSearchText(metadata: Record<string, unknown> | null): string | null {
  if (metadata === null) {
    return null;
  }
  const lines = Object.entries(metadata)
    .map(([key, value]) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }
      return `${key}: ${formatJsonValue(value)}`;
    })
    .filter((row): row is string => row !== null);
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Tighter relevance floor for `knowledge_search`. Independent of scoring or
 * ranking order. Drops weak single-token fuzzy/trigram-only matches from
 * `knowledge_search` results while preserving honest recall:
 *
 * - `score <= 0` always rejected.
 * - any candidate with at least one whole-token exact hit always passes.
 * - single-token query: fuzzy-only candidates are rejected (single-token
 *   queries have no co-occurrence safety net for typo guesses).
 * - multi-token query: fuzzy-only candidates pass only when their score is
 *   at least 50% of the top scoring candidate, so a clear top-of-list
 *   exact hit pulls a weak fuzzy tail along with it but a flat tail of
 *   weak fuzzy noise is dropped.
 *
 * Exported as a pure helper so focused regressions can verify the floor
 * shape without the full prisma harness.
 */
export function passesRelevanceFloor(
  candidate: { score: number; exactTokenHits: number },
  context: { topScore: number; queryTokenCount: number }
): boolean {
  if (candidate.score <= 0) {
    return false;
  }
  if (candidate.exactTokenHits >= 1) {
    return true;
  }
  if (context.queryTokenCount <= 1) {
    return false;
  }
  return context.topScore > 0 && candidate.score >= context.topScore * 0.5;
}

function computeTopScore(rows: ReadonlyArray<{ score: number }>): number {
  let topScore = 0;
  for (const row of rows) {
    if (row.score > topScore) {
      topScore = row.score;
    }
  }
  return topScore;
}

function selectRankedCandidates<Row>(
  candidates: RankedSearchCandidate<Row>[],
  maxResults: number
): RankedSearchCandidate<Row>[] {
  const selected: RankedSearchCandidate<Row>[] = [];
  const seenDedupeKeys = new Set<string>();
  const groupCounts = new Map<string, number>();

  for (const candidate of candidates) {
    if (seenDedupeKeys.has(candidate.dedupeKey)) {
      continue;
    }
    if (
      candidate.groupKey !== null &&
      candidate.groupLimit !== null &&
      (groupCounts.get(candidate.groupKey) ?? 0) >= candidate.groupLimit
    ) {
      continue;
    }

    seenDedupeKeys.add(candidate.dedupeKey);
    if (candidate.groupKey !== null && candidate.groupLimit !== null) {
      groupCounts.set(candidate.groupKey, (groupCounts.get(candidate.groupKey) ?? 0) + 1);
    }
    selected.push(candidate);
    if (selected.length >= maxResults) {
      break;
    }
  }

  return selected;
}

function resolveTextKnowledgeSourceWeight(row: TextKnowledgeDocumentRow): number {
  if (row.source === "subscription") {
    return 10;
  }
  if (row.referenceId.startsWith("global:plan:")) {
    return 8;
  }
  return 6;
}

function searchTextKnowledgeDocuments(params: {
  documents: TextKnowledgeDocumentRow[];
  query: string;
  maxResults: number | null;
  defaultMaxResults?: number;
  maxMaxResults?: number;
}): RuntimeKnowledgeSearchHit[] {
  const normalizedQuery = params.query.trim();
  if (normalizedQuery.length === 0) {
    throw new BadRequestException("query is required.");
  }

  const queryInfo = buildSearchQueryInfo(normalizedQuery);
  const scored = params.documents.map((row) => {
    const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
      query: queryInfo,
      title: row.title,
      locator: row.locator,
      content: row.content,
      metadataText: renderMetadataSearchText(row.metadata),
      sourceWeight: resolveTextKnowledgeSourceWeight(row)
    });
    return {
      row,
      score,
      lexicalScore,
      exactTokenHits,
      dedupeKey: row.referenceId,
      groupKey: null,
      groupLimit: null
    } satisfies RankedSearchCandidate<TextKnowledgeDocumentRow>;
  });
  const topScore = computeTopScore(scored);
  const ranked = scored
    .filter((candidate) =>
      passesRelevanceFloor(candidate, {
        topScore,
        queryTokenCount: queryInfo.tokens.length
      })
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }
      return left.row.referenceId.localeCompare(right.row.referenceId);
    });

  const selected = selectRankedCandidates(
    ranked,
    resolveMaxResults(params.maxResults, params.defaultMaxResults, params.maxMaxResults)
  );
  return selected.map(({ row, score }) => ({
    referenceId: row.referenceId,
    source: row.source,
    title: row.title,
    locator: row.locator,
    snippet: buildSnippet(row.content, queryInfo.searchTerms),
    score,
    metadata: row.metadata
  }));
}

function buildDocumentReferenceId(params: {
  knowledgeSourceId: string;
  sourceVersion: number;
  chunkIndex: number;
}): string {
  return `${params.knowledgeSourceId}:${String(params.sourceVersion)}:${String(params.chunkIndex)}`;
}

function parseDocumentReferenceId(
  referenceId: string
): { knowledgeSourceId: string; sourceVersion: number; chunkIndex: number } | null {
  const [knowledgeSourceId, rawSourceVersion, rawChunkIndex] = referenceId.split(":");
  if (!knowledgeSourceId || !rawSourceVersion || !rawChunkIndex) {
    return null;
  }

  const sourceVersion = Number(rawSourceVersion);
  const chunkIndex = Number(rawChunkIndex);
  if (
    !Number.isInteger(sourceVersion) ||
    sourceVersion < 1 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0
  ) {
    return null;
  }

  return { knowledgeSourceId, sourceVersion, chunkIndex };
}

// ADR-120 Slice 5 — Skill KB reference ids. Shape is
// `skill:<skillId>:<skill_document|skill_knowledge_card>:<sourceId>:<sourceVersion>:<chunkIndex>`.
// This is the same on-wire shape the retired orchestrator used, so any
// reference id previously emitted stays parseable.
function buildSkillReferenceId(params: {
  skillId: string;
  sourceKind: "skill_document" | "skill_knowledge_card";
  sourceId: string;
  sourceVersion: number;
  chunkIndex: number;
}): string {
  return `skill:${params.skillId}:${params.sourceKind}:${params.sourceId}:${String(params.sourceVersion)}:${String(params.chunkIndex)}`;
}

function parseSkillReferenceId(referenceId: string): {
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
    !parts[1] ||
    !parts[3] ||
    !Number.isInteger(sourceVersion) ||
    sourceVersion < 1 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0
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

function localizeSkillName(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "Skill";
  }
  const row = value as Record<string, unknown>;
  const english = typeof row.en === "string" ? row.en.trim() : "";
  if (english.length > 0) {
    return english;
  }
  const first = Object.values(row).find(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  return first?.trim() ?? "Skill";
}

function buildGlobalUploadedReferenceId(params: {
  globalKnowledgeSourceId: string;
  sourceVersion: number;
  chunkIndex: number;
}): string {
  return `global-uploaded:${params.globalKnowledgeSourceId}:${String(params.sourceVersion)}:${String(params.chunkIndex)}`;
}

function parseGlobalUploadedReferenceId(
  referenceId: string
): { globalKnowledgeSourceId: string; sourceVersion: number; chunkIndex: number } | null {
  if (!referenceId.startsWith("global-uploaded:")) {
    return null;
  }
  const [globalKnowledgeSourceId, rawSourceVersion, rawChunkIndex] = referenceId
    .slice("global-uploaded:".length)
    .split(":");
  if (!globalKnowledgeSourceId || !rawSourceVersion || !rawChunkIndex) {
    return null;
  }
  const sourceVersion = Number(rawSourceVersion);
  const chunkIndex = Number(rawChunkIndex);
  if (
    !Number.isInteger(sourceVersion) ||
    sourceVersion < 1 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0
  ) {
    return null;
  }
  return { globalKnowledgeSourceId, sourceVersion, chunkIndex };
}

function buildProductTextEntryReferenceId(params: {
  textEntryId: string;
  sourceVersion: number;
  chunkIndex: number;
}): string {
  return `product-text-entry:${params.textEntryId}:${String(params.sourceVersion)}:${String(params.chunkIndex)}`;
}

function parseProductTextEntryReferenceId(
  referenceId: string
): { textEntryId: string; sourceVersion: number; chunkIndex: number } | null {
  if (!referenceId.startsWith("product-text-entry:")) {
    return null;
  }
  const [textEntryId, rawSourceVersion, rawChunkIndex] = referenceId
    .slice("product-text-entry:".length)
    .split(":");
  if (!textEntryId || !rawSourceVersion || !rawChunkIndex) {
    return null;
  }
  const sourceVersion = Number(rawSourceVersion);
  const chunkIndex = Number(rawChunkIndex);
  if (
    !Number.isInteger(sourceVersion) ||
    sourceVersion < 1 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0
  ) {
    return null;
  }
  return { textEntryId, sourceVersion, chunkIndex };
}

function buildMemoryReferenceId(memoryItemId: string): string {
  return `memory:${memoryItemId}`;
}

function parseMemoryReferenceId(referenceId: string): { memoryItemId: string } | null {
  if (!referenceId.startsWith("memory:")) {
    return null;
  }
  const memoryItemId = referenceId.slice("memory:".length).trim();
  return memoryItemId.length > 0 ? { memoryItemId } : null;
}

function resolveMemoryTitle(row: Pick<MemoryRegistryRow, "sourceType" | "sourceLabel">): string {
  if (row.sourceLabel !== null && row.sourceLabel.trim().length > 0) {
    return row.sourceLabel;
  }
  return row.sourceType === "memory_write" ? "Durable memory" : "Web chat memory";
}

function resolveMemoryLocator(row: Pick<MemoryRegistryRow, "chatId">): string | null {
  return row.chatId !== null ? `chat:${row.chatId}` : null;
}

function buildChatReferenceId(params: { chatId: string; messageId: string }): string {
  return `chat:${params.chatId}:message:${params.messageId}`;
}

function parseChatReferenceId(referenceId: string): { chatId: string; messageId: string } | null {
  if (!referenceId.startsWith("chat:")) {
    return null;
  }
  const value = referenceId.slice("chat:".length);
  const separator = ":message:";
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex <= 0) {
    return null;
  }

  const chatId = value.slice(0, separatorIndex).trim();
  const messageId = value.slice(separatorIndex + separator.length).trim();
  if (chatId.length === 0 || messageId.length === 0) {
    return null;
  }

  return { chatId, messageId };
}

function resolveChatTitle(row: Pick<ChatThreadRow, "surface" | "title">): string {
  const title = row.title?.trim();
  if (title && title.length > 0) {
    return title;
  }
  return row.surface === "telegram" ? "Telegram chat" : "Web chat";
}

function resolveChatLocator(row: Pick<ChatMessageRow, "chatId" | "id">): string {
  return `chat:${row.chatId}#message:${row.id}`;
}

function resolveChatAuthorLabel(author: ChatMessageRow["author"]): string {
  return author === "assistant" ? "Assistant" : author === "user" ? "User" : "System";
}

function buildChatWindowContent(
  rows: Array<Pick<ChatMessageRow, "author" | "content" | "createdAt">>,
  maxChars = KNOWLEDGE_FETCH_MAX_CHARS
): string {
  return rows
    .map((row) => {
      const content = row.content.trim();
      return content.length > 0
        ? `[${row.createdAt.toISOString()}] ${resolveChatAuthorLabel(row.author)}: ${content}`
        : null;
    })
    .filter((row): row is string => row !== null)
    .join("\n\n")
    .slice(0, maxChars);
}

function isSupportedKnowledgeSource(
  source: string
): source is (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number] {
  return SUPPORTED_KNOWLEDGE_SOURCES.includes(
    source as (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number]
  );
}

function toTextKnowledgeDocument(
  row: TextKnowledgeDocumentRow,
  maxChars = KNOWLEDGE_FETCH_MAX_CHARS,
  modeUsed: PersaiRuntimeKnowledgeFetchMode = "section"
): RuntimeKnowledgeDocument {
  const { content, truncated } = applyTruncationMarker(row.content, maxChars);
  const baseMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    modeUsed,
    truncated
  };
  return {
    referenceId: row.referenceId,
    source: row.source,
    title: row.title,
    locator: row.locator,
    content,
    snippet: buildSnippet(row.content, [row.title, row.locator ?? "", row.content.slice(0, 80)]),
    modeUsed,
    truncated,
    metadata: baseMetadata
  };
}

function formatJsonValue(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function formatPlanToolActivations(
  activations: PlanCatalogKnowledgeRow["toolActivations"]
): string {
  if (activations.length === 0) {
    return "- none";
  }
  return activations
    .map((activation) => {
      const limit =
        activation.dailyCallLimit === null
          ? "no daily limit"
          : `${String(activation.dailyCallLimit)}/day`;
      return `- ${activation.tool.displayName} (${activation.tool.code}): ${activation.activationStatus}, ${limit}`;
    })
    .join("\n");
}

@Injectable()
export class ReadAssistantKnowledgeService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService,
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    private readonly knowledgeRetrievalHelperService: KnowledgeRetrievalHelperService,
    private readonly knowledgeRetrievalObservabilityService: KnowledgeRetrievalObservabilityService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    @Inject(KNOWLEDGE_VECTOR_INDEX)
    private readonly knowledgeVectorIndex: KnowledgeVectorIndex
  ) {}

  parseSearchInput(body: unknown): {
    assistantId: string;
    source: (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number];
    query: string;
    maxResults: number | null;
  } {
    const row = this.asObject(body);
    const assistantId = this.readRequiredString(row.assistantId, "assistantId");
    const source = this.readRequiredString(row.source, "source");
    const query = this.readRequiredString(row.query, "query");
    if (!isSupportedKnowledgeSource(source)) {
      throw new BadRequestException(
        "Only document, memory, chat, subscription, Product KB, and skill knowledge search are currently available."
      );
    }

    const maxResults =
      row.maxResults === undefined || row.maxResults === null
        ? null
        : Number.isInteger(row.maxResults) && Number(row.maxResults) > 0
          ? Number(row.maxResults)
          : null;
    if ("maxResults" in row && row.maxResults !== null && maxResults === null) {
      throw new BadRequestException("maxResults must be a positive integer when provided.");
    }

    return {
      assistantId,
      source,
      query: query.trim(),
      maxResults
    };
  }

  parseFetchInput(body: unknown): {
    assistantId: string;
    source: (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number];
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  } {
    const row = this.asObject(body);
    const assistantId = this.readRequiredString(row.assistantId, "assistantId");
    const source = this.readRequiredString(row.source, "source");
    const referenceId = this.readRequiredString(row.referenceId, "referenceId");
    if (!isSupportedKnowledgeSource(source)) {
      throw new BadRequestException(
        "Only document, memory, chat, subscription, Product KB, and skill knowledge fetch are currently available."
      );
    }
    const mode = parseKnowledgeFetchMode(row.mode);
    const radius = parseKnowledgeFetchRadius(row.radius);

    return {
      assistantId,
      source,
      referenceId,
      mode,
      radius
    };
  }

  async search(input: {
    assistantId: string;
    source: (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number];
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    if (input.source === "document") {
      return this.searchDocuments(input);
    }
    if (input.source === "memory") {
      return this.searchMemory(input);
    }
    if (input.source === "chat") {
      return this.searchChats(input);
    }
    if (input.source === "subscription") {
      return this.searchSubscription(input);
    }
    if (input.source === "skill") {
      return this.searchSkill(input);
    }
    return this.searchGlobal(input);
  }

  async fetch(input: {
    assistantId: string;
    source: (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number];
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    if (input.source === "document") {
      return this.fetchDocument(input);
    }
    if (input.source === "memory") {
      return this.fetchMemory(input);
    }
    if (input.source === "chat") {
      return this.fetchChat(input);
    }
    if (input.source === "subscription") {
      return this.fetchSubscription(input);
    }
    if (input.source === "skill") {
      return this.fetchSkill(input);
    }
    return this.fetchGlobal(input);
  }

  /**
   * ADR-094 — single read of (per-plan retrieval policy, admin smart-limit
   * ceilings) used by every sub-fetch method to compute the effective fetch
   * plan. Both reads are independent so we run them in parallel.
   */
  private async resolveFetchEnvelope(assistantId: string): Promise<{
    retrievalPolicy: Awaited<
      ReturnType<KnowledgeModelPolicyService["resolveAssistantRetrievalPolicy"]>
    >;
    adminLimits: AdminSmartLimitsSnapshot;
    adminPolicy: AdminKnowledgeRetrievalPolicyState;
  }> {
    const [retrievalPolicy, adminPolicy] = await Promise.all([
      this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(assistantId),
      this.knowledgeModelPolicyService.resolveAdminKnowledgeRetrievalPolicy()
    ]);
    return {
      retrievalPolicy,
      adminLimits: {
        fetchFullModeAbsoluteMaxChars: adminPolicy.fetchFullModeAbsoluteMaxChars,
        fetchFullModeAbsoluteMaxChatMessages: adminPolicy.fetchFullModeAbsoluteMaxChatMessages
      },
      adminPolicy
    };
  }

  private async enrichKnowledgeHitsWithSmartInline(args: {
    assistantId: string;
    hits: RuntimeKnowledgeSearchHit[];
    loadSectionsForHit: (hit: RuntimeKnowledgeSearchHit) => Promise<{
      centerChunkIndex: number;
      rows: SmartInlineSectionRow[];
    } | null>;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    if (args.hits.length === 0) {
      return args.hits;
    }
    const targetHit = args.hits[0];
    if (targetHit === undefined) {
      return args.hits;
    }
    const { retrievalPolicy, adminPolicy } = await this.resolveFetchEnvelope(args.assistantId);
    if (!adminPolicy.smartSearchEnabled) {
      return args.hits;
    }
    const loaded = await args.loadSectionsForHit(targetHit);
    if (loaded === null || loaded.rows.length === 0) {
      return args.hits;
    }
    const enriched = await this.enrichWithSmartInline({
      hit: targetHit,
      documentChunks: loaded.rows,
      centerChunkIndex: loaded.centerChunkIndex,
      retrievalPolicy,
      adminPolicy
    });
    return [enriched, ...args.hits.slice(1)];
  }

  /**
   * ADR-094 — for a single-hit document search, decide whether to inline the
   * whole document, an extended section, or a section plus a heading summary.
   * The decision is purely based on the target document's total length and
   * the per-plan / admin smart-search bands. Returns the original hit unchanged
   * if the smart branch is disabled or the document context cannot be loaded.
   */
  private async enrichWithSmartInline(args: {
    hit: RuntimeKnowledgeSearchHit;
    documentChunks: SmartInlineSectionRow[];
    centerChunkIndex: number;
    retrievalPolicy: Awaited<
      ReturnType<KnowledgeModelPolicyService["resolveAssistantRetrievalPolicy"]>
    >;
    adminPolicy: AdminKnowledgeRetrievalPolicyState;
  }): Promise<RuntimeKnowledgeSearchHit> {
    const { hit, documentChunks, centerChunkIndex, retrievalPolicy, adminPolicy } = args;
    if (!adminPolicy.smartSearchEnabled || documentChunks.length === 0) {
      return hit;
    }

    const ordered = [...documentChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const fullText = ordered
      .map((row) => row.content.trim())
      .filter((row) => row.length > 0)
      .join("\n\n---\n\n");
    const totalChars = fullText.length;
    if (totalChars === 0) {
      return hit;
    }

    if (totalChars <= retrievalPolicy.smartSearchShortDocChars) {
      const fullCap = Math.min(
        retrievalPolicy.fetchFullModeMaxChars,
        adminPolicy.fetchFullModeAbsoluteMaxChars
      );
      const { content: inlinedText, truncated } = applyTruncationMarker(fullText, fullCap);
      const inlinedDocument: RuntimeKnowledgeInlinedDocument = {
        text: inlinedText,
        chars: inlinedText.length,
        truncated
      };
      return { ...hit, inlinedDocument };
    }

    const sectionRadius =
      totalChars <= retrievalPolicy.smartSearchMediumDocChars
        ? Math.min(
            Math.max(retrievalPolicy.knowledgeFetchWindowRadius * 2, 2),
            MAX_DOCUMENT_FETCH_RADIUS
          )
        : Math.min(retrievalPolicy.knowledgeFetchWindowRadius, MAX_DOCUMENT_FETCH_RADIUS);
    const sectionStart = Math.max(0, centerChunkIndex - sectionRadius);
    const sectionEnd = centerChunkIndex + sectionRadius;
    const sectionRows = ordered.filter(
      (row) => row.chunkIndex >= sectionStart && row.chunkIndex <= sectionEnd
    );
    const sectionTextRaw = sectionRows
      .map((row) => row.content.trim())
      .filter((row) => row.length > 0)
      .join("\n\n---\n\n");
    const { content: sectionText, truncated: sectionTruncated } = applyTruncationMarker(
      sectionTextRaw,
      retrievalPolicy.fetchMaxChars
    );
    const inlinedSection: RuntimeKnowledgeInlinedSection = {
      text: sectionText,
      chars: sectionText.length,
      radius: sectionRadius,
      truncated: sectionTruncated
    };

    if (totalChars <= retrievalPolicy.smartSearchMediumDocChars) {
      return { ...hit, inlinedSection };
    }

    const summaryLines: string[] = [];
    for (const row of ordered) {
      if (row.chunkIndex >= sectionStart && row.chunkIndex <= sectionEnd) {
        continue;
      }
      const firstLine = row.content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (firstLine === undefined) {
        continue;
      }
      const locatorPrefix =
        row.locator !== null && row.locator.length > 0 ? `${row.locator}: ` : "";
      summaryLines.push(`${locatorPrefix}${firstLine}`);
    }
    const summaryRaw = summaryLines.join("\n");
    const { content: summaryText } = applyTruncationMarker(
      summaryRaw,
      adminPolicy.smartSearchLongDocSummaryChars
    );
    const documentSummary: RuntimeKnowledgeDocumentSummary | undefined =
      summaryText.length > 0 ? { text: summaryText, chars: summaryText.length } : undefined;
    return documentSummary === undefined
      ? { ...hit, inlinedSection }
      : { ...hit, inlinedSection, documentSummary };
  }

  private async loadAssistantDocumentSectionsForHit(
    assistantId: string,
    hit: RuntimeKnowledgeSearchHit
  ): Promise<{ centerChunkIndex: number; rows: SmartInlineSectionRow[] } | null> {
    const reference = parseDocumentReferenceId(hit.referenceId);
    if (reference === null) {
      return null;
    }
    const rows = await this.prisma.assistantKnowledgeSourceChunk.findMany({
      where: {
        assistantId,
        knowledgeSourceId: reference.knowledgeSourceId,
        sourceVersion: reference.sourceVersion,
        knowledgeSource: {
          assistantId,
          namespace: "assistant_user_workspace",
          status: "ready"
        }
      },
      select: { chunkIndex: true, content: true, locator: true },
      orderBy: [{ chunkIndex: "asc" }]
    });
    return {
      centerChunkIndex: reference.chunkIndex,
      rows
    };
  }

  private async loadGlobalSectionsForHit(
    assistantId: string,
    hit: RuntimeKnowledgeSearchHit
  ): Promise<{ centerChunkIndex: number; rows: SmartInlineSectionRow[] } | null> {
    const productReference = parseProductTextEntryReferenceId(hit.referenceId);
    if (productReference !== null) {
      const rows = await this.prisma.productKnowledgeTextEntryChunk.findMany({
        where: {
          textEntryId: productReference.textEntryId,
          sourceVersion: productReference.sourceVersion,
          textEntry: {
            status: "ready",
            lifecycleStatus: "active"
          }
        },
        select: { chunkIndex: true, content: true, locator: true },
        orderBy: [{ chunkIndex: "asc" }]
      });
      return {
        centerChunkIndex: productReference.chunkIndex,
        rows
      };
    }

    const uploadedReference = parseGlobalUploadedReferenceId(hit.referenceId);
    if (uploadedReference !== null) {
      const rows = await this.prisma.globalKnowledgeSourceChunk.findMany({
        where: {
          globalKnowledgeSourceId: uploadedReference.globalKnowledgeSourceId,
          sourceVersion: uploadedReference.sourceVersion,
          globalKnowledgeSource: {
            status: "ready"
          }
        },
        select: { chunkIndex: true, content: true, locator: true },
        orderBy: [{ chunkIndex: "asc" }]
      });
      return {
        centerChunkIndex: uploadedReference.chunkIndex,
        rows
      };
    }

    const textDocument = (await this.loadGlobalKnowledgeDocuments(assistantId)).find(
      (row) => row.referenceId === hit.referenceId
    );
    if (textDocument === undefined) {
      return null;
    }
    return {
      centerChunkIndex: 0,
      rows: [
        {
          chunkIndex: 0,
          locator: textDocument.locator,
          content: textDocument.content
        }
      ]
    };
  }

  private async loadSubscriptionSectionsForHit(
    assistantId: string,
    hit: RuntimeKnowledgeSearchHit
  ): Promise<{ centerChunkIndex: number; rows: SmartInlineSectionRow[] } | null> {
    const textDocument = (await this.loadSubscriptionKnowledgeDocuments(assistantId)).find(
      (row) => row.referenceId === hit.referenceId
    );
    if (textDocument === undefined) {
      return null;
    }
    return {
      centerChunkIndex: 0,
      rows: [
        {
          chunkIndex: 0,
          locator: textDocument.locator,
          content: textDocument.content
        }
      ]
    };
  }

  async searchDocuments(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }

    let lexicalCandidateCount = 0;
    let vectorCandidateCount = 0;
    let helperApplied = false;
    let embeddingModelKey: string | null = null;
    let retrievalMode: "lexical" | "hybrid" = "lexical";
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );

    try {
      const queryInfo = buildSearchQueryInfo(normalizedQuery);
      const [rows, resolvedEmbeddingModelKey] = await Promise.all([
        this.prisma.assistantKnowledgeSourceChunk.findMany({
          where: {
            assistantId: input.assistantId,
            knowledgeSource: {
              assistantId: input.assistantId,
              namespace: "assistant_user_workspace",
              status: "ready"
            },
            OR: queryInfo.searchTerms.flatMap((term) => [
              {
                content: {
                  contains: term,
                  mode: "insensitive"
                }
              },
              {
                locator: {
                  contains: term,
                  mode: "insensitive"
                }
              }
            ])
          },
          include: {
            knowledgeSource: {
              select: {
                id: true,
                namespace: true,
                displayName: true,
                originalFilename: true,
                mimeType: true
              }
            }
          },
          orderBy: [{ knowledgeSourceId: "asc" }, { sourceVersion: "desc" }, { chunkIndex: "asc" }],
          take: retrievalPolicy.lexicalCandidateLimit
        }) as Promise<SearchSourceRow[]>,
        this.knowledgeModelPolicyService.resolveAssistantEmbeddingModelKey(input.assistantId)
      ]);
      embeddingModelKey = resolvedEmbeddingModelKey;
      lexicalCandidateCount = rows.length;

      const rankedByReferenceId = new Map<string, RankedSearchCandidate<SearchSourceRow>>();
      const upsertRankedCandidate = (
        referenceId: string,
        candidate: RankedSearchCandidate<SearchSourceRow>
      ) => {
        const existing = rankedByReferenceId.get(referenceId);
        if (
          existing === undefined ||
          candidate.score > existing.score ||
          (candidate.score === existing.score && candidate.lexicalScore > existing.lexicalScore)
        ) {
          rankedByReferenceId.set(referenceId, candidate);
        }
      };

      for (const row of rows) {
        const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
          query: queryInfo,
          title: row.knowledgeSource.displayName,
          filename: row.knowledgeSource.originalFilename,
          locator: row.locator,
          content: row.content,
          fieldWeights: {
            title: 3.6,
            filename: 3.2,
            locator: 2.2,
            content: 1.35,
            metadata: 0
          },
          sourceWeight: row.knowledgeSource.displayName === null ? 1 : 3,
          enableSemanticRerank: true
        });
        if (score <= 0) {
          continue;
        }
        const referenceId = buildDocumentReferenceId({
          knowledgeSourceId: row.knowledgeSourceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex
        });
        upsertRankedCandidate(referenceId, {
          row,
          score,
          lexicalScore,
          exactTokenHits,
          dedupeKey: [
            row.knowledgeSourceId,
            normalizeSearchText(row.locator ?? ""),
            normalizeSearchText(row.content).slice(0, 180)
          ].join(":"),
          groupKey: row.knowledgeSourceId,
          groupLimit: 2
        });
      }

      let queryEmbedding: number[] | null = null;
      if (retrievalPolicy.embeddingSearchEnabled && embeddingModelKey !== null) {
        try {
          queryEmbedding = ((
            await this.knowledgeEmbeddingService.generateEmbeddings({
              modelKey: embeddingModelKey,
              texts: [normalizedQuery]
            })
          ).embeddings[0] ?? null) as number[] | null;
        } catch {
          queryEmbedding = null;
        }
      }
      retrievalMode = queryEmbedding === null ? "lexical" : "hybrid";
      if (queryEmbedding !== null && embeddingModelKey !== null) {
        // ADR-120 Slice 3 — candidate selection is now a true pgvector ANN
        // nearest-neighbour query over the unified `KnowledgeVectorChunk` store
        // (the path skills already use) instead of loading the first
        // `vectorCandidateLimit` chunk rows by table order and computing cosine
        // in process. The similarity number, the 0.18 gate, and the combined
        // score formula below are unchanged in shape — only the source of the
        // candidate set and of `vectorSimilarity` changed.
        const vectorHits = await this.knowledgeVectorIndex.searchNearest({
          workspaceId: null,
          embeddingModelKey,
          queryVector: queryEmbedding,
          limit: retrievalPolicy.vectorCandidateLimit,
          sourceTypes: ["assistant_knowledge_source"],
          assistantId: input.assistantId
        });
        vectorCandidateCount = vectorHits.length;
        const vectorSimilarityByReferenceId = new Map<string, number>();
        for (const hit of vectorHits) {
          if (hit.score <= 0.18) {
            continue;
          }
          const referenceId = buildDocumentReferenceId({
            knowledgeSourceId: hit.sourceId,
            sourceVersion: hit.sourceVersion,
            chunkIndex: hit.chunkIndex
          });
          vectorSimilarityByReferenceId.set(
            referenceId,
            Math.max(vectorSimilarityByReferenceId.get(referenceId) ?? 0, hit.score)
          );
        }
        if (vectorSimilarityByReferenceId.size > 0) {
          const vectorRows = (await this.prisma.assistantKnowledgeSourceChunk.findMany({
            where: {
              assistantId: input.assistantId,
              knowledgeSource: {
                assistantId: input.assistantId,
                namespace: "assistant_user_workspace",
                status: "ready"
              },
              OR: vectorHits
                .filter((hit) => hit.score > 0.18)
                .map((hit) => ({
                  knowledgeSourceId: hit.sourceId,
                  sourceVersion: hit.sourceVersion,
                  chunkIndex: hit.chunkIndex
                }))
            },
            include: {
              knowledgeSource: {
                select: {
                  id: true,
                  namespace: true,
                  displayName: true,
                  originalFilename: true,
                  mimeType: true
                }
              }
            }
          })) as SearchSourceRow[];

          for (const row of vectorRows) {
            const referenceId = buildDocumentReferenceId({
              knowledgeSourceId: row.knowledgeSourceId,
              sourceVersion: row.sourceVersion,
              chunkIndex: row.chunkIndex
            });
            const vectorSimilarity = vectorSimilarityByReferenceId.get(referenceId);
            if (vectorSimilarity === undefined) {
              continue;
            }
            const { lexicalScore, exactTokenHits } = rankStructuredCandidate({
              query: queryInfo,
              title: row.knowledgeSource.displayName,
              filename: row.knowledgeSource.originalFilename,
              locator: row.locator,
              content: row.content,
              fieldWeights: {
                title: 2.4,
                filename: 2.1,
                locator: 1.6,
                content: 1.0,
                metadata: 0
              },
              sourceWeight: row.knowledgeSource.displayName === null ? 0.5 : 1.5,
              enableSemanticRerank: false
            });
            upsertRankedCandidate(referenceId, {
              row,
              score: vectorSimilarity * 42 + lexicalScore * 0.35,
              lexicalScore: lexicalScore + vectorSimilarity * 10,
              exactTokenHits,
              dedupeKey: [
                row.knowledgeSourceId,
                normalizeSearchText(row.locator ?? ""),
                normalizeSearchText(row.content).slice(0, 180)
              ].join(":"),
              groupKey: row.knowledgeSourceId,
              groupLimit: 2
            });
          }
        }
      }

      // ADR-120 Slice 4 — apply the same relevance floor used by the
      // memory/chat/text-entry paths to documents. Weak fuzzy-only hits with no
      // exact-token support and a sub-half-top score are dropped; an empty
      // result set is a valid outcome and is never backfilled.
      const documentCandidates = Array.from(rankedByReferenceId.values());
      const documentTopScore = computeTopScore(documentCandidates);
      const ranked = documentCandidates
        .filter((candidate) =>
          passesRelevanceFloor(candidate, {
            topScore: documentTopScore,
            queryTokenCount: queryInfo.tokens.length
          })
        )
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (right.lexicalScore !== left.lexicalScore) {
            return right.lexicalScore - left.lexicalScore;
          }
          if (left.row.knowledgeSourceId !== right.row.knowledgeSourceId) {
            return left.row.knowledgeSourceId.localeCompare(right.row.knowledgeSourceId);
          }
          return left.row.chunkIndex - right.row.chunkIndex;
        });

      let selected = selectRankedCandidates(
        ranked,
        resolveMaxResults(
          input.maxResults,
          retrievalPolicy.defaultMaxResults,
          retrievalPolicy.maxMaxResults
        )
      );
      // ADR-120 Slice 4 — `selected` is already floored and score-ordered above.
      // Rerank can only narrow/reorder it: when the helper is unavailable
      // (disabled, <2 candidates, or a runtime failure) `rerankCandidates`
      // returns null and we keep the floored, score-ordered set as-is. We never
      // fall back to a wider or unfiltered candidate pool on unavailability.
      const helperRanking = await this.knowledgeRetrievalHelperService.rerankCandidates({
        assistantId: input.assistantId,
        query: normalizedQuery,
        candidates: selected.map(({ row }) => ({
          referenceId: buildDocumentReferenceId({
            knowledgeSourceId: row.knowledgeSourceId,
            sourceVersion: row.sourceVersion,
            chunkIndex: row.chunkIndex
          }),
          title: row.knowledgeSource.displayName ?? row.knowledgeSource.originalFilename,
          locator: row.locator,
          snippet: buildSnippet(row.content, queryInfo.searchTerms)
        }))
      });
      helperApplied = helperRanking !== null;
      if (helperRanking !== null) {
        const allowedReferenceIds = new Set(helperRanking.rankedReferenceIds);
        const helperRankIndex = new Map(
          helperRanking.rankedReferenceIds.map((referenceId, index) => [referenceId, index])
        );
        selected = selected
          .filter(({ row }) =>
            allowedReferenceIds.has(
              buildDocumentReferenceId({
                knowledgeSourceId: row.knowledgeSourceId,
                sourceVersion: row.sourceVersion,
                chunkIndex: row.chunkIndex
              })
            )
          )
          .sort((left, right) => {
            const leftReferenceId = buildDocumentReferenceId({
              knowledgeSourceId: left.row.knowledgeSourceId,
              sourceVersion: left.row.sourceVersion,
              chunkIndex: left.row.chunkIndex
            });
            const rightReferenceId = buildDocumentReferenceId({
              knowledgeSourceId: right.row.knowledgeSourceId,
              sourceVersion: right.row.sourceVersion,
              chunkIndex: right.row.chunkIndex
            });
            const leftRank = helperRankIndex.get(leftReferenceId);
            const rightRank = helperRankIndex.get(rightReferenceId);
            if (leftRank === undefined && rightRank === undefined) {
              return right.score - left.score;
            }
            if (leftRank === undefined) {
              return 1;
            }
            if (rightRank === undefined) {
              return -1;
            }
            return leftRank - rightRank;
          });
      }

      const baseHits: RuntimeKnowledgeSearchHit[] = selected.map(({ row, score }) => ({
        referenceId: buildDocumentReferenceId({
          knowledgeSourceId: row.knowledgeSourceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex
        }),
        source: "document",
        title: row.knowledgeSource.displayName ?? row.knowledgeSource.originalFilename,
        locator: row.locator,
        snippet: buildSnippet(row.content, queryInfo.searchTerms),
        score,
        metadata: {
          knowledgeSourceId: row.knowledgeSource.id,
          namespace: row.knowledgeSource.namespace,
          mimeType: row.knowledgeSource.mimeType,
          originalFilename: row.knowledgeSource.originalFilename,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          retrievalMode
        }
      }));
      const hits = await this.enrichKnowledgeHitsWithSmartInline({
        assistantId: input.assistantId,
        hits: baseHits,
        loadSectionsForHit: async (hit) =>
          this.loadAssistantDocumentSectionsForHit(input.assistantId, hit)
      });
      const smartTelemetry = resolveSmartSearchTelemetry(hits);
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "document",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        helperModelKey: helperRanking?.modelKey ?? null,
        helperProviderKey: helperRanking?.providerKey ?? null,
        helperInputTokens: helperRanking?.usage?.inputTokens ?? null,
        helperOutputTokens: helperRanking?.usage?.outputTokens ?? null,
        helperTotalTokens: helperRanking?.usage?.totalTokens ?? null,
        modeUsed: smartTelemetry.modeUsed,
        bytesReturned: smartTelemetry.bytesReturned
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "document",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async searchMemory(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
    memoryClass?: "core" | "contextual" | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    let lexicalCandidateCount = 0;
    try {
      const queryInfo = buildSearchQueryInfo(normalizedQuery);
      const memoryClassFilter = input.memoryClass ?? null;
      const rows = (await this.prisma.assistantMemoryRegistryItem.findMany({
        where: {
          assistantId: input.assistantId,
          forgottenAt: null,
          supersededAt: null,
          ...(memoryClassFilter === null ? {} : { memoryClass: memoryClassFilter }),
          OR: queryInfo.searchTerms.flatMap((term) => [
            {
              summary: {
                contains: term,
                mode: "insensitive"
              }
            },
            {
              sourceLabel: {
                contains: term,
                mode: "insensitive"
              }
            }
          ])
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: retrievalPolicy.lexicalCandidateLimit
      })) as MemoryRegistryRow[];
      lexicalCandidateCount = rows.length;

      const recencyBonus = buildRelativeRecencyResolver({
        rows,
        halfLifeDays: 14,
        maxBonus: 8
      });
      const scored = rows.map((row) => {
        const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
          query: queryInfo,
          title: resolveMemoryTitle(row),
          locator: resolveMemoryLocator(row),
          content: row.summary,
          fieldWeights: {
            title: 2.8,
            filename: 0,
            locator: 1.9,
            content: 2.2,
            metadata: 0
          },
          sourceWeight: row.sourceType === "memory_write" ? 9 : 4,
          recencyBonus: recencyBonus(row.createdAt),
          enableSemanticRerank: true
        });
        return {
          row,
          score,
          lexicalScore,
          exactTokenHits,
          dedupeKey: `${row.sourceType}:${normalizeSearchText(row.summary)}`,
          groupKey: row.chatId,
          groupLimit: row.chatId === null ? null : 2
        } satisfies RankedSearchCandidate<MemoryRegistryRow>;
      });
      const topScore = computeTopScore(scored);
      const ranked = scored
        .filter((candidate) =>
          passesRelevanceFloor(candidate, {
            topScore,
            queryTokenCount: queryInfo.tokens.length
          })
        )
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (right.lexicalScore !== left.lexicalScore) {
            return right.lexicalScore - left.lexicalScore;
          }
          if (right.row.createdAt.getTime() !== left.row.createdAt.getTime()) {
            return right.row.createdAt.getTime() - left.row.createdAt.getTime();
          }
          return left.row.id.localeCompare(right.row.id);
        });

      const hits: RuntimeKnowledgeSearchHit[] = selectRankedCandidates(
        ranked,
        resolveMaxResults(
          input.maxResults,
          retrievalPolicy.defaultMaxResults,
          retrievalPolicy.maxMaxResults
        )
      ).map(({ row, score }) => ({
        referenceId: buildMemoryReferenceId(row.id),
        source: "memory" as const,
        title: resolveMemoryTitle(row),
        locator: resolveMemoryLocator(row),
        snippet: buildSnippet(row.summary, queryInfo.searchTerms),
        score,
        metadata: {
          memoryItemId: row.id,
          sourceType: row.sourceType,
          sourceLabel: row.sourceLabel,
          memoryClass: row.memoryClass,
          kind: row.kind,
          summary: row.summary,
          chatId: row.chatId,
          relatedUserMessageId: row.relatedUserMessageId,
          relatedAssistantMessageId: row.relatedAssistantMessageId,
          createdAt: row.createdAt.toISOString()
        }
      }));
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "memory",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        modeUsed: "snippet_only",
        bytesReturned: 0
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "memory",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async searchChats(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    let lexicalCandidateCount = 0;
    try {
      const queryInfo = buildSearchQueryInfo(normalizedQuery);
      const rows = (await this.prisma.assistantChatMessage.findMany({
        where: {
          assistantId: input.assistantId,
          author: {
            in: ["user", "assistant"]
          },
          OR: queryInfo.searchTerms.map((term) => ({
            content: {
              contains: term,
              mode: "insensitive"
            }
          }))
        },
        include: {
          chat: {
            select: {
              id: true,
              surface: true,
              surfaceThreadKey: true,
              title: true,
              archivedAt: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: retrievalPolicy.lexicalCandidateLimit
      })) as ChatMessageRow[];
      lexicalCandidateCount = rows.length;

      const recencyBonus = buildRelativeRecencyResolver({
        rows,
        halfLifeDays: 7,
        maxBonus: 10
      });
      const scored = rows.map((row) => {
        const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
          query: queryInfo,
          title: resolveChatTitle(row.chat),
          locator: resolveChatLocator(row),
          content: row.content,
          fieldWeights: {
            title: 2.5,
            filename: 0,
            locator: 1.8,
            content: 2.15,
            metadata: 0
          },
          sourceWeight:
            (row.chat.archivedAt === null ? 4 : 1) + (row.author === "assistant" ? 1.5 : 0),
          recencyBonus: recencyBonus(row.createdAt),
          enableSemanticRerank: true
        });
        return {
          row,
          score,
          lexicalScore,
          exactTokenHits,
          dedupeKey: `${row.chatId}:${normalizeSearchText(row.content)}`,
          groupKey: row.chatId,
          groupLimit: 2
        } satisfies RankedSearchCandidate<ChatMessageRow>;
      });
      const topScore = computeTopScore(scored);
      const ranked = scored
        .filter((candidate) =>
          passesRelevanceFloor(candidate, {
            topScore,
            queryTokenCount: queryInfo.tokens.length
          })
        )
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (right.lexicalScore !== left.lexicalScore) {
            return right.lexicalScore - left.lexicalScore;
          }
          if (right.row.createdAt.getTime() !== left.row.createdAt.getTime()) {
            return right.row.createdAt.getTime() - left.row.createdAt.getTime();
          }
          return left.row.id.localeCompare(right.row.id);
        });

      const hits: RuntimeKnowledgeSearchHit[] = selectRankedCandidates(
        ranked,
        resolveMaxResults(
          input.maxResults,
          retrievalPolicy.defaultMaxResults,
          retrievalPolicy.maxMaxResults
        )
      ).map(({ row, score }) => ({
        referenceId: buildChatReferenceId({
          chatId: row.chatId,
          messageId: row.id
        }),
        source: "chat" as const,
        title: resolveChatTitle(row.chat),
        locator: resolveChatLocator(row),
        snippet: buildSnippet(row.content, queryInfo.searchTerms),
        score,
        metadata: {
          chatId: row.chatId,
          messageId: row.id,
          author: row.author,
          surface: row.chat.surface,
          surfaceThreadKey: row.chat.surfaceThreadKey,
          archivedAt: row.chat.archivedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString()
        }
      }));
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "chat",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        modeUsed: "snippet_only",
        bytesReturned: 0
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "chat",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async searchSubscription(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    try {
      const documents = await this.loadSubscriptionKnowledgeDocuments(input.assistantId);
      const baseHits = searchTextKnowledgeDocuments({
        documents,
        query: input.query,
        maxResults: input.maxResults,
        defaultMaxResults: retrievalPolicy.defaultMaxResults,
        maxMaxResults: retrievalPolicy.maxMaxResults
      });
      const hits = await this.enrichKnowledgeHitsWithSmartInline({
        assistantId: input.assistantId,
        hits: baseHits,
        loadSectionsForHit: async (hit) =>
          this.loadSubscriptionSectionsForHit(input.assistantId, hit)
      });
      const smartTelemetry = resolveSmartSearchTelemetry(hits);
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "subscription",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount: documents.length,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        modeUsed: smartTelemetry.modeUsed,
        bytesReturned: smartTelemetry.bytesReturned
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "subscription",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount: 0,
        vectorCandidateCount: 0,
        helperApplied: false,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async searchGlobal(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      input.assistantId
    );
    let lexicalCandidateCount = 0;
    let vectorCandidateCount = 0;
    let helperApplied = false;
    let retrievalMode: "lexical" | "hybrid" = "lexical";
    let embeddingModelKey: string | null = null;
    try {
      const [documents, uploaded] = await Promise.all([
        this.loadGlobalKnowledgeDocuments(input.assistantId),
        this.searchUploadedGlobalDocuments(input)
      ]);
      lexicalCandidateCount = documents.length + uploaded.lexicalCandidateCount;
      vectorCandidateCount = uploaded.vectorCandidateCount;
      retrievalMode = uploaded.retrievalMode;
      embeddingModelKey = uploaded.embeddingModelKey;
      const textHits = searchTextKnowledgeDocuments({
        documents,
        query: input.query,
        maxResults: input.maxResults,
        defaultMaxResults: retrievalPolicy.defaultMaxResults,
        maxMaxResults: retrievalPolicy.maxMaxResults
      });
      // ADR-120 Slice 4 — both contributing sets are already floored
      // (`searchTextKnowledgeDocuments` and `searchUploadedGlobalDocuments` each
      // apply `passesRelevanceFloor`), so `hits` here is the floored,
      // score-ordered set. Rerank can only narrow/reorder it; on helper
      // unavailability we keep this set as-is and never widen.
      let hits = [...textHits, ...uploaded.hits]
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(
          0,
          resolveMaxResults(
            input.maxResults,
            retrievalPolicy.defaultMaxResults,
            retrievalPolicy.maxMaxResults
          )
        );

      const helperRanking = await this.knowledgeRetrievalHelperService.rerankCandidates({
        assistantId: input.assistantId,
        query: input.query.trim(),
        retrievalModelKey:
          await this.knowledgeModelPolicyService.resolveAdminKnowledgeRetrievalModelKey(),
        candidates: hits.map((hit) => ({
          referenceId: hit.referenceId,
          title: hit.title,
          locator: hit.locator,
          snippet: hit.snippet
        }))
      });
      helperApplied = helperRanking !== null;
      if (helperRanking !== null) {
        const allowedReferenceIds = new Set(helperRanking.rankedReferenceIds);
        const helperRankIndex = new Map(
          helperRanking.rankedReferenceIds.map((referenceId, index) => [referenceId, index])
        );
        hits = hits
          .filter((hit) => allowedReferenceIds.has(hit.referenceId))
          .sort((left, right) => {
            const leftRank = helperRankIndex.get(left.referenceId);
            const rightRank = helperRankIndex.get(right.referenceId);
            if (leftRank === undefined && rightRank === undefined) {
              return (right.score ?? 0) - (left.score ?? 0);
            }
            if (leftRank === undefined) {
              return 1;
            }
            if (rightRank === undefined) {
              return -1;
            }
            return leftRank - rightRank;
          });
      }
      hits = await this.enrichKnowledgeHitsWithSmartInline({
        assistantId: input.assistantId,
        hits,
        loadSectionsForHit: async (hit) => this.loadGlobalSectionsForHit(input.assistantId, hit)
      });
      const smartTelemetry = resolveSmartSearchTelemetry(hits);

      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "global",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        helperModelKey: helperRanking?.modelKey ?? null,
        helperProviderKey: helperRanking?.providerKey ?? null,
        helperInputTokens: helperRanking?.usage?.inputTokens ?? null,
        helperOutputTokens: helperRanking?.usage?.outputTokens ?? null,
        helperTotalTokens: helperRanking?.usage?.totalTokens ?? null,
        modeUsed: smartTelemetry.modeUsed,
        bytesReturned: smartTelemetry.bytesReturned
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "global",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async fetchDocument(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(input.assistantId);
    const plan = resolveDocumentFetchPlan(input.mode, input.radius, retrievalPolicy, adminLimits);
    try {
      const reference = parseDocumentReferenceId(input.referenceId.trim());
      if (reference === null) {
        throw new BadRequestException("referenceId is invalid.");
      }

      const centerRow = await this.prisma.assistantKnowledgeSourceChunk.findFirst({
        where: {
          assistantId: input.assistantId,
          knowledgeSourceId: reference.knowledgeSourceId,
          sourceVersion: reference.sourceVersion,
          chunkIndex: reference.chunkIndex,
          knowledgeSource: {
            assistantId: input.assistantId,
            namespace: "assistant_user_workspace",
            status: "ready"
          }
        },
        include: {
          knowledgeSource: {
            select: {
              id: true,
              namespace: true,
              displayName: true,
              originalFilename: true,
              mimeType: true
            }
          }
        }
      });

      if (centerRow === null) {
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "document",
          retrievalMode: "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth: 0,
          fetchedChars: 0,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return null;
      }

      const surroundingRows = await this.prisma.assistantKnowledgeSourceChunk.findMany({
        where: {
          assistantId: input.assistantId,
          knowledgeSourceId: reference.knowledgeSourceId,
          sourceVersion: reference.sourceVersion,
          ...(plan.isFull
            ? {}
            : {
                chunkIndex: {
                  gte: Math.max(0, reference.chunkIndex - plan.radius),
                  lte: reference.chunkIndex + plan.radius
                }
              })
        },
        orderBy: [{ chunkIndex: "asc" }]
      });

      const joined = surroundingRows
        .map((row) => row.content.trim())
        .filter((row) => row.length > 0)
        .join("\n\n---\n\n");
      const { content, truncated } = applyTruncationMarker(joined, plan.charLimit);

      const document = {
        referenceId: buildDocumentReferenceId(reference),
        source: "document",
        title: centerRow.knowledgeSource.displayName ?? centerRow.knowledgeSource.originalFilename,
        locator: centerRow.locator,
        content,
        snippet: buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]),
        modeUsed: plan.modeUsed,
        truncated,
        metadata: {
          knowledgeSourceId: centerRow.knowledgeSource.id,
          namespace: centerRow.knowledgeSource.namespace,
          mimeType: centerRow.knowledgeSource.mimeType,
          originalFilename: centerRow.knowledgeSource.originalFilename,
          sourceVersion: centerRow.sourceVersion,
          chunkIndex: centerRow.chunkIndex,
          windowStartChunkIndex: surroundingRows[0]?.chunkIndex ?? centerRow.chunkIndex,
          windowEndChunkIndex:
            surroundingRows[surroundingRows.length - 1]?.chunkIndex ?? centerRow.chunkIndex,
          modeUsed: plan.modeUsed,
          truncated
        }
      } satisfies RuntimeKnowledgeDocument;
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "document",
        retrievalMode: centerRow.embeddingModelKey === null ? "lexical" : "hybrid",
        durationMs: Date.now() - startedAt,
        fetchDepth: surroundingRows.length,
        fetchedChars: content.length,
        embeddingModelKey: centerRow.embeddingModelKey ?? null,
        modeUsed: plan.modeUsed,
        bytesReturned: content.length
      });
      return document;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "document",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async fetchMemory(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    try {
      const reference = parseMemoryReferenceId(input.referenceId.trim());
      if (reference === null) {
        throw new BadRequestException("referenceId is invalid.");
      }

      const row = (await this.prisma.assistantMemoryRegistryItem.findFirst({
        where: {
          id: reference.memoryItemId,
          assistantId: input.assistantId,
          forgottenAt: null
        }
      })) as MemoryRegistryRow | null;

      if (row === null) {
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "memory",
          retrievalMode: "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth: 0,
          fetchedChars: 0,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return null;
      }

      const document = {
        referenceId: buildMemoryReferenceId(row.id),
        source: "memory",
        title: resolveMemoryTitle(row),
        locator: resolveMemoryLocator(row),
        content: row.summary,
        snippet: buildSnippet(row.summary, [row.summary]) ?? row.summary,
        metadata: {
          memoryItemId: row.id,
          sourceType: row.sourceType,
          sourceLabel: row.sourceLabel,
          chatId: row.chatId,
          relatedUserMessageId: row.relatedUserMessageId,
          relatedAssistantMessageId: row.relatedAssistantMessageId,
          createdAt: row.createdAt.toISOString()
        }
      } satisfies RuntimeKnowledgeDocument;
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "memory",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 1,
        fetchedChars: row.summary.length,
        embeddingModelKey: null,
        modeUsed: input.mode,
        bytesReturned: row.summary.length
      });
      return document;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "memory",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async fetchChat(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(input.assistantId);
    const plan = resolveChatFetchPlan(input.mode, input.radius, retrievalPolicy, adminLimits);
    try {
      const reference = parseChatReferenceId(input.referenceId.trim());
      if (reference === null) {
        throw new BadRequestException("referenceId is invalid.");
      }

      const centerRow = (await this.prisma.assistantChatMessage.findFirst({
        where: {
          id: reference.messageId,
          chatId: reference.chatId,
          assistantId: input.assistantId,
          author: {
            in: ["user", "assistant"]
          }
        },
        include: {
          chat: {
            select: {
              id: true,
              surface: true,
              surfaceThreadKey: true,
              title: true,
              archivedAt: true
            }
          }
        }
      })) as ChatMessageRow | null;

      if (centerRow === null) {
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "chat",
          retrievalMode: "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth: 0,
          fetchedChars: 0,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return null;
      }

      const allRows = (await this.prisma.assistantChatMessage.findMany({
        where: {
          assistantId: input.assistantId,
          chatId: centerRow.chatId,
          author: {
            in: ["user", "assistant"]
          }
        },
        select: {
          id: true,
          author: true,
          content: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })) as ChatMessageWindowRow[];
      const centerIndex = allRows.findIndex((row) => row.id === centerRow.id);
      if (centerIndex < 0) {
        throw new BadRequestException("referenceId is invalid.");
      }
      const selectedRows = plan.isFull
        ? allRows
        : allRows.slice(
            Math.max(0, centerIndex - plan.radius),
            Math.min(allRows.length, centerIndex + plan.radius + 1)
          );
      const messageLimited =
        selectedRows.length > plan.messageLimit
          ? selectedRows.slice(0, plan.messageLimit)
          : selectedRows;
      const messageTruncated =
        messageLimited.length < selectedRows.length || selectedRows.length < allRows.length;
      const omittedMessages = Math.max(0, allRows.length - messageLimited.length);
      const rawContent = buildChatWindowContent(messageLimited, plan.charLimit);
      const charTruncated = rawContent.length >= plan.charLimit;
      const truncated = messageTruncated || charTruncated;
      const content =
        truncated && !rawContent.endsWith(TRUNCATION_MARKER)
          ? `${rawContent}${TRUNCATION_MARKER}`
          : rawContent;
      const document = {
        referenceId: buildChatReferenceId(reference),
        source: "chat",
        title: resolveChatTitle(centerRow.chat),
        locator: resolveChatLocator(centerRow),
        content,
        snippet:
          buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]) ??
          centerRow.content.trim(),
        modeUsed: plan.modeUsed,
        truncated,
        metadata: {
          chatId: centerRow.chatId,
          messageId: centerRow.id,
          author: centerRow.author,
          surface: centerRow.chat.surface,
          surfaceThreadKey: centerRow.chat.surfaceThreadKey,
          archivedAt: centerRow.chat.archivedAt?.toISOString() ?? null,
          createdAt: centerRow.createdAt.toISOString(),
          windowStartMessageId: messageLimited[0]?.id ?? centerRow.id,
          windowEndMessageId: messageLimited[messageLimited.length - 1]?.id ?? centerRow.id,
          messageCount: messageLimited.length,
          truncationMarker: truncated
            ? {
                messagesOmitted: omittedMessages,
                charsOmitted: Math.max(0, rawContent.length - content.length)
              }
            : null,
          modeUsed: plan.modeUsed,
          truncated
        }
      } satisfies RuntimeKnowledgeDocument;
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "chat",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: messageLimited.length,
        fetchedChars: content.length,
        embeddingModelKey: null,
        modeUsed: plan.modeUsed,
        bytesReturned: content.length
      });
      return document;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "chat",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async fetchSubscription(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(input.assistantId);
    const textPlan = resolveTextDocumentFetchPlan(input.mode, retrievalPolicy, adminLimits);
    try {
      const referenceId = input.referenceId.trim();
      const document = (await this.loadSubscriptionKnowledgeDocuments(input.assistantId)).find(
        (row) => row.referenceId === referenceId
      );
      const resolved =
        document === undefined
          ? null
          : toTextKnowledgeDocument(document, textPlan.charLimit, textPlan.modeUsed);
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "subscription",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: resolved === null ? 0 : 1,
        fetchedChars: resolved?.content.length ?? 0,
        embeddingModelKey: null,
        outcome: resolved === null ? "empty" : "success",
        modeUsed: textPlan.modeUsed,
        bytesReturned: resolved?.content.length ?? 0
      });
      return resolved;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "subscription",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  async fetchGlobal(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(input.assistantId);
    const textPlan = resolveTextDocumentFetchPlan(input.mode, retrievalPolicy, adminLimits);
    try {
      const referenceId = input.referenceId.trim();
      const uploaded = await this.fetchUploadedGlobalDocument(
        referenceId,
        input.assistantId,
        input.mode,
        input.radius
      );
      if (uploaded !== null) {
        const metadata =
          uploaded.metadata !== null &&
          typeof uploaded.metadata === "object" &&
          !Array.isArray(uploaded.metadata)
            ? (uploaded.metadata as Record<string, unknown>)
            : null;
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "global",
          retrievalMode: metadata?.retrievalMode === "hybrid" ? "hybrid" : "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth:
            typeof metadata?.windowChunkCount === "number" ? metadata.windowChunkCount : 1,
          fetchedChars: uploaded.content.length,
          embeddingModelKey:
            typeof metadata?.embeddingModelKey === "string" ? metadata.embeddingModelKey : null,
          modeUsed: input.mode,
          bytesReturned: uploaded.content.length
        });
        return uploaded;
      }
      const document = (await this.loadGlobalKnowledgeDocuments(input.assistantId)).find(
        (row) => row.referenceId === referenceId
      );
      const resolved =
        document === undefined
          ? null
          : toTextKnowledgeDocument(document, textPlan.charLimit, textPlan.modeUsed);
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "global",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: resolved === null ? 0 : 1,
        fetchedChars: resolved?.content.length ?? 0,
        embeddingModelKey: null,
        outcome: resolved === null ? "empty" : "success",
        modeUsed: textPlan.modeUsed,
        bytesReturned: resolved?.content.length ?? 0
      });
      return resolved;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "global",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  private async searchUploadedGlobalDocuments(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<UploadedGlobalSearchExecution> {
    const [assistant, resolvedEmbeddingModelKey, retrievalPolicy] = await Promise.all([
      this.resolveAssistantKnowledgeContext(input.assistantId),
      this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey(),
      this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(input.assistantId)
    ]);
    if (assistant === null) {
      return {
        hits: [],
        lexicalCandidateCount: 0,
        vectorCandidateCount: 0,
        retrievalMode: "lexical",
        embeddingModelKey: null
      };
    }
    const normalizedQuery = input.query.trim();
    const queryInfo = buildSearchQueryInfo(normalizedQuery);
    const rows = (await this.prisma.globalKnowledgeSourceChunk.findMany({
      where: {
        globalKnowledgeSource: {
          status: "ready"
        },
        OR: queryInfo.searchTerms.flatMap((term) => [
          {
            content: {
              contains: term,
              mode: "insensitive"
            }
          },
          {
            locator: {
              contains: term,
              mode: "insensitive"
            }
          }
        ])
      },
      include: {
        globalKnowledgeSource: {
          select: {
            id: true,
            displayName: true,
            originalFilename: true,
            mimeType: true
          }
        }
      },
      orderBy: [
        { globalKnowledgeSourceId: "asc" },
        { sourceVersion: "desc" },
        { chunkIndex: "asc" }
      ],
      take: retrievalPolicy.lexicalCandidateLimit
    })) as GlobalSearchSourceRow[];
    const rankedByReferenceId = new Map<string, RankedSearchCandidate<GlobalSearchSourceRow>>();
    const upsertRankedCandidate = (
      referenceId: string,
      candidate: RankedSearchCandidate<GlobalSearchSourceRow>
    ) => {
      const existing = rankedByReferenceId.get(referenceId);
      if (
        existing === undefined ||
        candidate.score > existing.score ||
        (candidate.score === existing.score && candidate.lexicalScore > existing.lexicalScore)
      ) {
        rankedByReferenceId.set(referenceId, candidate);
      }
    };

    for (const row of rows) {
      const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
        query: queryInfo,
        title: row.globalKnowledgeSource.displayName,
        filename: row.globalKnowledgeSource.originalFilename,
        locator: row.locator,
        content: row.content,
        fieldWeights: {
          title: 3.2,
          filename: 2.8,
          locator: 2.0,
          content: 1.25,
          metadata: 0
        },
        sourceWeight: 4,
        enableSemanticRerank: true
      });
      if (score <= 0) {
        continue;
      }
      const referenceId = buildGlobalUploadedReferenceId({
        globalKnowledgeSourceId: row.globalKnowledgeSourceId,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex
      });
      upsertRankedCandidate(referenceId, {
        row,
        score,
        lexicalScore,
        exactTokenHits,
        dedupeKey: [
          row.globalKnowledgeSourceId,
          normalizeSearchText(row.locator ?? ""),
          normalizeSearchText(row.content).slice(0, 180)
        ].join(":"),
        groupKey: row.globalKnowledgeSourceId,
        groupLimit: 2
      });
    }

    const queryEmbedding =
      !retrievalPolicy.embeddingSearchEnabled || resolvedEmbeddingModelKey === null
        ? null
        : ((
            await this.knowledgeEmbeddingService.generateEmbeddings({
              modelKey: resolvedEmbeddingModelKey,
              texts: [normalizedQuery]
            })
          ).embeddings[0] ?? null);
    let vectorCandidateCount = 0;
    const retrievalMode: "lexical" | "hybrid" = queryEmbedding === null ? "lexical" : "hybrid";
    if (queryEmbedding !== null && resolvedEmbeddingModelKey !== null) {
      // ADR-120 Slice 3 — global/product uploaded-document candidates now come
      // from the unified `KnowledgeVectorChunk` ANN query rather than the
      // first-N-by-table-order + in-process cosine pass. The 0.18 gate and the
      // combined score formula are unchanged; only the candidate selection and
      // the similarity source changed.
      const vectorHits = await this.knowledgeVectorIndex.searchNearest({
        workspaceId: null,
        embeddingModelKey: resolvedEmbeddingModelKey,
        queryVector: queryEmbedding,
        limit: retrievalPolicy.vectorCandidateLimit,
        sourceTypes: ["global_knowledge_source"]
      });
      vectorCandidateCount = vectorHits.length;
      const vectorSimilarityByReferenceId = new Map<string, number>();
      for (const hit of vectorHits) {
        if (hit.score <= 0.18) {
          continue;
        }
        const referenceId = buildGlobalUploadedReferenceId({
          globalKnowledgeSourceId: hit.sourceId,
          sourceVersion: hit.sourceVersion,
          chunkIndex: hit.chunkIndex
        });
        vectorSimilarityByReferenceId.set(
          referenceId,
          Math.max(vectorSimilarityByReferenceId.get(referenceId) ?? 0, hit.score)
        );
      }
      if (vectorSimilarityByReferenceId.size > 0) {
        const vectorRows = (await this.prisma.globalKnowledgeSourceChunk.findMany({
          where: {
            globalKnowledgeSource: {
              status: "ready"
            },
            OR: vectorHits
              .filter((hit) => hit.score > 0.18)
              .map((hit) => ({
                globalKnowledgeSourceId: hit.sourceId,
                sourceVersion: hit.sourceVersion,
                chunkIndex: hit.chunkIndex
              }))
          },
          include: {
            globalKnowledgeSource: {
              select: {
                id: true,
                displayName: true,
                originalFilename: true,
                mimeType: true
              }
            }
          }
        })) as GlobalSearchSourceRow[];

        for (const row of vectorRows) {
          const referenceId = buildGlobalUploadedReferenceId({
            globalKnowledgeSourceId: row.globalKnowledgeSourceId,
            sourceVersion: row.sourceVersion,
            chunkIndex: row.chunkIndex
          });
          const vectorSimilarity = vectorSimilarityByReferenceId.get(referenceId);
          if (vectorSimilarity === undefined) {
            continue;
          }
          const { lexicalScore, exactTokenHits } = rankStructuredCandidate({
            query: queryInfo,
            title: row.globalKnowledgeSource.displayName,
            filename: row.globalKnowledgeSource.originalFilename,
            locator: row.locator,
            content: row.content,
            fieldWeights: {
              title: 2.3,
              filename: 2.0,
              locator: 1.5,
              content: 1.0,
              metadata: 0
            },
            sourceWeight: 1.8,
            enableSemanticRerank: false
          });
          upsertRankedCandidate(referenceId, {
            row,
            score: vectorSimilarity * 42 + lexicalScore * 0.35,
            lexicalScore: lexicalScore + vectorSimilarity * 10,
            exactTokenHits,
            dedupeKey: [
              row.globalKnowledgeSourceId,
              normalizeSearchText(row.locator ?? ""),
              normalizeSearchText(row.content).slice(0, 180)
            ].join(":"),
            groupKey: row.globalKnowledgeSourceId,
            groupLimit: 2
          });
        }
      }
    }

    // ADR-120 Slice 4 — apply the relevance floor to uploaded global/product
    // documents, mirroring the user-document path and the product text-entry
    // path below. Weak fuzzy-only hits are dropped; an empty uploaded set is a
    // valid outcome and is never backfilled.
    const uploadedCandidates = Array.from(rankedByReferenceId.values());
    const uploadedTopScore = computeTopScore(uploadedCandidates);
    const ranked = uploadedCandidates
      .filter((candidate) =>
        passesRelevanceFloor(candidate, {
          topScore: uploadedTopScore,
          queryTokenCount: queryInfo.tokens.length
        })
      )
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.lexicalScore !== left.lexicalScore) {
          return right.lexicalScore - left.lexicalScore;
        }
        if (left.row.globalKnowledgeSourceId !== right.row.globalKnowledgeSourceId) {
          return left.row.globalKnowledgeSourceId.localeCompare(right.row.globalKnowledgeSourceId);
        }
        return left.row.chunkIndex - right.row.chunkIndex;
      });
    const productTextEntryHits = await this.searchProductKnowledgeTextEntries({
      queryInfo,
      maxResults: resolveMaxResults(
        input.maxResults,
        retrievalPolicy.defaultMaxResults,
        retrievalPolicy.maxMaxResults
      )
    });
    const uploadedHits = selectRankedCandidates(
      ranked,
      resolveMaxResults(
        input.maxResults,
        retrievalPolicy.defaultMaxResults,
        retrievalPolicy.maxMaxResults
      )
    ).map(({ row, score }) => ({
      referenceId: buildGlobalUploadedReferenceId({
        globalKnowledgeSourceId: row.globalKnowledgeSourceId,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex
      }),
      source: "global" as const,
      title: row.globalKnowledgeSource.displayName ?? row.globalKnowledgeSource.originalFilename,
      locator: row.locator,
      snippet: buildSnippet(row.content, queryInfo.searchTerms),
      score,
      metadata: {
        knowledgeSourceId: row.globalKnowledgeSource.id,
        scope: row.scope,
        mimeType: row.globalKnowledgeSource.mimeType,
        originalFilename: row.globalKnowledgeSource.originalFilename,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex,
        retrievalMode,
        kind: "global_uploaded"
      }
    }));

    return {
      lexicalCandidateCount: rows.length,
      vectorCandidateCount,
      retrievalMode,
      embeddingModelKey: resolvedEmbeddingModelKey,
      hits: [...uploadedHits, ...productTextEntryHits]
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(
          0,
          resolveMaxResults(
            input.maxResults,
            retrievalPolicy.defaultMaxResults,
            retrievalPolicy.maxMaxResults
          )
        )
    };
  }

  private async searchProductKnowledgeTextEntries(input: {
    queryInfo: SearchQueryInfo;
    maxResults: number;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const rows = (await this.prisma.productKnowledgeTextEntryChunk.findMany({
      where: {
        textEntry: {
          status: "ready",
          lifecycleStatus: "active"
        },
        OR: input.queryInfo.searchTerms.flatMap((term) => [
          {
            content: {
              contains: term,
              mode: "insensitive"
            }
          },
          {
            locator: {
              contains: term,
              mode: "insensitive"
            }
          }
        ])
      },
      include: {
        textEntry: {
          select: {
            id: true,
            title: true,
            category: true,
            locale: true,
            lifecycleStatus: true,
            status: true
          }
        }
      },
      orderBy: [{ textEntryId: "asc" }, { sourceVersion: "desc" }, { chunkIndex: "asc" }],
      take: Math.max(input.maxResults * 3, input.maxResults)
    })) as ProductKnowledgeTextEntrySearchRow[];
    const scored = rows.map((row) => {
      const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
        query: input.queryInfo,
        title: row.textEntry.title,
        filename: null,
        locator: row.locator,
        content: row.content,
        fieldWeights: {
          title: 3.4,
          filename: 0,
          locator: 2.0,
          content: 1.3,
          metadata: 0
        },
        sourceWeight: 4,
        enableSemanticRerank: true
      });
      return { row, score, lexicalScore, exactTokenHits };
    });
    const topScore = computeTopScore(scored);
    const ranked = scored
      .filter((candidate) =>
        passesRelevanceFloor(candidate, {
          topScore,
          queryTokenCount: input.queryInfo.tokens.length
        })
      )
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.lexicalScore - left.lexicalScore;
      })
      .slice(0, input.maxResults);
    return ranked.map(({ row, score }) => ({
      referenceId: buildProductTextEntryReferenceId({
        textEntryId: row.textEntryId,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex
      }),
      source: "global",
      title: row.textEntry.title,
      locator: row.locator,
      snippet: buildSnippet(row.content, input.queryInfo.searchTerms),
      score,
      metadata: {
        textEntryId: row.textEntry.id,
        scope: "product",
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex,
        category: row.textEntry.category,
        locale: row.textEntry.locale,
        retrievalMode: "lexical",
        kind: "product_text_entry"
      }
    }));
  }

  private async fetchUploadedGlobalDocument(
    referenceId: string,
    assistantId: string,
    mode: PersaiRuntimeKnowledgeFetchMode,
    radius: number | null
  ): Promise<RuntimeKnowledgeDocument | null> {
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(assistantId);
    const plan = resolveDocumentFetchPlan(mode, radius, retrievalPolicy, adminLimits);
    const textEntryReference = parseProductTextEntryReferenceId(referenceId);
    if (textEntryReference !== null) {
      return this.fetchProductKnowledgeTextEntryDocument(
        referenceId,
        assistantId,
        textEntryReference,
        plan
      );
    }
    const reference = parseGlobalUploadedReferenceId(referenceId);
    if (reference === null) {
      return null;
    }
    const assistant = await this.resolveAssistantKnowledgeContext(assistantId);
    if (assistant === null) {
      return null;
    }
    const centerRow = await this.prisma.globalKnowledgeSourceChunk.findFirst({
      where: {
        globalKnowledgeSourceId: reference.globalKnowledgeSourceId,
        sourceVersion: reference.sourceVersion,
        chunkIndex: reference.chunkIndex,
        globalKnowledgeSource: {
          status: "ready"
        }
      },
      include: {
        globalKnowledgeSource: {
          select: {
            id: true,
            displayName: true,
            originalFilename: true,
            mimeType: true
          }
        }
      }
    });
    if (centerRow === null) {
      return null;
    }
    const surroundingRows = await this.prisma.globalKnowledgeSourceChunk.findMany({
      where: {
        globalKnowledgeSourceId: reference.globalKnowledgeSourceId,
        sourceVersion: reference.sourceVersion,
        ...(plan.isFull
          ? {}
          : {
              chunkIndex: {
                gte: Math.max(0, reference.chunkIndex - plan.radius),
                lte: reference.chunkIndex + plan.radius
              }
            })
      },
      orderBy: [{ chunkIndex: "asc" }]
    });
    const joined = surroundingRows
      .map((row) => row.content.trim())
      .filter((row) => row.length > 0)
      .join("\n\n---\n\n");
    const { content, truncated } = applyTruncationMarker(joined, plan.charLimit);
    return {
      referenceId,
      source: "global",
      title:
        centerRow.globalKnowledgeSource.displayName ??
        centerRow.globalKnowledgeSource.originalFilename,
      locator: centerRow.locator,
      content,
      snippet: buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]),
      modeUsed: plan.modeUsed,
      truncated,
      metadata: {
        knowledgeSourceId: centerRow.globalKnowledgeSource.id,
        scope: centerRow.scope,
        mimeType: centerRow.globalKnowledgeSource.mimeType,
        originalFilename: centerRow.globalKnowledgeSource.originalFilename,
        sourceVersion: centerRow.sourceVersion,
        chunkIndex: centerRow.chunkIndex,
        embeddingModelKey: centerRow.embeddingModelKey,
        retrievalMode: centerRow.embeddingModelKey === null ? "lexical" : "hybrid",
        windowChunkCount: surroundingRows.length,
        kind: "global_uploaded",
        modeUsed: plan.modeUsed,
        truncated
      }
    };
  }

  private async fetchProductKnowledgeTextEntryDocument(
    referenceId: string,
    assistantId: string,
    reference: { textEntryId: string; sourceVersion: number; chunkIndex: number },
    plan: DocumentFetchPlan
  ): Promise<RuntimeKnowledgeDocument | null> {
    const assistant = await this.resolveAssistantKnowledgeContext(assistantId);
    if (assistant === null) {
      return null;
    }
    const centerRow = await this.prisma.productKnowledgeTextEntryChunk.findFirst({
      where: {
        textEntryId: reference.textEntryId,
        sourceVersion: reference.sourceVersion,
        chunkIndex: reference.chunkIndex,
        textEntry: {
          status: "ready",
          lifecycleStatus: "active"
        }
      },
      include: {
        textEntry: {
          select: {
            id: true,
            title: true,
            category: true,
            locale: true
          }
        }
      }
    });
    if (centerRow === null) {
      return null;
    }
    const surroundingRows = await this.prisma.productKnowledgeTextEntryChunk.findMany({
      where: {
        textEntryId: reference.textEntryId,
        sourceVersion: reference.sourceVersion,
        ...(plan.isFull
          ? {}
          : {
              chunkIndex: {
                gte: Math.max(0, reference.chunkIndex - plan.radius),
                lte: reference.chunkIndex + plan.radius
              }
            }),
        textEntry: {
          status: "ready",
          lifecycleStatus: "active"
        }
      },
      orderBy: [{ chunkIndex: "asc" }]
    });
    const joined = surroundingRows
      .map((row) => row.content.trim())
      .filter((row) => row.length > 0)
      .join("\n\n---\n\n");
    const { content, truncated } = applyTruncationMarker(joined, plan.charLimit);
    return {
      referenceId,
      source: "global",
      title: centerRow.textEntry.title,
      locator: centerRow.locator,
      content,
      snippet: buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]),
      modeUsed: plan.modeUsed,
      truncated,
      metadata: {
        textEntryId: centerRow.textEntry.id,
        scope: "product",
        sourceVersion: centerRow.sourceVersion,
        chunkIndex: centerRow.chunkIndex,
        embeddingModelKey: centerRow.embeddingModelKey,
        retrievalMode: centerRow.embeddingModelKey === null ? "lexical" : "hybrid",
        windowChunkCount: surroundingRows.length,
        category: centerRow.textEntry.category,
        locale: centerRow.textEntry.locale,
        kind: "product_text_entry",
        modeUsed: plan.modeUsed,
        truncated
      }
    };
  }

  private async loadSubscriptionKnowledgeDocuments(
    assistantId: string
  ): Promise<TextKnowledgeDocumentRow[]> {
    const assistant = await this.resolveAssistantKnowledgeContext(assistantId);
    if (assistant === null) {
      return [];
    }

    const effectiveSubscription =
      await this.resolveEffectiveSubscriptionStateService.executeReadOnly({
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        assistantPlanOverrideCode: assistant.governance?.assistantPlanOverrideCode ?? null,
        assistantQuotaPlanCode: assistant.governance?.quotaPlanCode ?? null
      });
    const effectiveSource = effectiveSubscription.source;
    const effectiveStatus = effectiveSubscription.status;
    const planCode = effectiveSubscription.planCode;
    const trialEndsAt = effectiveSubscription.trialEndsAt;
    const currentPeriodEndsAt = effectiveSubscription.currentPeriodEndsAt;
    const cancelAtPeriodEnd = effectiveSubscription.cancelAtPeriodEnd;

    const plan =
      planCode === null
        ? null
        : ((await this.prisma.planCatalogPlan.findFirst({
            where: {
              code: planCode
            },
            include: {
              entitlement: true,
              toolActivations: {
                include: {
                  tool: {
                    select: {
                      code: true,
                      displayName: true,
                      description: true,
                      toolClass: true,
                      capabilityGroup: true
                    }
                  }
                },
                orderBy: [{ tool: { code: "asc" } }]
              }
            }
          })) as PlanCatalogKnowledgeRow | null);

    return [
      {
        referenceId: "subscription:current",
        source: "subscription",
        title: "Current Subscription",
        locator: `workspace:${assistant.workspaceId}`,
        content: this.renderSubscriptionKnowledgeBody({
          source: effectiveSource,
          status: effectiveStatus,
          planCode,
          trialEndsAt,
          currentPeriodEndsAt,
          cancelAtPeriodEnd,
          plan
        }),
        metadata: {
          effectiveSource,
          effectiveStatus,
          planCode,
          workspaceId: assistant.workspaceId
        }
      }
    ];
  }

  private async loadGlobalKnowledgeDocuments(
    assistantId: string
  ): Promise<TextKnowledgeDocumentRow[]> {
    void assistantId;
    const plans = await this.prisma.planCatalogPlan.findMany({
      where: {
        status: "active"
      },
      include: {
        entitlement: true,
        toolActivations: {
          include: {
            tool: {
              select: {
                code: true,
                displayName: true,
                description: true,
                toolClass: true,
                capabilityGroup: true
              }
            }
          },
          orderBy: [{ tool: { code: "asc" } }]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }]
    });

    const documents: TextKnowledgeDocumentRow[] = [];

    for (const plan of plans as PlanCatalogKnowledgeRow[]) {
      documents.push(
        this.buildPlanKnowledgeDocument({
          source: "global",
          referenceId: `global:plan:${plan.code}`,
          title: `Plan: ${plan.displayName}`,
          locator: `plan:${plan.code}`,
          plan,
          metadata: {
            kind: "plan_catalog",
            code: plan.code,
            status: plan.status,
            updatedAt: plan.updatedAt.toISOString()
          }
        })
      );
    }

    return documents;
  }

  private buildPlanKnowledgeDocument(params: {
    source: TextKnowledgeSource;
    referenceId: string;
    title: string;
    locator: string | null;
    plan: PlanCatalogKnowledgeRow;
    metadata: Record<string, unknown> | null;
  }): TextKnowledgeDocumentRow {
    const visibleActivations = params.plan.toolActivations.filter(
      (activation) => !NON_PRODUCT_TOOL_CODES.has(activation.tool.code)
    );

    return {
      referenceId: params.referenceId,
      source: params.source,
      title: params.title,
      locator: params.locator,
      content: [
        `# ${params.title}`,
        `- Plan code: ${params.plan.code}`,
        `- Status: ${params.plan.status}`,
        `- Trial plan: ${params.plan.isTrialPlan ? "yes" : "no"}`,
        params.plan.trialDurationDays !== null
          ? `- Trial duration days: ${String(params.plan.trialDurationDays)}`
          : null,
        params.plan.description ? `Description:\n${params.plan.description}` : null,
        `Tool activations:\n${formatPlanToolActivations(visibleActivations)}`,
        params.plan.entitlement === null
          ? "Entitlements:\n- none"
          : [
              `Entitlement schema version: ${String(params.plan.entitlement.schemaVersion)}`,
              `Capabilities:\n${formatJsonValue(params.plan.entitlement.capabilities)}`,
              `Tool classes:\n${formatJsonValue(params.plan.entitlement.toolClasses)}`,
              `Channels and surfaces:\n${formatJsonValue(params.plan.entitlement.channelsAndSurfaces)}`,
              `Limits and permissions:\n${formatJsonValue(params.plan.entitlement.limitsPermissions)}`
            ].join("\n\n")
      ]
        .filter((row): row is string => row !== null)
        .join("\n\n"),
      metadata: params.metadata
    };
  }

  private renderSubscriptionKnowledgeBody(params: {
    source: string;
    status: string;
    planCode: string | null;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    plan: PlanCatalogKnowledgeRow | null;
  }): string {
    const base = [
      "# Current Subscription",
      `- Effective source: ${params.source}`,
      `- Status: ${params.status}`,
      `- Plan code: ${params.planCode ?? "none"}`,
      params.trialEndsAt !== null ? `- Trial ends at: ${params.trialEndsAt}` : null,
      params.currentPeriodEndsAt !== null
        ? `- Current period ends at: ${params.currentPeriodEndsAt}`
        : null,
      `- Cancel at period end: ${params.cancelAtPeriodEnd ? "yes" : "no"}`
    ].filter((row): row is string => row !== null);

    if (params.plan === null) {
      return [...base, "Plan details:\n- not available"].join("\n\n");
    }

    const planDocument = this.buildPlanKnowledgeDocument({
      source: "subscription",
      referenceId: "subscription:current",
      title: `Plan Detail: ${params.plan.displayName}`,
      locator: `plan:${params.plan.code}`,
      plan: params.plan,
      metadata: null
    });

    return [...base, planDocument.content].join("\n\n");
  }

  /**
   * ADR-120 Slice 5 — Skill knowledge bases are a `knowledge_search` pull
   * source. This is the retrieval logic moved out of the retired
   * orchestrator: the assistant's enabled/active Skill ids are resolved
   * server-side (the tool stays thin: just `source` + `query`), an ANN query
   * runs over `skill_document` / `skill_knowledge_card` scoped to those Skill
   * ids, hydrated lexical candidates are merged, and the SAME relevance floor
   * + no-widen mandatory rerank discipline used by the document source
   * (Slice 4) is applied. The source is only ALLOWED for a turn when a Skill
   * is active/engaged (gated at the runtime via `allowedKnowledgeSearchSources`).
   */
  async searchSkill(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const startedAt = Date.now();
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }

    let lexicalCandidateCount = 0;
    let vectorCandidateCount = 0;
    let helperApplied = false;
    let retrievalMode: "lexical" | "hybrid" = "lexical";
    let embeddingModelKey: string | null = null;

    try {
      const enabledSkillIds = await this.resolveEnabledSkillIds(input.assistantId);
      if (enabledSkillIds.length === 0) {
        await this.recordSearchObservability({
          assistantId: input.assistantId,
          source: "skill",
          retrievalMode,
          durationMs: Date.now() - startedAt,
          resultCount: 0,
          lexicalCandidateCount: 0,
          vectorCandidateCount: 0,
          helperApplied: false,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return [];
      }

      const [retrievalPolicy, adminPolicy] = await Promise.all([
        this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(input.assistantId),
        this.knowledgeModelPolicyService.resolveAdminKnowledgeRetrievalPolicy()
      ]);
      embeddingModelKey = adminPolicy.embeddingModelKey;

      const queryInfo = buildSearchQueryInfo(normalizedQuery);
      const rankedByReferenceId = new Map<string, RankedSearchCandidate<SkillSearchChunkRow>>();
      const refOf = (row: SkillSearchChunkRow): string =>
        buildSkillReferenceId({
          skillId: row.skillId,
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex
        });
      const upsertRankedCandidate = (
        referenceId: string,
        candidate: RankedSearchCandidate<SkillSearchChunkRow>
      ) => {
        const existing = rankedByReferenceId.get(referenceId);
        if (
          existing === undefined ||
          candidate.score > existing.score ||
          (candidate.score === existing.score && candidate.lexicalScore > existing.lexicalScore)
        ) {
          rankedByReferenceId.set(referenceId, candidate);
        }
      };

      const lexicalRows = await this.loadSkillLexicalRows(
        enabledSkillIds,
        queryInfo.searchTerms,
        retrievalPolicy.lexicalCandidateLimit
      );
      lexicalCandidateCount = lexicalRows.length;
      for (const row of lexicalRows) {
        const { lexicalScore, score, exactTokenHits } = rankStructuredCandidate({
          query: queryInfo,
          title: localizeSkillName(row.skillName),
          filename: row.sourceTitle,
          locator: row.locator,
          content: row.content,
          fieldWeights: { title: 3.2, filename: 3.0, locator: 2.0, content: 1.35, metadata: 0 },
          sourceWeight: 3,
          enableSemanticRerank: true
        });
        if (score <= 0) {
          continue;
        }
        upsertRankedCandidate(refOf(row), {
          row,
          score,
          lexicalScore,
          exactTokenHits,
          dedupeKey: [
            row.sourceId,
            normalizeSearchText(row.locator ?? ""),
            normalizeSearchText(row.content).slice(0, 180)
          ].join(":"),
          groupKey: row.sourceId,
          groupLimit: 2
        });
      }

      let queryEmbedding: number[] | null = null;
      if (retrievalPolicy.embeddingSearchEnabled && embeddingModelKey !== null) {
        try {
          queryEmbedding = ((
            await this.knowledgeEmbeddingService.generateEmbeddings({
              modelKey: embeddingModelKey,
              texts: [normalizedQuery]
            })
          ).embeddings[0] ?? null) as number[] | null;
        } catch {
          queryEmbedding = null;
        }
      }
      retrievalMode = queryEmbedding === null ? "lexical" : "hybrid";
      if (queryEmbedding !== null && embeddingModelKey !== null) {
        // ADR-120 — true pgvector ANN over the unified store scoped to the
        // active Skill ids (the same path documents use; skill chunks are
        // stored with workspaceId null because Skills are platform-owned).
        const vectorHits = await this.knowledgeVectorIndex.searchNearest({
          workspaceId: null,
          embeddingModelKey,
          queryVector: queryEmbedding,
          limit: retrievalPolicy.vectorCandidateLimit,
          sourceTypes: ["skill_document", "skill_knowledge_card"],
          skillIds: enabledSkillIds
        });
        vectorCandidateCount = vectorHits.length;
        const vectorSimilarityByReferenceId = new Map<string, number>();
        for (const hit of vectorHits) {
          if (hit.score <= 0.18) {
            continue;
          }
          const sourceKind =
            hit.sourceType === "skill_knowledge_card" ? "skill_knowledge_card" : "skill_document";
          const referenceId = buildSkillReferenceId({
            skillId: hit.skillId ?? "",
            sourceKind,
            sourceId: hit.sourceId,
            sourceVersion: hit.sourceVersion,
            chunkIndex: hit.chunkIndex
          });
          vectorSimilarityByReferenceId.set(
            referenceId,
            Math.max(vectorSimilarityByReferenceId.get(referenceId) ?? 0, hit.score)
          );
        }
        if (vectorSimilarityByReferenceId.size > 0) {
          const vectorRows = await this.loadSkillRowsForVectorHits(
            enabledSkillIds,
            vectorHits.filter((hit) => hit.score > 0.18)
          );
          for (const row of vectorRows) {
            const referenceId = refOf(row);
            const vectorSimilarity = vectorSimilarityByReferenceId.get(referenceId);
            if (vectorSimilarity === undefined) {
              continue;
            }
            const { lexicalScore, exactTokenHits } = rankStructuredCandidate({
              query: queryInfo,
              title: localizeSkillName(row.skillName),
              filename: row.sourceTitle,
              locator: row.locator,
              content: row.content,
              fieldWeights: { title: 2.2, filename: 2.0, locator: 1.5, content: 1.0, metadata: 0 },
              sourceWeight: 1.5,
              enableSemanticRerank: false
            });
            upsertRankedCandidate(referenceId, {
              row,
              score: vectorSimilarity * 42 + lexicalScore * 0.35,
              lexicalScore: lexicalScore + vectorSimilarity * 10,
              exactTokenHits,
              dedupeKey: [
                row.sourceId,
                normalizeSearchText(row.locator ?? ""),
                normalizeSearchText(row.content).slice(0, 180)
              ].join(":"),
              groupKey: row.sourceId,
              groupLimit: 2
            });
          }
        }
      }

      // ADR-120 Slice 4 discipline — apply the relevance floor, then a
      // narrow-only mandatory rerank. An empty result set is a valid outcome
      // and is never backfilled.
      const candidates = Array.from(rankedByReferenceId.values());
      const topScore = computeTopScore(candidates);
      const ranked = candidates
        .filter((candidate) =>
          passesRelevanceFloor(candidate, {
            topScore,
            queryTokenCount: queryInfo.tokens.length
          })
        )
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (right.lexicalScore !== left.lexicalScore) {
            return right.lexicalScore - left.lexicalScore;
          }
          if (left.row.sourceId !== right.row.sourceId) {
            return left.row.sourceId.localeCompare(right.row.sourceId);
          }
          return left.row.chunkIndex - right.row.chunkIndex;
        });

      let selected = selectRankedCandidates(
        ranked,
        resolveMaxResults(
          input.maxResults,
          retrievalPolicy.defaultMaxResults,
          retrievalPolicy.maxMaxResults
        )
      );
      const helperRanking = await this.knowledgeRetrievalHelperService.rerankCandidates({
        assistantId: input.assistantId,
        query: normalizedQuery,
        candidates: selected.map(({ row }) => ({
          referenceId: refOf(row),
          title: `${localizeSkillName(row.skillName)} / ${row.sourceTitle}`,
          locator: row.locator,
          snippet: buildSnippet(row.content, queryInfo.searchTerms)
        }))
      });
      helperApplied = helperRanking !== null;
      if (helperRanking !== null) {
        const allowedReferenceIds = new Set(helperRanking.rankedReferenceIds);
        const helperRankIndex = new Map(
          helperRanking.rankedReferenceIds.map((referenceId, index) => [referenceId, index])
        );
        selected = selected
          .filter(({ row }) => allowedReferenceIds.has(refOf(row)))
          .sort((left, right) => {
            const leftRank = helperRankIndex.get(refOf(left.row));
            const rightRank = helperRankIndex.get(refOf(right.row));
            if (leftRank === undefined && rightRank === undefined) {
              return right.score - left.score;
            }
            if (leftRank === undefined) {
              return 1;
            }
            if (rightRank === undefined) {
              return -1;
            }
            return leftRank - rightRank;
          });
      }

      const hits: RuntimeKnowledgeSearchHit[] = await Promise.all(
        selected.map(async ({ row, score }) => {
          const baseHit: RuntimeKnowledgeSearchHit = {
            referenceId: refOf(row),
            source: "skill",
            title: `${localizeSkillName(row.skillName)} / ${row.sourceTitle}`,
            locator: row.locator,
            snippet: buildSnippet(row.content, queryInfo.searchTerms),
            score,
            metadata: {
              skillId: row.skillId,
              skillCategory: row.skillCategory,
              skillSourceType: row.sourceKind,
              skillSourceId: row.sourceId,
              sourceVersion: row.sourceVersion,
              chunkIndex: row.chunkIndex,
              mimeType: row.mimeType,
              retrievalMode
            }
          };
          // ADR-120 Slice 6 (D4 atomic-card exception) — a skill_knowledge_card
          // is a self-contained atomic unit; a truncated snippet of a card loses
          // meaning and a fetch would add nothing. Even when smart search is
          // snippet-only (or a normal snippet would truncate), a card hit returns
          // its FULL card text inline, bounded by a safety cap. Documents keep
          // snippet-only behaviour.
          if (row.sourceKind !== "skill_knowledge_card") {
            return baseHit;
          }
          return this.inlineAtomicCardHit({ hit: baseHit, row, retrievalPolicy, adminPolicy });
        })
      );
      const smartTelemetry = resolveSmartSearchTelemetry(hits);
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "skill",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: hits.length,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        helperModelKey: helperRanking?.modelKey ?? null,
        helperProviderKey: helperRanking?.providerKey ?? null,
        helperInputTokens: helperRanking?.usage?.inputTokens ?? null,
        helperOutputTokens: helperRanking?.usage?.outputTokens ?? null,
        helperTotalTokens: helperRanking?.usage?.totalTokens ?? null,
        modeUsed: smartTelemetry.modeUsed,
        bytesReturned: smartTelemetry.bytesReturned
      });
      return hits;
    } catch (error) {
      await this.recordSearchObservability({
        assistantId: input.assistantId,
        source: "skill",
        retrievalMode,
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        lexicalCandidateCount,
        vectorCandidateCount,
        helperApplied,
        embeddingModelKey,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  /**
   * ADR-120 Slice 6 (D4 atomic-card exception) — load the WHOLE card content
   * for a `skill_knowledge_card` hit and inline it. Bounded by a safety cap
   * derived from the plan fetch/inline knobs and hard-capped by the admin
   * `fetchFullModeAbsoluteMaxChars` ceiling. Returns the hit unchanged if the
   * card has no content.
   */
  private async inlineAtomicCardHit(args: {
    hit: RuntimeKnowledgeSearchHit;
    row: SkillSearchChunkRow;
    retrievalPolicy: Awaited<
      ReturnType<KnowledgeModelPolicyService["resolveAssistantRetrievalPolicy"]>
    >;
    adminPolicy: AdminKnowledgeRetrievalPolicyState;
  }): Promise<RuntimeKnowledgeSearchHit> {
    const { hit, row, retrievalPolicy, adminPolicy } = args;
    const cardRows = await this.loadSkillWindowRows(
      {
        skillId: row.skillId,
        sourceKind: "skill_knowledge_card",
        sourceId: row.sourceId,
        sourceVersion: row.sourceVersion,
        chunkIndex: row.chunkIndex
      },
      null
    );
    const fullText = [...cardRows]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((entry) => entry.content.trim())
      .filter((entry) => entry.length > 0)
      .join("\n\n---\n\n");
    if (fullText.length === 0) {
      return hit;
    }
    const cap = Math.min(
      Math.max(retrievalPolicy.fetchMaxChars, retrievalPolicy.smartSearchShortDocChars),
      adminPolicy.fetchFullModeAbsoluteMaxChars
    );
    const { content: inlinedText, truncated } = applyTruncationMarker(fullText, cap);
    const inlinedDocument: RuntimeKnowledgeInlinedDocument = {
      text: inlinedText,
      chars: inlinedText.length,
      truncated
    };
    return { ...hit, inlinedDocument };
  }

  /**
   * ADR-120 Slice 5 — fetch one bounded window of Skill KB content for a
   * `skill:` reference id returned by `searchSkill`. The reference's Skill is
   * re-validated to be enabled/active for the assistant so a stale or
   * cross-skill reference cannot read content the turn is not allowed to see.
   */
  async fetchSkill(input: {
    assistantId: string;
    referenceId: string;
    mode: PersaiRuntimeKnowledgeFetchMode;
    radius: number | null;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const startedAt = Date.now();
    const { retrievalPolicy, adminLimits } = await this.resolveFetchEnvelope(input.assistantId);
    const plan = resolveDocumentFetchPlan(input.mode, input.radius, retrievalPolicy, adminLimits);
    try {
      const reference = parseSkillReferenceId(input.referenceId.trim());
      if (reference === null) {
        throw new BadRequestException("referenceId is invalid.");
      }
      const enabledSkillIds = await this.resolveEnabledSkillIds(input.assistantId);
      if (!enabledSkillIds.includes(reference.skillId)) {
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "skill",
          retrievalMode: "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth: 0,
          fetchedChars: 0,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return null;
      }

      const centerRow = await this.loadSkillChunkRow(reference);
      if (centerRow === null) {
        await this.recordFetchObservability({
          assistantId: input.assistantId,
          source: "skill",
          retrievalMode: "lexical",
          durationMs: Date.now() - startedAt,
          fetchDepth: 0,
          fetchedChars: 0,
          embeddingModelKey: null,
          outcome: "empty"
        });
        return null;
      }

      const windowRows = await this.loadSkillWindowRows(
        reference,
        plan.isFull ? null : plan.radius
      );
      const joined = windowRows
        .map((row) => row.content.trim())
        .filter((row) => row.length > 0)
        .join("\n\n---\n\n");
      const { content, truncated } = applyTruncationMarker(joined, plan.charLimit);
      const document = {
        referenceId: buildSkillReferenceId(reference),
        source: "skill",
        title: `${localizeSkillName(centerRow.skillName)} / ${centerRow.sourceTitle}`,
        locator: centerRow.locator,
        content,
        snippet: buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]),
        modeUsed: plan.modeUsed,
        truncated,
        metadata: {
          skillId: centerRow.skillId,
          skillCategory: centerRow.skillCategory,
          skillSourceType: centerRow.sourceKind,
          skillSourceId: centerRow.sourceId,
          sourceVersion: centerRow.sourceVersion,
          chunkIndex: centerRow.chunkIndex,
          mimeType: centerRow.mimeType,
          windowStartChunkIndex: windowRows[0]?.chunkIndex ?? centerRow.chunkIndex,
          windowEndChunkIndex:
            windowRows[windowRows.length - 1]?.chunkIndex ?? centerRow.chunkIndex,
          modeUsed: plan.modeUsed,
          truncated
        }
      } satisfies RuntimeKnowledgeDocument;
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "skill",
        retrievalMode: centerRow.embeddingModelKey === null ? "lexical" : "hybrid",
        durationMs: Date.now() - startedAt,
        fetchDepth: windowRows.length,
        fetchedChars: content.length,
        embeddingModelKey: centerRow.embeddingModelKey,
        modeUsed: plan.modeUsed,
        bytesReturned: content.length
      });
      return document;
    } catch (error) {
      await this.recordFetchObservability({
        assistantId: input.assistantId,
        source: "skill",
        retrievalMode: "lexical",
        durationMs: Date.now() - startedAt,
        fetchDepth: 0,
        fetchedChars: 0,
        embeddingModelKey: null,
        outcome: "error",
        errorCode: resolveKnowledgeTelemetryErrorCode(error)
      });
      throw error;
    }
  }

  /**
   * ADR-120 Slice 5 — resolve the assistant's enabled/active Skill ids
   * server-side. The pull tool never passes Skill ids; the server is the only
   * authority on which Skills this assistant may read.
   */
  private async resolveEnabledSkillIds(assistantId: string): Promise<string[]> {
    const assignments = await this.prisma.assistantSkillAssignment.findMany({
      where: {
        assistantId,
        status: "active",
        skill: {
          status: "active",
          archivedAt: null
        }
      },
      select: { skillId: true }
    });
    return [...new Set(assignments.map((assignment) => assignment.skillId))];
  }

  private async loadSkillLexicalRows(
    enabledSkillIds: string[],
    searchTerms: string[],
    lexicalCandidateLimit: number
  ): Promise<SkillSearchChunkRow[]> {
    const orFilters = searchTerms.flatMap((term) => [
      { content: { contains: term, mode: "insensitive" as const } },
      { locator: { contains: term, mode: "insensitive" as const } }
    ]);
    const [documentRows, cardRows] = await Promise.all([
      this.prisma.skillDocumentChunk.findMany({
        where: {
          skillId: { in: enabledSkillIds },
          skillDocument: { status: "ready" },
          skill: { status: "active", archivedAt: null },
          OR: orFilters
        },
        include: {
          skillDocument: {
            select: { displayName: true, originalFilename: true, mimeType: true }
          },
          skill: { select: { name: true, category: true } }
        },
        orderBy: [
          { skillId: "asc" },
          { skillDocumentId: "asc" },
          { sourceVersion: "desc" },
          { chunkIndex: "asc" }
        ],
        take: lexicalCandidateLimit
      }),
      this.prisma.skillKnowledgeCardChunk.findMany({
        where: {
          skillId: { in: enabledSkillIds },
          knowledgeCard: { status: "ready", lifecycleStatus: "active" },
          skill: { status: "active", archivedAt: null },
          OR: orFilters
        },
        include: {
          knowledgeCard: { select: { title: true } },
          skill: { select: { name: true, category: true } }
        },
        orderBy: [
          { skillId: "asc" },
          { skillKnowledgeCardId: "asc" },
          { sourceVersion: "desc" },
          { chunkIndex: "asc" }
        ],
        take: lexicalCandidateLimit
      })
    ]);
    return [
      ...documentRows.map((row) =>
        this.toSkillDocumentSearchRow(row as SkillDocumentChunkWithRelations)
      ),
      ...cardRows.map((row) => this.toSkillCardSearchRow(row as SkillCardChunkWithRelations))
    ];
  }

  private async loadSkillRowsForVectorHits(
    enabledSkillIds: string[],
    vectorHits: Array<{
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      chunkIndex: number;
    }>
  ): Promise<SkillSearchChunkRow[]> {
    const documentHits = vectorHits.filter((hit) => hit.sourceType === "skill_document");
    const cardHits = vectorHits.filter((hit) => hit.sourceType === "skill_knowledge_card");
    const [documentRows, cardRows] = await Promise.all([
      documentHits.length === 0
        ? Promise.resolve([])
        : this.prisma.skillDocumentChunk.findMany({
            where: {
              skillId: { in: enabledSkillIds },
              skillDocument: { status: "ready" },
              skill: { status: "active", archivedAt: null },
              OR: documentHits.map((hit) => ({
                skillDocumentId: hit.sourceId,
                sourceVersion: hit.sourceVersion,
                chunkIndex: hit.chunkIndex
              }))
            },
            include: {
              skillDocument: {
                select: { displayName: true, originalFilename: true, mimeType: true }
              },
              skill: { select: { name: true, category: true } }
            }
          }),
      cardHits.length === 0
        ? Promise.resolve([])
        : this.prisma.skillKnowledgeCardChunk.findMany({
            where: {
              skillId: { in: enabledSkillIds },
              knowledgeCard: { status: "ready", lifecycleStatus: "active" },
              skill: { status: "active", archivedAt: null },
              OR: cardHits.map((hit) => ({
                skillKnowledgeCardId: hit.sourceId,
                sourceVersion: hit.sourceVersion,
                chunkIndex: hit.chunkIndex
              }))
            },
            include: {
              knowledgeCard: { select: { title: true } },
              skill: { select: { name: true, category: true } }
            }
          })
    ]);
    return [
      ...documentRows.map((row) =>
        this.toSkillDocumentSearchRow(row as SkillDocumentChunkWithRelations)
      ),
      ...cardRows.map((row) => this.toSkillCardSearchRow(row as SkillCardChunkWithRelations))
    ];
  }

  private async loadSkillChunkRow(reference: {
    skillId: string;
    sourceKind: "skill_document" | "skill_knowledge_card";
    sourceId: string;
    sourceVersion: number;
    chunkIndex: number;
  }): Promise<SkillSearchChunkRow | null> {
    if (reference.sourceKind === "skill_document") {
      const row = await this.prisma.skillDocumentChunk.findFirst({
        where: {
          skillId: reference.skillId,
          skillDocumentId: reference.sourceId,
          sourceVersion: reference.sourceVersion,
          chunkIndex: reference.chunkIndex,
          skillDocument: { status: "ready" },
          skill: { status: "active", archivedAt: null }
        },
        include: {
          skillDocument: {
            select: { displayName: true, originalFilename: true, mimeType: true }
          },
          skill: { select: { name: true, category: true } }
        }
      });
      return row === null
        ? null
        : this.toSkillDocumentSearchRow(row as SkillDocumentChunkWithRelations);
    }
    const row = await this.prisma.skillKnowledgeCardChunk.findFirst({
      where: {
        skillId: reference.skillId,
        skillKnowledgeCardId: reference.sourceId,
        sourceVersion: reference.sourceVersion,
        chunkIndex: reference.chunkIndex,
        knowledgeCard: { status: "ready", lifecycleStatus: "active" },
        skill: { status: "active", archivedAt: null }
      },
      include: {
        knowledgeCard: { select: { title: true } },
        skill: { select: { name: true, category: true } }
      }
    });
    return row === null ? null : this.toSkillCardSearchRow(row as SkillCardChunkWithRelations);
  }

  private async loadSkillWindowRows(
    reference: {
      skillId: string;
      sourceKind: "skill_document" | "skill_knowledge_card";
      sourceId: string;
      sourceVersion: number;
      chunkIndex: number;
    },
    radius: number | null
  ): Promise<Array<{ chunkIndex: number; content: string }>> {
    const chunkIndexFilter =
      radius === null
        ? {}
        : {
            chunkIndex: {
              gte: Math.max(0, reference.chunkIndex - radius),
              lte: reference.chunkIndex + radius
            }
          };
    if (reference.sourceKind === "skill_document") {
      return this.prisma.skillDocumentChunk.findMany({
        where: {
          skillId: reference.skillId,
          skillDocumentId: reference.sourceId,
          sourceVersion: reference.sourceVersion,
          skillDocument: { status: "ready" },
          skill: { status: "active", archivedAt: null },
          ...chunkIndexFilter
        },
        select: { chunkIndex: true, content: true },
        orderBy: [{ chunkIndex: "asc" }]
      });
    }
    return this.prisma.skillKnowledgeCardChunk.findMany({
      where: {
        skillId: reference.skillId,
        skillKnowledgeCardId: reference.sourceId,
        sourceVersion: reference.sourceVersion,
        knowledgeCard: { status: "ready", lifecycleStatus: "active" },
        skill: { status: "active", archivedAt: null },
        ...chunkIndexFilter
      },
      select: { chunkIndex: true, content: true },
      orderBy: [{ chunkIndex: "asc" }]
    });
  }

  private toSkillDocumentSearchRow(row: SkillDocumentChunkWithRelations): SkillSearchChunkRow {
    return {
      sourceKind: "skill_document",
      sourceId: row.skillDocumentId,
      skillId: row.skillId,
      sourceVersion: row.sourceVersion,
      chunkIndex: row.chunkIndex,
      locator: row.locator,
      content: row.content,
      embeddingModelKey: row.embeddingModelKey ?? null,
      sourceTitle: row.skillDocument.displayName ?? row.skillDocument.originalFilename,
      mimeType: row.skillDocument.mimeType,
      skillName: row.skill.name,
      skillCategory: row.skill.category
    };
  }

  private toSkillCardSearchRow(row: SkillCardChunkWithRelations): SkillSearchChunkRow {
    return {
      sourceKind: "skill_knowledge_card",
      sourceId: row.skillKnowledgeCardId,
      skillId: row.skillId,
      sourceVersion: row.sourceVersion,
      chunkIndex: row.chunkIndex,
      locator: row.locator,
      content: row.content,
      embeddingModelKey: row.embeddingModelKey ?? null,
      sourceTitle: row.knowledgeCard.title,
      mimeType: "text/markdown",
      skillName: row.skill.name,
      skillCategory: row.skill.category
    };
  }

  private async recordSearchObservability(params: {
    assistantId: string;
    source: "document" | "global" | "memory" | "chat" | "subscription" | "skill";
    retrievalMode: "lexical" | "hybrid";
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
    outcome?: "success" | "empty" | "error";
    errorCode?: string | null;
    /** ADR-094 — short tag for the chosen response shape. */
    modeUsed?: string | null;
    /** ADR-094 — chars actually returned (inline payload, if any). */
    bytesReturned?: number | null;
  }): Promise<void> {
    const assistant = await this.resolveAssistantKnowledgeContext(params.assistantId);
    if (assistant === null) {
      return;
    }
    await this.knowledgeRetrievalObservabilityService.recordSearch({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      source: params.source,
      retrievalMode: params.retrievalMode,
      durationMs: params.durationMs,
      resultCount: params.resultCount,
      lexicalCandidateCount: params.lexicalCandidateCount,
      vectorCandidateCount: params.vectorCandidateCount,
      helperApplied: params.helperApplied,
      embeddingModelKey: params.embeddingModelKey,
      helperModelKey: params.helperModelKey ?? null,
      helperProviderKey: params.helperProviderKey ?? null,
      helperInputTokens: params.helperInputTokens ?? null,
      helperOutputTokens: params.helperOutputTokens ?? null,
      helperTotalTokens: params.helperTotalTokens ?? null,
      ...(params.outcome === undefined ? {} : { outcome: params.outcome }),
      ...(params.errorCode === undefined ? {} : { errorCode: params.errorCode ?? null }),
      ...(params.modeUsed === undefined ? {} : { modeUsed: params.modeUsed }),
      ...(params.bytesReturned === undefined ? {} : { bytesReturned: params.bytesReturned })
    });
  }

  private async recordFetchObservability(params: {
    assistantId: string;
    source: "document" | "global" | "memory" | "chat" | "subscription" | "skill";
    retrievalMode: "lexical" | "hybrid";
    durationMs: number;
    fetchDepth: number;
    fetchedChars: number;
    embeddingModelKey: string | null;
    outcome?: "success" | "empty" | "error";
    errorCode?: string | null;
    /** ADR-094 — short tag for the fetch mode applied (`short`/`section`/`full`). */
    modeUsed?: string | null;
    /** ADR-094 — chars actually returned to the caller. */
    bytesReturned?: number | null;
  }): Promise<void> {
    const assistant = await this.resolveAssistantKnowledgeContext(params.assistantId);
    if (assistant === null) {
      return;
    }
    await this.knowledgeRetrievalObservabilityService.recordFetch({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      source: params.source,
      retrievalMode: params.retrievalMode,
      durationMs: params.durationMs,
      fetchDepth: params.fetchDepth,
      fetchedChars: params.fetchedChars,
      embeddingModelKey: params.embeddingModelKey,
      ...(params.outcome === undefined ? {} : { outcome: params.outcome }),
      ...(params.errorCode === undefined ? {} : { errorCode: params.errorCode ?? null }),
      ...(params.modeUsed === undefined ? {} : { modeUsed: params.modeUsed }),
      ...(params.bytesReturned === undefined ? {} : { bytesReturned: params.bytesReturned })
    });
  }

  private async resolveAssistantKnowledgeContext(
    assistantId: string
  ): Promise<AssistantKnowledgeContextRow | null> {
    return (await this.prisma.assistant.findUnique({
      where: {
        id: assistantId
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        applyAppliedVersionId: true,
        governance: {
          select: {
            assistantPlanOverrideCode: true,
            quotaPlanCode: true
          }
        }
      }
    })) as AssistantKnowledgeContextRow | null;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    return value as Record<string, unknown>;
  }

  private readRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }
}
