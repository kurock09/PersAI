import assert from "node:assert/strict";
import { OrchestrateRuntimeRetrievalService } from "../src/modules/workspace-management/application/orchestrate-runtime-retrieval.service";

const skillChunks = [
  {
    skillDocumentId: "doc-1",
    skillId: "skill-accounting",
    workspaceId: "workspace-1",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "tax#1",
    content: "Professional tax review requires checking deductible expenses against local rules.",
    skillDocument: {
      id: "doc-1",
      displayName: "Tax Review Guide",
      originalFilename: "tax-review.md",
      mimeType: "text/markdown",
      status: "ready"
    },
    skill: {
      id: "skill-accounting",
      name: { en: "Accounting" },
      category: "finance"
    }
  }
];

class FakeReadAssistantKnowledgeService {
  searches: Array<Record<string, unknown>> = [];
  fetches: Array<Record<string, unknown>> = [];

  async search(input: Record<string, unknown>) {
    this.searches.push(input);
    if (input.source === "document") {
      return [
        {
          referenceId: "source-1:1:0",
          source: "document",
          title: "User Tax File",
          locator: "p1",
          snippet: "User project deductible expenses list.",
          score: 9,
          metadata: { knowledgeSourceId: "source-1" }
        }
      ];
    }
    if (input.source === "global") {
      return [
        {
          referenceId: "global:product:overview",
          source: "global",
          title: "PersAI Overview",
          locator: null,
          snippet: "PersAI supports source-aware retrieval.",
          score: 7,
          metadata: { kind: "product" }
        }
      ];
    }
    return [];
  }

  async fetch(input: Record<string, unknown>) {
    this.fetches.push(input);
    if (input.referenceId === "source-1:1:0") {
      return {
        referenceId: "source-1:1:0",
        source: "document",
        title: "User Tax File",
        locator: "p1",
        content: "The user's project lists travel and software as deductible expenses.",
        snippet: "User project deductible expenses list.",
        metadata: { knowledgeSourceId: "source-1" }
      };
    }
    if (input.referenceId === "global:product:overview") {
      return {
        referenceId: "global:product:overview",
        source: "global",
        title: "PersAI Overview",
        locator: null,
        content: "PersAI uses source-aware retrieval context labels.",
        snippet: "PersAI supports source-aware retrieval.",
        metadata: { kind: "product" }
      };
    }
    return null;
  }
}

class FakeKnowledgeRetrievalObservabilityService {
  searches: Array<Record<string, unknown>> = [];

  async recordSearch(input: Record<string, unknown>): Promise<void> {
    this.searches.push(input);
  }
}

async function run(): Promise<void> {
  const prisma = {
    assistant: {
      findUnique: async () => ({ workspaceId: "workspace-1" })
    },
    assistantSkillAssignment: {
      findMany: async ({ where }: { where: { skillId: { in: string[] } } }) =>
        where.skillId.in.includes("skill-accounting") ? [{ skillId: "skill-accounting" }] : []
    },
    skillDocumentChunk: {
      findMany: async () => skillChunks
    }
  };
  const readKnowledge = new FakeReadAssistantKnowledgeService();
  const observability = new FakeKnowledgeRetrievalObservabilityService();
  const service = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    observability as never
  );

  const context = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "compare deductible expenses with PersAI source-aware retrieval",
      locale: "en",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting", "skill-disabled"],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        confidence: "high",
        reasonCode: "test_plan"
      }
    })
  );

  assert.ok(context.renderedBlock?.startsWith("# Retrieved Knowledge Context"));
  assert.equal(
    context.items.some((item) => item.label === "skill_reference"),
    true
  );
  assert.equal(
    context.items.some((item) => item.label === "user_document"),
    true
  );
  assert.equal(
    context.items.some((item) => item.label === "product_reference"),
    true
  );
  assert.equal(
    context.items.some(
      (item) =>
        item.label === "skill_reference" &&
        (item.metadata as { skillId?: string } | null)?.skillId === "skill-accounting"
    ),
    true
  );
  assert.equal(
    context.items.some(
      (item) =>
        item.label === "skill_reference" &&
        (item.metadata as { skillId?: string } | null)?.skillId === "skill-disabled"
    ),
    false
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "memory", "chat", "global", "preset", "subscription"]
  );
  assert.deepEqual(
    observability.searches.map((call) => [call.source, call.outcome, call.resultCount]),
    [
      ["skill", "success", 1],
      ["document", "success", 1],
      ["product", "success", 1]
    ]
  );

  await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "current external tax rule",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: false,
        useProductKnowledge: false,
        useWeb: true,
        confidence: "medium",
        reasonCode: "web_freshness"
      }
    })
  );
  assert.equal(observability.searches.at(-1)?.source, "web");
  assert.equal(observability.searches.at(-1)?.outcome, "empty");
  assert.equal(observability.searches.at(-1)?.errorCode, "web_reference_not_executed");

  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        query: "x",
        retrievalPlan: { useSkills: true }
      }),
    /assistantId, query, and retrievalPlan/
  );
}

void run();
