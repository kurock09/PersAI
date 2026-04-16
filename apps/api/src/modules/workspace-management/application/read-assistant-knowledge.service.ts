import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeKnowledgeDocument, RuntimeKnowledgeSearchHit } from "@persai/runtime-contract";
import { PERSAI_GLOBAL_KNOWLEDGE_DOCUMENTS } from "./persai-global-knowledge";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const DEFAULT_KNOWLEDGE_SEARCH_MAX_RESULTS = 5;
const MAX_KNOWLEDGE_SEARCH_MAX_RESULTS = 8;
const KNOWLEDGE_SEARCH_CANDIDATE_LIMIT = 60;
const KNOWLEDGE_FETCH_WINDOW_RADIUS = 1;
const CHAT_FETCH_WINDOW_RADIUS = 2;
const KNOWLEDGE_FETCH_MAX_CHARS = 6_000;
const KNOWLEDGE_SEARCH_SNIPPET_MAX_CHARS = 320;
const KNOWLEDGE_SEARCH_SEMANTIC_CONTENT_MAX_CHARS = 2_000;
const SUPPORTED_KNOWLEDGE_SOURCES = [
  "document",
  "memory",
  "chat",
  "preset",
  "subscription",
  "global"
] as const;
const NON_PRODUCT_TOOL_CODES = new Set(["memory_search", "memory_get", "cron"]);

type SearchSourceRow = {
  knowledgeSourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  knowledgeSource: {
    id: string;
    namespace: string;
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
};

type MemoryRegistryRow = {
  id: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
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

type TextKnowledgeSource = "preset" | "subscription" | "global";

type TextKnowledgeDocumentRow = {
  referenceId: string;
  source: TextKnowledgeSource;
  title: string;
  locator: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
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

type MaterializedPresetRow = {
  publishedVersionId: string;
  layersDocument: string;
  runtimeBundleDocument: string | null;
  createdAt: Date;
};

type PromptTemplateRow = {
  id: string;
  template: string;
  updatedAt: Date;
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
    mediaClasses: unknown;
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

type ToolCatalogKnowledgeRow = {
  code: string;
  displayName: string;
  description: string | null;
  toolClass: string;
  capabilityGroup: string;
  status: "active" | "inactive";
  updatedAt: Date;
};

type WorkspaceSubscriptionKnowledgeRow = {
  planCode: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
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

function resolveMaxResults(maxResults: number | null | undefined): number {
  return Math.min(
    maxResults ?? DEFAULT_KNOWLEDGE_SEARCH_MAX_RESULTS,
    MAX_KNOWLEDGE_SEARCH_MAX_RESULTS
  );
}

function scoreFieldMatch(params: {
  text: string | null | undefined;
  query: SearchQueryInfo;
  weight: number;
  lengthNormalize: boolean;
}): number {
  const sourceText = params.text?.trim() ?? "";
  if (sourceText.length === 0) {
    return 0;
  }

  const normalized = normalizeSearchText(sourceText);
  const words = tokenizeWords(sourceText);
  const counts = buildTokenCounts(words);
  let score = 0;

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

  return score;
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
}): { lexicalScore: number; score: number } {
  const weights: SearchFieldWeights = {
    title: 3.4,
    filename: 3.0,
    locator: 2.1,
    content: 1.4,
    metadata: 1.1,
    ...params.fieldWeights
  };

  const lexicalScore =
    scoreFieldMatch({
      text: params.title,
      query: params.query,
      weight: weights.title,
      lengthNormalize: false
    }) +
    scoreFieldMatch({
      text: params.filename,
      query: params.query,
      weight: weights.filename,
      lengthNormalize: false
    }) +
    scoreFieldMatch({
      text: params.locator,
      query: params.query,
      weight: weights.locator,
      lengthNormalize: false
    }) +
    scoreFieldMatch({
      text: params.content,
      query: params.query,
      weight: weights.content,
      lengthNormalize: true
    }) +
    scoreFieldMatch({
      text: params.metadataText,
      query: params.query,
      weight: weights.metadata,
      lengthNormalize: false
    }) +
    (params.sourceWeight ?? 0) +
    (params.recencyBonus ?? 0);

  if (lexicalScore <= 0) {
    return { lexicalScore, score: lexicalScore };
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
    score: lexicalScore + semanticBonus
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
  if (row.source === "preset") {
    if (row.referenceId === "preset:current:runtime-bundle") {
      return 12;
    }
    if (row.referenceId === "preset:current:layers") {
      return 11;
    }
    return 4;
  }
  if (row.source === "subscription") {
    return 10;
  }
  if (row.referenceId.startsWith("global:product:")) {
    return 12;
  }
  if (row.referenceId.startsWith("global:plan:")) {
    return 8;
  }
  if (row.referenceId.startsWith("global:tool:")) {
    return 7;
  }
  return 6;
}

function searchTextKnowledgeDocuments(params: {
  documents: TextKnowledgeDocumentRow[];
  query: string;
  maxResults: number | null;
}): RuntimeKnowledgeSearchHit[] {
  const normalizedQuery = params.query.trim();
  if (normalizedQuery.length === 0) {
    throw new BadRequestException("query is required.");
  }

  const queryInfo = buildSearchQueryInfo(normalizedQuery);
  const ranked = params.documents
    .map((row) => {
      const { lexicalScore, score } = rankStructuredCandidate({
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
        dedupeKey: row.referenceId,
        groupKey: null,
        groupLimit: null
      } satisfies RankedSearchCandidate<TextKnowledgeDocumentRow>;
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }
      return left.row.referenceId.localeCompare(right.row.referenceId);
    });

  const selected = selectRankedCandidates(ranked, resolveMaxResults(params.maxResults));
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

function buildChatWindowContent(rows: Array<Pick<ChatMessageRow, "author" | "content">>): string {
  return rows
    .map((row) => {
      const content = row.content.trim();
      return content.length > 0 ? `${resolveChatAuthorLabel(row.author)}: ${content}` : null;
    })
    .filter((row): row is string => row !== null)
    .join("\n\n")
    .slice(0, KNOWLEDGE_FETCH_MAX_CHARS);
}

function isSupportedKnowledgeSource(
  source: string
): source is (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number] {
  return SUPPORTED_KNOWLEDGE_SOURCES.includes(
    source as (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number]
  );
}

function toTextKnowledgeDocument(row: TextKnowledgeDocumentRow): RuntimeKnowledgeDocument {
  return {
    referenceId: row.referenceId,
    source: row.source,
    title: row.title,
    locator: row.locator,
    content: row.content.slice(0, KNOWLEDGE_FETCH_MAX_CHARS),
    snippet: buildSnippet(row.content, [row.title, row.locator ?? "", row.content.slice(0, 80)]),
    metadata: row.metadata
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
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

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
        "Only document, memory, chat, preset, subscription, and global knowledge search are currently available."
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
  } {
    const row = this.asObject(body);
    const assistantId = this.readRequiredString(row.assistantId, "assistantId");
    const source = this.readRequiredString(row.source, "source");
    const referenceId = this.readRequiredString(row.referenceId, "referenceId");
    if (!isSupportedKnowledgeSource(source)) {
      throw new BadRequestException(
        "Only document, memory, chat, preset, subscription, and global knowledge fetch are currently available."
      );
    }

    return {
      assistantId,
      source,
      referenceId
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
    if (input.source === "preset") {
      return this.searchPresets(input);
    }
    if (input.source === "subscription") {
      return this.searchSubscription(input);
    }
    return this.searchGlobal(input);
  }

  async fetch(input: {
    assistantId: string;
    source: (typeof SUPPORTED_KNOWLEDGE_SOURCES)[number];
    referenceId: string;
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
    if (input.source === "preset") {
      return this.fetchPreset(input);
    }
    if (input.source === "subscription") {
      return this.fetchSubscription(input);
    }
    return this.fetchGlobal(input);
  }

  async searchDocuments(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }

    const queryInfo = buildSearchQueryInfo(normalizedQuery);
    const rows = (await this.prisma.assistantKnowledgeSourceChunk.findMany({
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
      take: KNOWLEDGE_SEARCH_CANDIDATE_LIMIT
    })) as SearchSourceRow[];

    const ranked = rows
      .map((row) => {
        const { lexicalScore, score } = rankStructuredCandidate({
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
        return {
          row,
          score,
          lexicalScore,
          dedupeKey: [
            row.knowledgeSourceId,
            normalizeSearchText(row.locator ?? ""),
            normalizeSearchText(row.content).slice(0, 180)
          ].join(":"),
          groupKey: row.knowledgeSourceId,
          groupLimit: 2
        } satisfies RankedSearchCandidate<SearchSourceRow>;
      })
      .filter((row) => row.score > 0)
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

    return selectRankedCandidates(ranked, resolveMaxResults(input.maxResults)).map(
      ({ row, score }) => ({
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
          chunkIndex: row.chunkIndex
        }
      })
    );
  }

  async searchMemory(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }

    const queryInfo = buildSearchQueryInfo(normalizedQuery);
    const rows = (await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId: input.assistantId,
        forgottenAt: null,
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
      take: KNOWLEDGE_SEARCH_CANDIDATE_LIMIT
    })) as MemoryRegistryRow[];

    const recencyBonus = buildRelativeRecencyResolver({
      rows,
      halfLifeDays: 14,
      maxBonus: 8
    });
    const ranked = rows
      .map((row) => {
        const { lexicalScore, score } = rankStructuredCandidate({
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
          dedupeKey: `${row.sourceType}:${normalizeSearchText(row.summary)}`,
          groupKey: row.chatId,
          groupLimit: row.chatId === null ? null : 2
        } satisfies RankedSearchCandidate<MemoryRegistryRow>;
      })
      .filter((row) => row.score > 0)
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

    return selectRankedCandidates(ranked, resolveMaxResults(input.maxResults)).map(
      ({ row, score }) => ({
        referenceId: buildMemoryReferenceId(row.id),
        source: "memory",
        title: resolveMemoryTitle(row),
        locator: resolveMemoryLocator(row),
        snippet: buildSnippet(row.summary, queryInfo.searchTerms),
        score,
        metadata: {
          memoryItemId: row.id,
          sourceType: row.sourceType,
          chatId: row.chatId,
          relatedUserMessageId: row.relatedUserMessageId,
          relatedAssistantMessageId: row.relatedAssistantMessageId,
          createdAt: row.createdAt.toISOString()
        }
      })
    );
  }

  async searchChats(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException("query is required.");
    }

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
      take: KNOWLEDGE_SEARCH_CANDIDATE_LIMIT
    })) as ChatMessageRow[];

    const recencyBonus = buildRelativeRecencyResolver({
      rows,
      halfLifeDays: 7,
      maxBonus: 10
    });
    const ranked = rows
      .map((row) => {
        const { lexicalScore, score } = rankStructuredCandidate({
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
          dedupeKey: `${row.chatId}:${normalizeSearchText(row.content)}`,
          groupKey: row.chatId,
          groupLimit: 2
        } satisfies RankedSearchCandidate<ChatMessageRow>;
      })
      .filter((row) => row.score > 0)
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

    return selectRankedCandidates(ranked, resolveMaxResults(input.maxResults)).map(
      ({ row, score }) => ({
        referenceId: buildChatReferenceId({
          chatId: row.chatId,
          messageId: row.id
        }),
        source: "chat",
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
      })
    );
  }

  async searchPresets(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const documents = await this.loadPresetKnowledgeDocuments(input.assistantId);
    return searchTextKnowledgeDocuments({
      documents,
      query: input.query,
      maxResults: input.maxResults
    });
  }

  async searchSubscription(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    const documents = await this.loadSubscriptionKnowledgeDocuments(input.assistantId);
    return searchTextKnowledgeDocuments({
      documents,
      query: input.query,
      maxResults: input.maxResults
    });
  }

  async searchGlobal(input: {
    assistantId: string;
    query: string;
    maxResults: number | null;
  }): Promise<RuntimeKnowledgeSearchHit[]> {
    void input.assistantId;
    const documents = await this.loadGlobalKnowledgeDocuments();
    return searchTextKnowledgeDocuments({
      documents,
      query: input.query,
      maxResults: input.maxResults
    });
  }

  async fetchDocument(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
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
      return null;
    }

    const surroundingRows = await this.prisma.assistantKnowledgeSourceChunk.findMany({
      where: {
        assistantId: input.assistantId,
        knowledgeSourceId: reference.knowledgeSourceId,
        sourceVersion: reference.sourceVersion,
        chunkIndex: {
          gte: Math.max(0, reference.chunkIndex - KNOWLEDGE_FETCH_WINDOW_RADIUS),
          lte: reference.chunkIndex + KNOWLEDGE_FETCH_WINDOW_RADIUS
        }
      },
      orderBy: [{ chunkIndex: "asc" }]
    });

    const content = surroundingRows
      .map((row) => row.content.trim())
      .filter((row) => row.length > 0)
      .join("\n\n---\n\n")
      .slice(0, KNOWLEDGE_FETCH_MAX_CHARS);

    return {
      referenceId: buildDocumentReferenceId(reference),
      source: "document",
      title: centerRow.knowledgeSource.displayName ?? centerRow.knowledgeSource.originalFilename,
      locator: centerRow.locator,
      content,
      snippet: buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]),
      metadata: {
        knowledgeSourceId: centerRow.knowledgeSource.id,
        namespace: centerRow.knowledgeSource.namespace,
        mimeType: centerRow.knowledgeSource.mimeType,
        originalFilename: centerRow.knowledgeSource.originalFilename,
        sourceVersion: centerRow.sourceVersion,
        chunkIndex: centerRow.chunkIndex,
        windowStartChunkIndex: surroundingRows[0]?.chunkIndex ?? centerRow.chunkIndex,
        windowEndChunkIndex:
          surroundingRows[surroundingRows.length - 1]?.chunkIndex ?? centerRow.chunkIndex
      }
    };
  }

  async fetchMemory(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
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
      return null;
    }

    return {
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
    };
  }

  async fetchChat(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
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
      return null;
    }

    const [beforeRows, afterRows] = (await Promise.all([
      this.prisma.assistantChatMessage.findMany({
        where: {
          assistantId: input.assistantId,
          chatId: centerRow.chatId,
          author: {
            in: ["user", "assistant"]
          },
          OR: [
            {
              createdAt: {
                lt: centerRow.createdAt
              }
            },
            {
              createdAt: {
                equals: centerRow.createdAt
              },
              id: {
                lt: centerRow.id
              }
            }
          ]
        },
        select: {
          id: true,
          author: true,
          content: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: CHAT_FETCH_WINDOW_RADIUS
      }),
      this.prisma.assistantChatMessage.findMany({
        where: {
          assistantId: input.assistantId,
          chatId: centerRow.chatId,
          author: {
            in: ["user", "assistant"]
          },
          OR: [
            {
              createdAt: {
                gt: centerRow.createdAt
              }
            },
            {
              createdAt: {
                equals: centerRow.createdAt
              },
              id: {
                gt: centerRow.id
              }
            }
          ]
        },
        select: {
          id: true,
          author: true,
          content: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: CHAT_FETCH_WINDOW_RADIUS
      })
    ])) as [ChatMessageWindowRow[], ChatMessageWindowRow[]];

    const windowRows: ChatMessageWindowRow[] = [...beforeRows.reverse(), centerRow, ...afterRows];

    return {
      referenceId: buildChatReferenceId(reference),
      source: "chat",
      title: resolveChatTitle(centerRow.chat),
      locator: resolveChatLocator(centerRow),
      content: buildChatWindowContent(windowRows),
      snippet:
        buildSnippet(centerRow.content, [centerRow.content.slice(0, 80)]) ??
        centerRow.content.trim(),
      metadata: {
        chatId: centerRow.chatId,
        messageId: centerRow.id,
        author: centerRow.author,
        surface: centerRow.chat.surface,
        surfaceThreadKey: centerRow.chat.surfaceThreadKey,
        archivedAt: centerRow.chat.archivedAt?.toISOString() ?? null,
        createdAt: centerRow.createdAt.toISOString(),
        windowStartMessageId: windowRows[0]?.id ?? centerRow.id,
        windowEndMessageId: windowRows[windowRows.length - 1]?.id ?? centerRow.id
      }
    };
  }

  async fetchPreset(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const referenceId = input.referenceId.trim();
    const document = (await this.loadPresetKnowledgeDocuments(input.assistantId)).find(
      (row) => row.referenceId === referenceId
    );
    return document === undefined ? null : toTextKnowledgeDocument(document);
  }

  async fetchSubscription(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
    const referenceId = input.referenceId.trim();
    const document = (await this.loadSubscriptionKnowledgeDocuments(input.assistantId)).find(
      (row) => row.referenceId === referenceId
    );
    return document === undefined ? null : toTextKnowledgeDocument(document);
  }

  async fetchGlobal(input: {
    assistantId: string;
    referenceId: string;
  }): Promise<RuntimeKnowledgeDocument | null> {
    void input.assistantId;
    const referenceId = input.referenceId.trim();
    const document = (await this.loadGlobalKnowledgeDocuments()).find(
      (row) => row.referenceId === referenceId
    );
    return document === undefined ? null : toTextKnowledgeDocument(document);
  }

  private async loadPresetKnowledgeDocuments(
    assistantId: string
  ): Promise<TextKnowledgeDocumentRow[]> {
    const [assistant, promptTemplates] = await Promise.all([
      this.resolveAssistantKnowledgeContext(assistantId),
      this.prisma.promptTemplate.findMany({
        orderBy: [{ id: "asc" }]
      })
    ]);
    const documents: TextKnowledgeDocumentRow[] = (
      (promptTemplates ?? []) as PromptTemplateRow[]
    ).map((preset) => ({
      referenceId: `preset:template:${preset.id}`,
      source: "preset",
      title: `Prompt Template: ${preset.id}`,
      locator: `prompt-template:${preset.id}`,
      content: preset.template,
      metadata: {
        templateId: preset.id,
        updatedAt: preset.updatedAt.toISOString(),
        kind: "bootstrap_template"
      }
    }));

    if (assistant?.applyAppliedVersionId) {
      const materializedSpec = (await this.prisma.assistantMaterializedSpec.findFirst({
        where: {
          assistantId,
          publishedVersionId: assistant.applyAppliedVersionId
        },
        select: {
          publishedVersionId: true,
          layersDocument: true,
          runtimeBundleDocument: true,
          createdAt: true
        }
      })) as MaterializedPresetRow | null;

      if (materializedSpec !== null) {
        documents.unshift({
          referenceId: "preset:current:layers",
          source: "preset",
          title: "Current Assistant Layers",
          locator: `published-version:${materializedSpec.publishedVersionId}`,
          content: materializedSpec.layersDocument,
          metadata: {
            kind: "layers_document",
            publishedVersionId: materializedSpec.publishedVersionId,
            createdAt: materializedSpec.createdAt.toISOString()
          }
        });
        if (
          materializedSpec.runtimeBundleDocument !== null &&
          materializedSpec.runtimeBundleDocument.trim().length > 0
        ) {
          documents.unshift({
            referenceId: "preset:current:runtime-bundle",
            source: "preset",
            title: "Current Runtime Bundle",
            locator: `published-version:${materializedSpec.publishedVersionId}:runtime-bundle`,
            content: materializedSpec.runtimeBundleDocument,
            metadata: {
              kind: "runtime_bundle_document",
              publishedVersionId: materializedSpec.publishedVersionId,
              createdAt: materializedSpec.createdAt.toISOString()
            }
          });
        }
      }
    }

    return documents;
  }

  private async loadSubscriptionKnowledgeDocuments(
    assistantId: string
  ): Promise<TextKnowledgeDocumentRow[]> {
    const assistant = await this.resolveAssistantKnowledgeContext(assistantId);
    if (assistant === null) {
      return [];
    }

    const workspaceSubscription = (await this.prisma.workspaceSubscription.findUnique({
      where: {
        workspaceId: assistant.workspaceId
      },
      select: {
        planCode: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEndsAt: true,
        cancelAtPeriodEnd: true
      }
    })) as WorkspaceSubscriptionKnowledgeRow | null;

    let effectiveSource = "none";
    let effectiveStatus = "unconfigured";
    let planCode: string | null = null;
    let trialEndsAt: string | null = null;
    let currentPeriodEndsAt: string | null = null;
    let cancelAtPeriodEnd = false;

    if (assistant.governance?.assistantPlanOverrideCode) {
      effectiveSource = "assistant_plan_override";
      effectiveStatus = "unconfigured";
      planCode = assistant.governance.assistantPlanOverrideCode;
    } else if (workspaceSubscription !== null) {
      effectiveSource = "workspace_subscription";
      effectiveStatus = workspaceSubscription.status;
      planCode = workspaceSubscription.planCode;
      trialEndsAt = workspaceSubscription.trialEndsAt?.toISOString() ?? null;
      currentPeriodEndsAt = workspaceSubscription.currentPeriodEndsAt?.toISOString() ?? null;
      cancelAtPeriodEnd = workspaceSubscription.cancelAtPeriodEnd;
    } else if (assistant.governance?.quotaPlanCode) {
      effectiveSource = "assistant_plan_fallback";
      effectiveStatus = "unconfigured";
      planCode = assistant.governance.quotaPlanCode;
    } else {
      const defaultPlan = await this.prisma.planCatalogPlan.findFirst({
        where: {
          isDefaultFirstRegistrationPlan: true,
          status: "active"
        },
        select: {
          code: true
        }
      });
      if (defaultPlan !== null) {
        effectiveSource = "catalog_default_fallback";
        effectiveStatus = "unconfigured";
        planCode = defaultPlan.code;
      }
    }

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

  private async loadGlobalKnowledgeDocuments(): Promise<TextKnowledgeDocumentRow[]> {
    const [plans, tools] = await Promise.all([
      this.prisma.planCatalogPlan.findMany({
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
      }),
      this.prisma.toolCatalogTool.findMany({
        where: {
          status: "active"
        },
        orderBy: [{ displayName: "asc" }]
      })
    ]);

    const documents: TextKnowledgeDocumentRow[] = PERSAI_GLOBAL_KNOWLEDGE_DOCUMENTS.map(
      (document) => ({
        referenceId: document.referenceId,
        source: "global",
        title: document.title,
        locator: document.locator,
        content: document.content,
        metadata: document.metadata
      })
    );

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

    for (const tool of (tools as ToolCatalogKnowledgeRow[]).filter(
      (row) => !NON_PRODUCT_TOOL_CODES.has(row.code)
    )) {
      documents.push({
        referenceId: `global:tool:${tool.code}`,
        source: "global",
        title: `Tool: ${tool.displayName}`,
        locator: `tool:${tool.code}`,
        content: [
          `# ${tool.displayName}`,
          `- Code: ${tool.code}`,
          `- Capability group: ${tool.capabilityGroup}`,
          `- Tool class: ${tool.toolClass}`,
          tool.description ? `Description:\n${tool.description}` : null
        ]
          .filter((row): row is string => row !== null)
          .join("\n\n"),
        metadata: {
          kind: "tool_catalog",
          code: tool.code,
          capabilityGroup: tool.capabilityGroup,
          toolClass: tool.toolClass,
          updatedAt: tool.updatedAt.toISOString()
        }
      });
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
              `Media classes:\n${formatJsonValue(params.plan.entitlement.mediaClasses)}`,
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
