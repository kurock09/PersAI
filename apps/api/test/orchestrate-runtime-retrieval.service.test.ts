import assert from "node:assert/strict";
import { OrchestrateRuntimeRetrievalService } from "../src/modules/workspace-management/application/orchestrate-runtime-retrieval.service";

const skillChunks = [
  {
    skillDocumentId: "doc-1",
    skillId: "skill-accounting",
    workspaceId: "platform-skill-workspace",
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
    workspaceId: "platform-skill-workspace",
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
    workspaceId: "platform-skill-workspace",
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

const projectFileAttachments = [
  {
    assistantFileId: "file-project-1",
    createdAt: new Date("2026-05-22T15:00:00.000Z"),
    assistantFile: {
      id: "file-project-1",
      displayName: "Project Tax Audit.pdf",
      relativePath: "uploads/project-thread/Project Tax Audit.pdf",
      mimeType: "application/pdf",
      metadata: {
        semanticSummary:
          "Project tax audit material covering deductible expenses and PersAI guidance."
      }
    }
  }
];

class FakeReadAssistantKnowledgeService {
  searches: Array<Record<string, unknown>> = [];
  fetches: Array<Record<string, unknown>> = [];
  documentHits: Array<Record<string, unknown>> = [
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
  globalHits: Array<Record<string, unknown>> = [
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

  async search(input: Record<string, unknown>) {
    this.searches.push(input);
    if (input.source === "document") {
      return this.documentHits;
    }
    if (input.source === "global") {
      return this.globalHits;
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

class FakeExtractInternalRuntimeAssistantFileService {
  calls: Array<Record<string, unknown>> = [];

  async execute(input: Record<string, unknown>) {
    this.calls.push(input);
    if (input.fileRef === "file-project-1") {
      return {
        ok: true,
        extracted: true,
        file: {
          fileRef: "file-project-1",
          displayName: "Project Tax Audit.pdf",
          relativePath: "uploads/project-thread/Project Tax Audit.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048
        },
        text: "Deep extracted project file context about deductible expenses, source comparison, and project tax evidence.",
        markdown: null,
        note: null,
        provider: { provider: "local" },
        quality: "high"
      };
    }
    return {
      ok: true,
      extracted: false,
      file: null,
      text: null,
      markdown: null,
      note: "File not found.",
      provider: null,
      quality: null
    };
  }
}

async function run(): Promise<void> {
  const vectorSearches: Array<Record<string, unknown>> = [];
  const prisma = {
    assistant: {
      findUnique: async () => ({ workspaceId: "workspace-1" })
    },
    assistantChat: {
      findUnique: async ({
        where
      }: {
        where: {
          assistantId_surface_surfaceThreadKey: { surfaceThreadKey: string };
        };
      }) =>
        where.assistantId_surface_surfaceThreadKey.surfaceThreadKey === "thread-project-1"
          ? { id: "chat-project-1", workspaceId: "workspace-1" }
          : null
    },
    assistantChatMessageAttachment: {
      findMany: async ({ where }: { where: { chatId: string } }) =>
        where.chatId === "chat-project-1" ? projectFileAttachments : []
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
  const extractInternalRuntimeAssistantFileService =
    new FakeExtractInternalRuntimeAssistantFileService();
  const observability = new FakeKnowledgeRetrievalObservabilityService();
  const service = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    extractInternalRuntimeAssistantFileService as never,
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
        embeddingSearchEnabled: true,
        smartSearchShortDocChars: 2_000,
        smartSearchMediumDocChars: 8_000,
        chatSectionDefaultRadius: 15,
        fetchFullModeMaxChars: 25_000,
        fetchFullModeMaxChatMessages: 150
      }),
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeRetrievalModelKey: async () => null,
      resolveAdminKnowledgeRetrievalPolicy: async () => ({
        schema: "persai.adminKnowledgeRetrievalPolicy.v1",
        embeddingModelKey: null,
        retrievalModelKey: null,
        authoringModelKey: null,
        smartSearchEnabled: true,
        smartSearchLongDocSummaryChars: 800,
        fetchFullModeAbsoluteMaxChars: 100_000,
        fetchFullModeAbsoluteMaxChatMessages: 800,
        notes: []
      })
    } as never,
    { generateEmbeddings: async () => ({ embeddings: [[0.1, 0.2]], usage: null }) } as never,
    { rerankCandidates: async () => null } as never,
    {
      decideBeforeSearch: () => null,
      decideAfterSearch: () => ({
        mode: "refresh_search_only",
        querySimilarityToLastTurn: 0,
        cachedReferenceCoverage: 0,
        candidateAmbiguity: 0.08,
        candidateCount: 1,
        topScoreMargin: 0.92
      }),
      buildCandidateSetHash: (referenceIds: string[]) => referenceIds.join("|")
    } as never,
    {
      resolveChatContext: async () => null,
      buildQueryFingerprint: (query: string) => query.trim().toLowerCase(),
      persistState: async () => undefined
    } as never,
    {
      searchNearest: async (input: Record<string, unknown>) => {
        vectorSearches.push(input);
        return [
          {
            id: "vector-1",
            workspaceId: "platform-skill-workspace",
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
        ];
      }
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
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "test_plan"
      },
      sourcePolicy: {
        mode: "active_skill",
        state: "skill_only",
        allowedKnowledgeSearchSources: ["document", "memory", "chat"],
        allowedKnowledgeFetchSources: ["document", "memory", "chat"]
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
    false
  );
  assert.equal(
    context.items.some((item) => item.label === "product_kb"),
    false
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
  assert.equal(vectorSearches[0]?.workspaceId, null);
  assert.deepEqual(vectorSearches[0]?.skillIds, ["skill-accounting"]);
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    []
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
    decisionMode: "refresh_search_only",
    cacheReuseHit: false,
    helperApplied: false,
    helperChangedOrder: false,
    candidateCount: 1,
    topScoreMargin: 0.92,
    querySimilarityToLastTurn: 0,
    cachedReferenceCoverage: 0,
    candidateAmbiguity: 0.08,
    embeddingModelKey: "text-embedding-3-small",
    helperModelKey: null,
    helperProviderKey: null,
    helperInputTokens: null,
    helperOutputTokens: null,
    helperTotalTokens: null,
    policyState: "skill_only",
    modeUsed: "snippet_only",
    bytesReturned: 0
  });
  assert.equal(observability.fetches.length, 1);
  assert.equal(observability.fetches[0]?.source, "skill");
  assert.equal(observability.fetches[0]?.retrievalMode, "hybrid");
  assert.equal(observability.fetches[0]?.fetchDepth, 3);
  assert.ok(Number(observability.fetches[0]?.fetchedChars) > 120);
  assert.equal(observability.fetches[0]?.modeUsed, "orchestrate_inline");
  assert.equal(observability.fetches[0]?.bytesReturned, observability.fetches[0]?.fetchedChars);

  readKnowledge.searches = [];
  observability.searches = [];
  observability.fetches = [];
  const projectActiveSkillContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "compare deductible expenses with my uploaded files and PersAI guidance",
      locale: "en",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting"],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        confidence: "high",
        reasonCode: "project_skill_user_product"
      },
      gatherProfile: "project",
      sourcePolicy: {
        mode: "active_skill",
        state: "skill_only",
        allowedKnowledgeSearchSources: ["document", "memory", "chat", "global", "subscription"],
        allowedKnowledgeFetchSources: ["document", "memory", "chat", "global", "subscription"]
      },
      conversation: {
        channel: "web",
        surfaceThreadKey: "thread-project-1"
      }
    })
  );
  assert.deepEqual(
    projectActiveSkillContext.items.map((item) => item.referenceId),
    [
      "skill:skill-accounting:skill_document:doc-1:1:1",
      "project_file:file-project-1",
      "source-1:1:0",
      "product-text-entry:product-text-1:1:0"
    ]
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "global", "subscription"]
  );
  assert.deepEqual(extractInternalRuntimeAssistantFileService.calls, [
    {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      fileRef: "file-project-1"
    }
  ]);

  readKnowledge.searches = [];
  observability.searches = [];
  observability.fetches = [];
  const ordinaryActiveSkillContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "compare deductible expenses with PersAI guidance",
      locale: "en",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting"],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        confidence: "high",
        reasonCode: "ordinary_skill_preserves_previous_behavior"
      },
      sourcePolicy: {
        mode: "active_skill",
        state: "skill_only",
        allowedKnowledgeSearchSources: ["document", "memory", "chat", "global", "subscription"],
        allowedKnowledgeFetchSources: ["document", "memory", "chat", "global", "subscription"]
      }
    })
  );
  assert.deepEqual(
    ordinaryActiveSkillContext.items.map((item) => item.label),
    ["skill_reference", "product_kb"]
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["global", "subscription"]
  );

  const originalSkillChunks = [...skillChunks];
  skillChunks.splice(0, skillChunks.length);
  readKnowledge.searches = [];
  const escalatedContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "compare deductible expenses with my uploaded files",
      locale: "en",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting"],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "skill_then_user"
      },
      sourcePolicy: {
        mode: "active_skill",
        state: "skill_only",
        allowedKnowledgeSearchSources: ["document", "memory", "chat"],
        allowedKnowledgeFetchSources: ["document", "memory", "chat"]
      }
    })
  );
  assert.equal(
    escalatedContext.items.some((item) => item.label === "skill_reference"),
    false
  );
  assert.equal(
    escalatedContext.items.some((item) => item.label === "user_document"),
    true
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document"]
  );
  assert.deepEqual(
    observability.searches.slice(-2).map((entry) => ({
      source: entry.source,
      policyState: entry.policyState
    })),
    [
      { source: "document", policyState: "escalated_to_user" },
      { source: "skill", policyState: "escalated_to_user" }
    ]
  );
  skillChunks.splice(0, skillChunks.length, ...originalSkillChunks);

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
  const lexicalOnlyExtractInternalRuntimeAssistantFileService =
    new FakeExtractInternalRuntimeAssistantFileService();
  const lexicalOnlyService = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    lexicalOnlyExtractInternalRuntimeAssistantFileService as never,
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
        embeddingSearchEnabled: true,
        smartSearchShortDocChars: 2_000,
        smartSearchMediumDocChars: 8_000,
        chatSectionDefaultRadius: 15,
        fetchFullModeMaxChars: 25_000,
        fetchFullModeMaxChatMessages: 150
      }),
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeRetrievalModelKey: async () => null,
      resolveAdminKnowledgeRetrievalPolicy: async () => ({
        schema: "persai.adminKnowledgeRetrievalPolicy.v1",
        embeddingModelKey: null,
        retrievalModelKey: null,
        authoringModelKey: null,
        smartSearchEnabled: true,
        smartSearchLongDocSummaryChars: 800,
        fetchFullModeAbsoluteMaxChars: 100_000,
        fetchFullModeAbsoluteMaxChatMessages: 800,
        notes: []
      })
    } as never,
    { generateEmbeddings: async () => ({ embeddings: [[0.1, 0.2]], usage: null }) } as never,
    { rerankCandidates: async () => null } as never,
    {
      decideBeforeSearch: () => null,
      decideAfterSearch: () => ({
        mode: "refresh_search_only",
        querySimilarityToLastTurn: 0,
        cachedReferenceCoverage: 0,
        candidateAmbiguity: 0,
        candidateCount: 0,
        topScoreMargin: null
      }),
      buildCandidateSetHash: (referenceIds: string[]) => referenceIds.join("|")
    } as never,
    {
      resolveChatContext: async () => null,
      buildQueryFingerprint: (query: string) => query.trim().toLowerCase(),
      persistState: async () => undefined
    } as never,
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

  await runOrdinaryStagedRetrievalCases();
}

async function runOrdinaryStagedRetrievalCases(): Promise<void> {
  const observability = new FakeKnowledgeRetrievalObservabilityService();
  const readKnowledge = new FakeReadAssistantKnowledgeService();
  const extractInternalRuntimeAssistantFileService =
    new FakeExtractInternalRuntimeAssistantFileService();
  const prisma = {
    assistant: { findUnique: async () => ({ workspaceId: "workspace-1" }) },
    assistantChat: {
      findUnique: async ({
        where
      }: {
        where: {
          assistantId_surface_surfaceThreadKey: { surfaceThreadKey: string };
        };
      }) =>
        where.assistantId_surface_surfaceThreadKey.surfaceThreadKey === "thread-project-1"
          ? { id: "chat-project-1", workspaceId: "workspace-1" }
          : null
    },
    assistantChatMessageAttachment: {
      findMany: async ({ where }: { where: { chatId: string } }) =>
        where.chatId === "chat-project-1" ? projectFileAttachments : []
    },
    assistantSkillAssignment: { findMany: async () => [] },
    skillDocumentChunk: { findMany: async () => [] },
    skillKnowledgeCardChunk: { findMany: async () => [] }
  };
  const service = new OrchestrateRuntimeRetrievalService(
    prisma as never,
    readKnowledge as never,
    extractInternalRuntimeAssistantFileService as never,
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
        helperEnabled: false,
        helperCandidateLimit: 6,
        helperMaxOutputTokens: 220,
        embeddingSearchEnabled: true,
        smartSearchShortDocChars: 2_000,
        smartSearchMediumDocChars: 8_000,
        chatSectionDefaultRadius: 15,
        fetchFullModeMaxChars: 25_000,
        fetchFullModeMaxChatMessages: 150
      }),
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeRetrievalModelKey: async () => null,
      resolveAdminKnowledgeRetrievalPolicy: async () => ({
        schema: "persai.adminKnowledgeRetrievalPolicy.v1",
        embeddingModelKey: null,
        retrievalModelKey: null,
        authoringModelKey: null,
        smartSearchEnabled: true,
        smartSearchLongDocSummaryChars: 800,
        fetchFullModeAbsoluteMaxChars: 100_000,
        fetchFullModeAbsoluteMaxChatMessages: 800,
        notes: []
      })
    } as never,
    { generateEmbeddings: async () => ({ embeddings: [[0.1, 0.2]], usage: null }) } as never,
    { rerankCandidates: async () => null } as never,
    {
      decideBeforeSearch: () => null,
      decideAfterSearch: () => ({
        mode: "refresh_search_only",
        querySimilarityToLastTurn: 0,
        cachedReferenceCoverage: 0,
        candidateAmbiguity: 0,
        candidateCount: 0,
        topScoreMargin: null
      }),
      buildCandidateSetHash: (referenceIds: string[]) => referenceIds.join("|")
    } as never,
    {
      resolveChatContext: async () => null,
      buildQueryFingerprint: (query: string) => query.trim().toLowerCase(),
      persistState: async () => undefined
    } as never,
    { searchNearest: async () => [] } as never
  );

  const productFirstContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "ordinary product-priority retrieval",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        ordinarySourcePriorityMode: "product_first",
        confidence: "medium",
        reasonCode: "test_ordinary_product_first"
      }
    })
  );
  assert.ok(productFirstContext.renderedBlock?.startsWith("# Retrieved Knowledge Context"));
  const productFirstLabels = productFirstContext.items.map((item) => item.label);
  assert.deepEqual(productFirstLabels, ["product_kb", "user_document"]);
  assert.deepEqual(
    observability.searches.map((entry) => ({
      source: entry.source,
      policyState: entry.policyState
    })),
    [
      { source: "document", policyState: "ordinary_product_first" },
      { source: "product", policyState: "ordinary_product_first" }
    ]
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "global", "subscription"]
  );

  observability.searches = [];
  observability.fetches = [];
  readKnowledge.searches = [];
  extractInternalRuntimeAssistantFileService.calls = [];
  const projectContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "project retrieval with uploaded file context",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "test_project_files_before_kb"
      },
      gatherProfile: "project",
      conversation: {
        channel: "web",
        surfaceThreadKey: "thread-project-1"
      }
    })
  );
  assert.deepEqual(
    projectContext.items.map((item) => item.referenceId),
    ["project_file:file-project-1", "source-1:1:0"]
  );
  assert.deepEqual(extractInternalRuntimeAssistantFileService.calls, [
    {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      fileRef: "file-project-1"
    }
  ]);
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document"]
  );

  readKnowledge.searches = [];
  const explicitRecallContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "remember what we discussed last time about the project",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        ordinarySourcePriorityMode: "personal_first",
        confidence: "high",
        reasonCode: "knowledge_retrieval_recall"
      }
    })
  );
  assert.equal(
    explicitRecallContext.items.some((item) => item.label === "user_document"),
    true
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "memory", "chat"]
  );

  observability.searches = [];
  observability.fetches = [];
  readKnowledge.searches = [];
  extractInternalRuntimeAssistantFileService.calls = [];
  const projectProductContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "project retrieval with uploaded file context and PersAI pricing",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        confidence: "high",
        reasonCode: "test_project_product_intent"
      },
      gatherProfile: "project",
      conversation: {
        channel: "web",
        surfaceThreadKey: "thread-project-1"
      }
    })
  );
  assert.deepEqual(
    projectProductContext.items.map((item) => item.referenceId),
    ["project_file:file-project-1", "source-1:1:0", "product-text-entry:product-text-1:1:0"]
  );
  assert.deepEqual(
    readKnowledge.searches.map((call) => call.source),
    ["document", "global", "subscription"]
  );

  observability.searches = [];
  observability.fetches = [];
  readKnowledge.searches = [];
  const personalFirstContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "ordinary personal-priority retrieval",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: false,
        ordinarySourcePriorityMode: "personal_first",
        confidence: "medium",
        reasonCode: "test_ordinary_personal_first"
      }
    })
  );
  const personalFirstLabels = personalFirstContext.items.map((item) => item.label);
  assert.deepEqual(personalFirstLabels, ["user_document", "product_kb"]);
  assert.equal(observability.searches[0]?.policyState, "ordinary_personal_first");

  observability.searches = [];
  observability.fetches = [];
  const webFirstContext = await service.execute(
    service.parseInput({
      assistantId: "assistant-1",
      query: "ordinary web-priority retrieval",
      locale: "en",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: true,
        useProductKnowledge: true,
        useWeb: true,
        ordinarySourcePriorityMode: "web_first",
        confidence: "medium",
        reasonCode: "test_ordinary_web_first"
      }
    })
  );
  const webFirstLabels = webFirstContext.items.map((item) => item.label);
  assert.deepEqual(webFirstLabels, ["user_document", "product_kb"]);
  const webEntry = observability.searches.find((entry) => entry.source === "web");
  assert.ok(webEntry);
  assert.equal(webEntry?.policyState, "ordinary_web_first");
  assert.equal(webEntry?.errorCode, "web_reference_not_executed");
}

void run();
