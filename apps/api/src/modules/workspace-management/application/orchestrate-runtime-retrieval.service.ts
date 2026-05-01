import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  RuntimeRetrievedKnowledgeContext,
  RuntimeRetrievedKnowledgeContextItem,
  RuntimeRetrievedKnowledgeSourceLabel,
  RuntimeRetrievalPlan
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { KnowledgeRetrievalObservabilityService } from "./knowledge-retrieval-observability.service";
import { ReadAssistantKnowledgeService } from "./read-assistant-knowledge.service";

const MAX_CONTEXT_ITEMS = 6;
const MAX_ITEM_CHARS = 1_200;
const MAX_RENDERED_BLOCK_CHARS = 6_000;
const MAX_PER_SOURCE_RESULTS = 3;

type RuntimeRetrievalInput = {
  assistantId: string;
  query: string;
  locale: string | null;
  retrievalPlan: RuntimeRetrievalPlan;
};

type OrchestratedRetrievalTelemetrySource = "skill" | "document" | "product" | "web";

type SkillChunkRow = {
  skillDocumentId: string;
  skillId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  skillDocument: {
    id: string;
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
    status: string;
  };
  skill: {
    id: string;
    name: unknown;
    category: string;
  };
};

@Injectable()
export class OrchestrateRuntimeRetrievalService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly readAssistantKnowledgeService: ReadAssistantKnowledgeService,
    private readonly knowledgeRetrievalObservabilityService: KnowledgeRetrievalObservabilityService
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
      items.push(
        ...(await this.withTelemetry({
          workspaceId,
          assistantId: input.assistantId,
          source: "skill",
          execute: () => this.searchSkillReferences(input)
        }))
      );
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
    input: RuntimeRetrievalInput
  ): Promise<RuntimeRetrievedKnowledgeContextItem[]> {
    const enabledSkillIds = await this.resolveEnabledSkillIds(input);
    if (enabledSkillIds.length === 0) {
      return [];
    }
    const terms = this.buildSearchTerms(input.query);
    const rows = (await this.prisma.skillDocumentChunk.findMany({
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
      take: 40
    })) as SkillChunkRow[];
    return rows
      .map((row) => ({
        row,
        score: this.scoreText(row.content, input.query) + (row.skillDocument.displayName ? 3 : 0)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_PER_SOURCE_RESULTS)
      .map(({ row, score }) => ({
        label: "skill_reference" as const,
        referenceId: `skill:${row.skillId}:document:${row.skillDocumentId}:${String(row.sourceVersion)}:${String(row.chunkIndex)}`,
        title: `${this.localize(row.skill.name, input.locale)} / ${
          row.skillDocument.displayName ?? row.skillDocument.originalFilename
        }`,
        locator: row.locator,
        content: this.truncate(row.content, MAX_ITEM_CHARS),
        score,
        metadata: {
          skillId: row.skillId,
          skillCategory: row.skill.category,
          skillDocumentId: row.skillDocumentId,
          sourceVersion: row.sourceVersion,
          chunkIndex: row.chunkIndex,
          mimeType: row.skillDocument.mimeType
        }
      }));
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
  }): Promise<void> {
    if (input.workspaceId === null) {
      return;
    }
    await this.knowledgeRetrievalObservabilityService.recordSearch({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      source: input.source,
      retrievalMode: "hybrid",
      durationMs: input.durationMs,
      resultCount: input.resultCount,
      lexicalCandidateCount: input.resultCount,
      vectorCandidateCount: 0,
      helperApplied: false,
      embeddingModelKey: null,
      outcome: input.outcome,
      errorCode: input.errorCode
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
