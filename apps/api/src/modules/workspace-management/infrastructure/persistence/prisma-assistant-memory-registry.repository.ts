import { Injectable } from "@nestjs/common";
import { Prisma, type AssistantMemoryRegistryItem as PrismaItem } from "@prisma/client";
import type { AssistantMemoryRegistryItem } from "../../domain/assistant-memory-registry-item.entity";
import type {
  AssistantMemoryRegistryRepository,
  CreateAssistantMemoryRegistryItemInput
} from "../../domain/assistant-memory-registry.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantMemoryRegistryRepository implements AssistantMemoryRegistryRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async create(
    input: CreateAssistantMemoryRegistryItemInput
  ): Promise<AssistantMemoryRegistryItem> {
    const row = await this.prisma.assistantMemoryRegistryItem.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        relatedUserMessageId: input.relatedUserMessageId,
        relatedAssistantMessageId: input.relatedAssistantMessageId,
        summary: input.summary,
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        memoryClass: input.memoryClass,
        kind: input.kind,
        durability: input.durability,
        stability: input.stability,
        confidence: input.confidence
      }
    });

    return this.mapToDomain(row);
  }

  async listActiveByAssistantId(
    assistantId: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        ...(filter?.sourceType === undefined ? {} : { sourceType: filter.sourceType })
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async searchActiveByAssistantId(
    assistantId: string,
    query: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        ...(filter?.sourceType === undefined ? {} : { sourceType: filter.sourceType }),
        summary: {
          contains: query,
          mode: "insensitive"
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async findActiveByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    const row = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: { id, assistantId, forgottenAt: null, supersededAt: null }
    });

    return row ? this.mapToDomain(row) : null;
  }

  async updateSummaryById(
    id: string,
    assistantId: string,
    summary: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    const existing = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: { id, assistantId, forgottenAt: null, supersededAt: null },
      select: { id: true }
    });
    if (existing === null) {
      return null;
    }

    const row = await this.prisma.assistantMemoryRegistryItem.update({
      where: { id },
      data: { summary }
    });
    return this.mapToDomain(row);
  }

  async updateEmbeddingById(
    id: string,
    assistantId: string,
    embedding: number[],
    modelKey: string
  ): Promise<boolean> {
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        id,
        assistantId,
        forgottenAt: null,
        supersededAt: null
      },
      data: {
        embeddingVector: embedding as Prisma.InputJsonValue,
        embeddingModelKey: modelKey,
        embeddingGeneratedAt: new Date()
      }
    });
    return result.count > 0;
  }

  async markForgottenById(id: string, assistantId: string): Promise<boolean> {
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: { id, assistantId, forgottenAt: null, supersededAt: null },
      data: { forgottenAt: new Date() }
    });

    return result.count > 0;
  }

  async markSupersededById(
    id: string,
    assistantId: string,
    supersededByMemoryId: string | null
  ): Promise<boolean> {
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        id,
        assistantId,
        forgottenAt: null,
        supersededAt: null
      },
      data: {
        supersededAt: new Date(),
        supersededByMemoryId
      }
    });

    return result.count > 0;
  }

  async listActiveForConsolidation(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async markForgottenForMessages(
    assistantId: string,
    filters: { assistantMessageId: string; userMessageId: string | null }
  ): Promise<number> {
    const or: Array<Record<string, string>> = [
      { relatedAssistantMessageId: filters.assistantMessageId }
    ];
    if (filters.userMessageId !== null) {
      or.push({ relatedUserMessageId: filters.userMessageId });
    }

    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        OR: or
      },
      data: { forgottenAt: new Date() }
    });

    return result.count;
  }

  async listActiveCoreByAssistantId(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        memoryClass: "core"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async countActiveCoreByAssistantId(assistantId: string): Promise<number> {
    return this.prisma.assistantMemoryRegistryItem.count({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        memoryClass: "core"
      }
    });
  }

  async demoteOldestCoreByAssistantId(assistantId: string, count: number): Promise<number> {
    if (count <= 0) {
      return 0;
    }
    const candidates = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        memoryClass: "core"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: count,
      select: { id: true }
    });
    if (candidates.length === 0) {
      return 0;
    }
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        memoryClass: "core",
        forgottenAt: null,
        supersededAt: null
      },
      data: { memoryClass: "contextual" }
    });
    return result.count;
  }

  async findActiveByNormalizedSummaryAndAssistantId(
    assistantId: string,
    normalizedSummary: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    if (normalizedSummary.length === 0) {
      return null;
    }
    const row = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        summary: { equals: normalizedSummary, mode: "insensitive" }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return row ? this.mapToDomain(row) : null;
  }

  async bumpLastUsedAt(assistantId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        assistantId,
        forgottenAt: null,
        supersededAt: null,
        id: { in: [...ids] }
      },
      data: { lastUsedAt: new Date() }
    });
    return result.count;
  }

  async findActiveOpenLoopsByAssistantUser(
    assistantId: string,
    userId: string,
    sinceCreatedAt: Date,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        userId,
        kind: "open_loop",
        forgottenAt: null,
        supersededAt: null,
        resolvedAt: null,
        createdAt: { gte: sinceCreatedAt }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async findLatestActiveOpenLoopsByAssistantUser(
    assistantId: string,
    userId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        userId,
        kind: "open_loop",
        forgottenAt: null,
        supersededAt: null,
        resolvedAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async countActiveOpenLoopsByAssistantUser(assistantId: string, userId: string): Promise<number> {
    return this.prisma.assistantMemoryRegistryItem.count({
      where: {
        assistantId,
        userId,
        kind: "open_loop",
        forgottenAt: null,
        supersededAt: null,
        resolvedAt: null
      }
    });
  }

  async setResolvedAtById(id: string, assistantId: string): Promise<boolean> {
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        id,
        assistantId,
        kind: "open_loop",
        forgottenAt: null,
        supersededAt: null,
        resolvedAt: null
      },
      data: { resolvedAt: new Date() }
    });
    return result.count > 0;
  }

  async findMostSimilarActiveOpenLoop(
    assistantId: string,
    userId: string,
    referenceText: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    const referenceTokens = tokenizeForLexicalMatch(referenceText);
    if (referenceTokens.size === 0) {
      return null;
    }
    // M3 keeps this lookup deliberately simple (no vector round-trip): pull
    // the recent active open-loops and rank by token-overlap in memory. The
    // candidate window is bounded by `MAX_CLOSE_CANDIDATES` so we never page
    // through the whole history; M3.1 will replace this path with a
    // structured close-by-id action that does not need scoring at all.
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        userId,
        kind: "open_loop",
        forgottenAt: null,
        supersededAt: null,
        resolvedAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_CLOSE_CANDIDATES
    });
    if (rows.length === 0) {
      return null;
    }

    let bestRow: PrismaItem | null = null;
    let bestScore = 0;
    for (const row of rows) {
      const candidateTokens = tokenizeForLexicalMatch(row.summary);
      if (candidateTokens.size === 0) {
        continue;
      }
      let overlap = 0;
      for (const token of referenceTokens) {
        if (candidateTokens.has(token)) {
          overlap++;
        }
      }
      if (overlap > bestScore) {
        bestScore = overlap;
        bestRow = row;
      }
    }
    if (bestRow === null || bestScore < MIN_CLOSE_TOKEN_OVERLAP) {
      return null;
    }
    return this.mapToDomain(bestRow);
  }

  private mapToDomain(row: PrismaItem): AssistantMemoryRegistryItem {
    return {
      id: row.id,
      assistantId: row.assistantId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      chatId: row.chatId,
      relatedUserMessageId: row.relatedUserMessageId,
      relatedAssistantMessageId: row.relatedAssistantMessageId,
      summary: row.summary,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
      memoryClass: row.memoryClass,
      kind: row.kind,
      durability: row.durability,
      stability: row.stability,
      confidence: row.confidence,
      embeddingVector: parseEmbeddingVector(row.embeddingVector),
      embeddingModelKey: normalizeOptionalString(row.embeddingModelKey),
      embeddingGeneratedAt: row.embeddingGeneratedAt,
      lastUsedAt: row.lastUsedAt,
      resolvedAt: row.resolvedAt,
      forgottenAt: row.forgottenAt,
      supersededAt: row.supersededAt,
      supersededByMemoryId: row.supersededByMemoryId,
      createdAt: row.createdAt
    };
  }
}

// ADR-074 Slice M3 — bound the candidate window for the `closeOpenLoop`
// flag's lexical match so a runaway scan can never starve the request path.
// M3.1 will replace this scoring path with a structured close-by-id action.
const MAX_CLOSE_CANDIDATES = 50;
const MIN_CLOSE_TOKEN_OVERLAP = 1;
const LEXICAL_TOKEN_MIN_LENGTH = 3;
const LEXICAL_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "have",
  "has",
  "had",
  "was",
  "are",
  "but",
  "not",
  "you",
  "your",
  "user",
  "open",
  "loop"
]);

function tokenizeForLexicalMatch(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const rawToken of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (rawToken.length < LEXICAL_TOKEN_MIN_LENGTH) {
      continue;
    }
    if (LEXICAL_TOKEN_STOPWORDS.has(rawToken)) {
      continue;
    }
    tokens.add(rawToken);
  }
  return tokens;
}

function parseEmbeddingVector(value: Prisma.JsonValue | null): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.filter((entry): entry is number => typeof entry === "number");
  return parsed.length === value.length ? parsed : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
