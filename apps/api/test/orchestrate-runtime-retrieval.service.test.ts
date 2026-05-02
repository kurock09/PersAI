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
    content:
      "Professional tax review starts by identifying the user's filing context and documented expenses.",
    embeddingModelKey: "text-embedding-3-small",
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
  },
  {
    skillDocumentId: "doc-1",
    skillId: "skill-accounting",
    workspaceId: "workspace-1",
    sourceVersion: 1,
    chunkIndex: 1,
    locator: "tax#2",
    content:
      "Professional tax review requires checking deductible expenses against local rules and keeping the exact source excerpt available for citation.",
    embeddingModelKey: "text-embedding-3-small",
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
  },
  {
    skillDocumentId: "doc-1",
    skillId: "skill-accounting",
    workspaceId: "workspace-1",
    sourceVersion: 1,
    chunkIndex: 2,
    locator: "tax#3",
    content:
      "The excerpt window should include neighboring Skill document chunks when the selected chunk is fetched.",
    embeddingModelKey: "text-embedding-3-small",
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
          referenceId: "product-text-entry:product-text-1:1:0",
          source: "global",
          title: "PersAI Overview",
          locator: null,
          snippet: "PersAI Product KB supports source-aware retrieval.",
          score: 7,
          metadata: { kind: "product_text_entry" }
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
    if (input.referenceId === "product-text-entry:product-text-1:1:0") {
      return {
        referenceId: "product-text-entry:product-text-1:1:0",
        source: "global",
        title: "PersAI Overview",
        locator: null,
        content: "PersAI Product KB uses source-aware retrieval context labels.",
        snippet: "PersAI Product KB supports source-aware retrieval.",
        metadata: { kind: "product_text_entry" }
      };
    }
    return null;
  }
}

class FakeKnowledgeRetrievalObservabilityService {
  searches: Array<Record<string, unknown>> = [];
  fetches: Array<Record<string, unknown>> = [];

  async recordSearch(input: Record<string, unknown>): Promise<void> {
    this.searches.push(input);
  }

  async recordFetch(input: Record<string, unknown>): Promise<void> {
    this.fetches.push(input);
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
    },
    skillKnowledgeCardChunk: {
      findMany: async () => []
    }
  };
  const readKnowledge = new FakeReadAssistantKnowledgeService();
  const observability = new FakeKnowledgeRetrievalObservabilityService();
  const service = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    observability as never,
    {
      resolveAssistantRetrievalPolicy: async () => ({
        defaultMaxResults: 5,
        maxMaxResults: 8,
        lexicalCandidateLimit: 60,
        vectorCandidateLimit: 240,
        knowledgeFetchWindowRadius: 1,
        chatFetchWindowRadius: 2,
        fetchMaxChars: 6000,
        helperEnabled: true,
        helperCandidateLimit: 6,
        helperMaxOutputTokens: 220,
        embeddingSearchEnabled: true
      }),
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeRetrievalModelKey: async () => null
    } as never,
    { generateEmbeddings: async () => [[0.1, 0.2]] } as never,
    { rerankCandidates: async () => null } as never,
    {
      searchNearest: async () => [
        {
          id: "vector-1",
          workspaceId: "workspace-1",
          assistantId: null,
          skillId: "skill-accounting",
          sourceType: "skill_document",
          sourceId: "doc-1",
          chunkId: null,
          sourceVersion: 1,
          chunkIndex: 1,
          embeddingModelKey: "text-embedding-3-small",
          score: 0.92,
          metadata: null
        }
      ]
    } as never
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
    context.items.some((item) => item.label === "product_kb"),
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
  const skillItem = context.items.find((item) => item.label === "skill_reference");
  assert.ok(skillItem);
  assert.match(
    skillItem.content,
    /exact source excerpt available for citation/,
    "Skill retrieval must inject the fetched exact excerpt, not only a search snippet."
  );
  assert.match(
    skillItem.content,
    /neighboring Skill document chunks/,
    "Skill retrieval should use a fetch window around the semantic hit."
  );
  assert.equal((skillItem.metadata as { retrievalMode?: string }).retrievalMode, "hybrid");
  assert.equal((skillItem.metadata as { vectorScore?: number }).vectorScore, 0.92);
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "memory", "chat", "global", "subscription"]
  );
  assert.deepEqual(observability.searches[0], {
    workspaceId: "workspace-1",
    assistantId: "assistant-1",
    source: "skill",
    durationMs: observability.searches[0]?.durationMs,
    resultCount: 1,
    outcome: "success",
    errorCode: null,
    retrievalMode: "hybrid",
    lexicalCandidateCount: 3,
    vectorCandidateCount: 1,
    helperApplied: false,
    embeddingModelKey: "text-embedding-3-small",
    helperModelKey: null,
    helperProviderKey: null,
    helperInputTokens: null,
    helperOutputTokens: null,
    helperTotalTokens: null
  });
  assert.equal(observability.fetches.length, 1);
  assert.equal(observability.fetches[0]?.source, "skill");
  assert.equal(observability.fetches[0]?.retrievalMode, "hybrid");
  assert.equal(observability.fetches[0]?.fetchDepth, 3);
  assert.ok(Number(observability.fetches[0]?.fetchedChars) > 120);

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

  const lexicalOnlyObservability = new FakeKnowledgeRetrievalObservabilityService();
  const lexicalOnlyService = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    lexicalOnlyObservability as never,
    {
      resolveAssistantRetrievalPolicy: async () => ({
        defaultMaxResults: 5,
        maxMaxResults: 8,
        lexicalCandidateLimit: 60,
        vectorCandidateLimit: 240,
        knowledgeFetchWindowRadius: 1,
        chatFetchWindowRadius: 2,
        fetchMaxChars: 6000,
        helperEnabled: true,
        helperCandidateLimit: 6,
        helperMaxOutputTokens: 220,
        embeddingSearchEnabled: true
      }),
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeRetrievalModelKey: async () => null
    } as never,
    { generateEmbeddings: async () => [[0.1, 0.2]] } as never,
    { rerankCandidates: async () => null } as never,
    { searchNearest: async () => [] } as never
  );
  const lexicalOnlyContext = await lexicalOnlyService.execute(
    lexicalOnlyService.parseInput({
      assistantId: "assistant-1",
      query: "deductible expenses",
      locale: "en",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting"],
        useUserKnowledge: false,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "test_plan"
      }
    })
  );
  assert.equal(
    lexicalOnlyContext.items.some((item) => item.label === "skill_reference"),
    false,
    "Skill docs with an admin embedding policy must not be injected from lexical-only matches."
  );
  assert.equal(lexicalOnlyObservability.fetches.length, 0);
  assert.equal(lexicalOnlyObservability.searches[0]?.retrievalMode, "hybrid");
  assert.equal(lexicalOnlyObservability.searches[0]?.resultCount, 0);

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
