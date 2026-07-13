import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import { FindCrossSessionCarryOverService } from "../src/modules/workspace-management/application/find-cross-session-carry-over.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

type CompactionRow = {
  id: string;
  runtimeSessionId: string;
  assistantId: string;
  createdAt: Date;
  summaryPayload: unknown;
  runtimeSession: {
    id: string;
    channel: string;
  };
};

function buildAssistant(overrides: Partial<Assistant> = {}): Assistant {
  const now = new Date("2026-04-22T00:00:00.000Z");
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded",
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    sandboxEgressMode: "restricted",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildOpenLoop(
  overrides: Partial<AssistantMemoryRegistryItem>
): AssistantMemoryRegistryItem {
  const createdAt = new Date("2026-04-21T00:00:00.000Z");
  return {
    id: "loop-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "Decide on retreat venue",
    sourceType: "memory_write",
    sourceLabel: "Memory write: open loop",
    memoryClass: "core",
    kind: "open_loop",
    durability: "episodic",
    stability: "time_bound",
    confidence: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt,
    ...overrides
  };
}

function createHarness(options?: {
  assistant?: Assistant | null;
  rows?: CompactionRow[];
  openLoops?: AssistantMemoryRegistryItem[];
  capturedFindManyArgs?: Array<Record<string, unknown>>;
  capturedOpenLoopArgs?: Array<{
    assistantId: string;
    userId: string;
    sinceCreatedAt: Date;
    limit: number;
  }>;
}) {
  const findManyCalls: Array<Record<string, unknown>> = options?.capturedFindManyArgs ?? [];
  const openLoopCalls = options?.capturedOpenLoopArgs ?? [];
  const assistant = options?.assistant === undefined ? buildAssistant() : options.assistant;
  const assistantRepository: Pick<AssistantRepository, "findById"> = {
    async findById(id) {
      return assistant !== null && assistant.id === id ? assistant : null;
    }
  };
  const memoryRegistryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "findActiveOpenLoopsByAssistantUser"
  > = {
    async findActiveOpenLoopsByAssistantUser(assistantId, userId, sinceCreatedAt, limit) {
      openLoopCalls.push({ assistantId, userId, sinceCreatedAt, limit });
      return options?.openLoops ?? [];
    }
  };
  const prisma = {
    runtimeSessionCompaction: {
      async findMany(args: Record<string, unknown>) {
        findManyCalls.push(args);
        return options?.rows ?? [];
      }
    }
  };

  return {
    service: new FindCrossSessionCarryOverService(
      assistantRepository as AssistantRepository,
      memoryRegistryRepository as AssistantMemoryRegistryRepository,
      prisma as unknown as WorkspaceManagementPrismaService
    ),
    findManyCalls,
    openLoopCalls
  };
}

async function run(): Promise<void> {
  const { service } = createHarness();

  // parseInput rejects bogus payloads
  assert.throws(
    () => service.parseInput(null),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseInput({ assistantId: "a", ttlDays: 0 }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseInput({ assistantId: "a", ttlDays: 91 }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseInput({ assistantId: "a", ttlDays: 7, unknownField: 1 }),
    (err) => err instanceof BadRequestException
  );

  const parsed = service.parseInput({
    assistantId: "  assistant-1  ",
    ttlDays: 7,
    excludeRuntimeSessionId: "  current-session  ",
    requestId: null
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.ttlDays, 7);
  assert.equal(parsed.excludeRuntimeSessionId, "current-session");
  assert.equal(parsed.requestId, null);

  // execute throws on missing assistant
  const missing = createHarness({ assistant: null });
  await assert.rejects(
    () =>
      missing.service.execute({
        assistantId: "assistant-1",
        ttlDays: 7,
        excludeRuntimeSessionId: null,
        requestId: null
      }),
    (err) => err instanceof NotFoundException
  );

  // top-N=3 invariant: even with 5 distinct sessions, only the 3 most recent
  // come back; per-session dedup keeps only the newest synopsis per session.
  const now = Date.now();
  const sessionTwoOlder: CompactionRow = {
    id: "c-2-old",
    runtimeSessionId: "session-2",
    assistantId: "assistant-1",
    createdAt: new Date(now - 90 * 60 * 1000),
    summaryPayload: { kind: "session2-old" },
    runtimeSession: { id: "session-2", channel: "web" }
  };
  const rows: CompactionRow[] = [
    {
      id: "c-1",
      runtimeSessionId: "session-1",
      assistantId: "assistant-1",
      createdAt: new Date(now - 5 * 60 * 1000),
      summaryPayload: { kind: "session1" },
      runtimeSession: { id: "session-1", channel: "telegram" }
    },
    {
      id: "c-2",
      runtimeSessionId: "session-2",
      assistantId: "assistant-1",
      createdAt: new Date(now - 10 * 60 * 1000),
      summaryPayload: { kind: "session2" },
      runtimeSession: { id: "session-2", channel: "web" }
    },
    sessionTwoOlder,
    {
      id: "c-3",
      runtimeSessionId: "session-3",
      assistantId: "assistant-1",
      createdAt: new Date(now - 30 * 60 * 1000),
      summaryPayload: { kind: "session3" },
      runtimeSession: { id: "session-3", channel: "web" }
    },
    {
      id: "c-4",
      runtimeSessionId: "session-4",
      assistantId: "assistant-1",
      createdAt: new Date(now - 60 * 60 * 1000),
      summaryPayload: { kind: "session4" },
      runtimeSession: { id: "session-4", channel: "telegram" }
    },
    {
      id: "c-5",
      runtimeSessionId: "session-5",
      assistantId: "assistant-1",
      createdAt: new Date(now - 80 * 60 * 1000),
      summaryPayload: { kind: "session5" },
      runtimeSession: { id: "session-5", channel: "web" }
    }
  ];
  const openLoops = [
    buildOpenLoop({ id: "loop-1", summary: "Pick a venue for the retreat" }),
    buildOpenLoop({ id: "loop-2", summary: "Send Q3 review draft to leadership" })
  ];
  const happy = createHarness({ rows, openLoops });
  const result = await happy.service.execute({
    assistantId: "assistant-1",
    ttlDays: 7,
    excludeRuntimeSessionId: null,
    requestId: "req-1"
  });
  assert.equal(result.recentSynopses.length, 3);
  assert.deepEqual(
    result.recentSynopses.map((row) => row.runtimeSessionId),
    ["session-1", "session-2", "session-3"]
  );
  // cross-channel: both `web` and `telegram` channels appear in the result
  assert.ok(result.recentSynopses.some((row) => row.channel === "telegram"));
  assert.ok(result.recentSynopses.some((row) => row.channel === "web"));
  // session-2 dedup picks the newer (c-2) over the older (c-2-old)
  const sessionTwoPicked = result.recentSynopses.find(
    (row) => row.runtimeSessionId === "session-2"
  );
  assert.deepEqual(sessionTwoPicked?.summaryPayload, { kind: "session2" });
  assert.equal(result.unresolvedOpenLoops.length, 2);
  assert.deepEqual(
    result.unresolvedOpenLoops.map((row) => row.id),
    ["loop-1", "loop-2"]
  );

  // findMany must filter by createdAt >= sinceCreatedAt for TTL, and request
  // a bounded buffer that exceeds top-N (used to support per-session dedup).
  const lastFindMany = happy.findManyCalls[0] as {
    where: { createdAt: { gte: Date }; assistantId: string };
    take: number;
  };
  assert.equal(lastFindMany.where.assistantId, "assistant-1");
  assert.ok(lastFindMany.where.createdAt.gte instanceof Date);
  assert.ok(lastFindMany.take >= 3);
  // sinceCreatedAt is roughly now - ttlDays days
  const sinceMs = lastFindMany.where.createdAt.gte.getTime();
  const expectedSinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(sinceMs - expectedSinceMs) < 60 * 1000, "since cursor within 60s of now-7d");

  // open-loop fetch is invoked with the SAME sinceCreatedAt window
  assert.equal(happy.openLoopCalls.length, 1);
  assert.equal(happy.openLoopCalls[0]?.assistantId, "assistant-1");
  assert.equal(happy.openLoopCalls[0]?.userId, "user-1");
  assert.ok(happy.openLoopCalls[0]?.sinceCreatedAt.getTime() === sinceMs);
  assert.ok(happy.openLoopCalls[0]?.limit !== undefined && happy.openLoopCalls[0].limit > 0);

  // excludeRuntimeSessionId drops the matching session from the synopsis list
  const excluded = createHarness({ rows, openLoops: [] });
  const excludedResult = await excluded.service.execute({
    assistantId: "assistant-1",
    ttlDays: 7,
    excludeRuntimeSessionId: "session-1",
    requestId: null
  });
  assert.deepEqual(
    excludedResult.recentSynopses.map((row) => row.runtimeSessionId),
    ["session-2", "session-3", "session-4"]
  );

  // empty rows + empty open-loops yields empty arrays without throwing
  const empty = createHarness({ rows: [], openLoops: [] });
  const emptyResult = await empty.service.execute({
    assistantId: "assistant-1",
    ttlDays: 7,
    excludeRuntimeSessionId: null,
    requestId: null
  });
  assert.deepEqual(emptyResult.recentSynopses, []);
  assert.deepEqual(emptyResult.unresolvedOpenLoops, []);
}

void run();
