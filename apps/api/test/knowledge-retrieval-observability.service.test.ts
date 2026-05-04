import assert from "node:assert/strict";
import { KnowledgeRetrievalObservabilityService } from "../src/modules/workspace-management/application/knowledge-retrieval-observability.service";

async function run(): Promise<void> {
  const events: Array<Record<string, unknown>> = [];
  const rollups = new Map<string, Record<string, unknown>>();
  let eventCounter = 0;
  const prisma = {
    $transaction: async <T>(
      callback: (tx: {
        knowledgeRetrievalEvent: {
          create: (args: { data: Record<string, unknown> }) => Promise<void>;
        };
        knowledgeRetrievalRollup: {
          findUnique: (args: {
            where: { workspaceId_source: { workspaceId: string; source: string } };
          }) => Promise<Record<string, unknown> | null>;
          create: (args: { data: Record<string, unknown> }) => Promise<void>;
          update: (args: {
            where: { workspaceId_source: { workspaceId: string; source: string } };
            data: Record<string, unknown>;
          }) => Promise<void>;
        };
      }) => Promise<T>
    ) =>
      callback({
        knowledgeRetrievalEvent: {
          create: async ({ data }) => {
            events.push({
              id: `event-${++eventCounter}`,
              createdAt: new Date("2026-05-04T12:00:00.000Z"),
              ...data
            });
          }
        },
        knowledgeRetrievalRollup: {
          findUnique: async ({ where }) =>
            rollups.get(
              `${where.workspaceId_source.workspaceId}:${where.workspaceId_source.source}`
            ) ?? null,
          create: async ({ data }) => {
            rollups.set(`${data.workspaceId}:${data.source}`, {
              updatedAt: new Date("2026-05-04T12:00:00.000Z"),
              ...data
            });
          },
          update: async ({ where, data }) => {
            const key = `${where.workspaceId_source.workspaceId}:${where.workspaceId_source.source}`;
            const existing = rollups.get(key) ?? {};
            rollups.set(key, {
              ...existing,
              ...data,
              updatedAt: new Date("2026-05-04T12:00:00.000Z")
            });
          }
        }
      })
  };

  const service = new KnowledgeRetrievalObservabilityService(prisma as never);
  await service.recordSearch({
    workspaceId: "workspace-1",
    assistantId: "assistant-1",
    source: "skill",
    retrievalMode: "hybrid",
    durationMs: 12,
    resultCount: 2,
    lexicalCandidateCount: 4,
    vectorCandidateCount: 2,
    decisionMode: "refresh_search_only",
    helperApplied: false,
    embeddingModelKey: "text-embedding-3-small"
  });
  await service.recordSearch({
    workspaceId: "workspace-1",
    assistantId: "assistant-1",
    source: "web",
    retrievalMode: "lexical",
    durationMs: 7,
    resultCount: 0,
    lexicalCandidateCount: 0,
    vectorCandidateCount: 0,
    helperApplied: false,
    embeddingModelKey: null
  });
  await service.recordFetch({
    workspaceId: "workspace-1",
    assistantId: "assistant-1",
    source: "web",
    retrievalMode: "lexical",
    durationMs: 3,
    fetchDepth: 0,
    fetchedChars: 0,
    embeddingModelKey: null
  });

  assert.equal(events[0]?.decisionMode, "refresh_search_only");
  assert.equal(events[1]?.decisionMode, "not_applicable");
  assert.equal(events[2]?.decisionMode, "not_applicable");
  assert.equal(rollups.get("workspace-1:skill")?.refreshSearchOnlyTotal, 1);
  assert.equal(rollups.get("workspace-1:web")?.refreshSearchOnlyTotal, 0);
  assert.equal(rollups.get("workspace-1:web")?.reuseCachedRefsTotal, 0);
  assert.equal(rollups.get("workspace-1:web")?.refreshWithHelperTotal, 0);
}

void run();
