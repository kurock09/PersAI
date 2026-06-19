import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ListRuntimeOpenLoopRefsService } from "../src/modules/workspace-management/application/list-runtime-open-loop-refs.service";

type SeedLoop = {
  id: string;
  summary: string;
  chatId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

// ADR-120 Slice 2 — the runtime open-loop refs block is scoped to the current
// chat AND open-only. The mock repository mirrors the real query filters
// (chatId match + resolvedAt IS NULL) so the service test asserts the scoping
// contract end-to-end: a loop in chat B is excluded when querying chat A, a
// null-chat loop is excluded, and a resolved loop is excluded.
const SEED: SeedLoop[] = [
  {
    id: "loop-a2",
    summary: "Confirm final pricing plan",
    chatId: "chat-A",
    resolvedAt: null,
    createdAt: new Date("2026-05-10T10:00:00.000Z")
  },
  {
    id: "loop-a1",
    summary: "Send onboarding file",
    chatId: "chat-A",
    resolvedAt: null,
    createdAt: new Date("2026-05-09T10:00:00.000Z")
  },
  {
    id: "loop-a-resolved",
    summary: "Already-closed loop in chat A",
    chatId: "chat-A",
    resolvedAt: new Date("2026-05-09T11:00:00.000Z"),
    createdAt: new Date("2026-05-08T10:00:00.000Z")
  },
  {
    id: "loop-b1",
    summary: "Loop that belongs to a different chat",
    chatId: "chat-B",
    resolvedAt: null,
    createdAt: new Date("2026-05-11T10:00:00.000Z")
  },
  {
    id: "loop-null",
    summary: "Loop with no chat scope",
    chatId: null,
    resolvedAt: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z")
  }
];

function buildService() {
  const repoCalls: Array<{
    assistantId: string;
    userId: string;
    chatId: string | null;
    limit: number;
  }> = [];
  const countCalls: Array<{ assistantId: string; userId: string; chatId: string | null }> = [];
  const matches = (loop: SeedLoop, chatId: string | null): boolean =>
    chatId !== null && loop.chatId === chatId && loop.resolvedAt === null;
  const service = new ListRuntimeOpenLoopRefsService(
    {
      async findById(id: string) {
        return id === "assistant-missing" ? null : { id, userId: "user-1" };
      }
    } as never,
    {
      async findLatestActiveOpenLoopsByAssistantUserChat(
        assistantId: string,
        userId: string,
        chatId: string | null,
        limit: number
      ) {
        repoCalls.push({ assistantId, userId, chatId, limit });
        return SEED.filter((loop) => matches(loop, chatId)).slice(0, limit);
      },
      async countActiveOpenLoopsByAssistantUserChat(
        assistantId: string,
        userId: string,
        chatId: string | null
      ) {
        countCalls.push({ assistantId, userId, chatId });
        return SEED.filter((loop) => matches(loop, chatId)).length;
      }
    } as never
  );
  return { service, repoCalls, countCalls };
}

async function run(): Promise<void> {
  const { service, repoCalls, countCalls } = buildService();

  // parseInput accepts an explicit chatId and a null/absent chatId.
  assert.deepEqual(
    service.parseInput({ assistantId: "assistant-1", chatId: "chat-A", requestId: "req-1" }),
    { assistantId: "assistant-1", chatId: "chat-A", requestId: "req-1" }
  );
  assert.deepEqual(service.parseInput({ assistantId: "assistant-1" }), {
    assistantId: "assistant-1",
    chatId: null,
    requestId: null
  });
  assert.throws(
    () => service.parseInput({ assistantId: "assistant-1", extra: true }),
    BadRequestException
  );

  // Chat scoping: querying chat A returns ONLY chat-A open loops, most-recent
  // first. The chat-B loop, the null-chat loop, and the resolved chat-A loop
  // are all excluded.
  const result = await service.execute({
    assistantId: "assistant-1",
    chatId: "chat-A",
    requestId: "req-1"
  });
  assert.deepEqual(result, {
    unresolvedOpenLoops: [
      {
        id: "loop-a2",
        summary: "Confirm final pricing plan",
        createdAt: "2026-05-10T10:00:00.000Z"
      },
      {
        id: "loop-a1",
        summary: "Send onboarding file",
        createdAt: "2026-05-09T10:00:00.000Z"
      }
    ],
    totalUnresolvedOpenLoops: 2
  });
  assert.deepEqual(repoCalls, [
    { assistantId: "assistant-1", userId: "user-1", chatId: "chat-A", limit: 100 }
  ]);
  assert.deepEqual(countCalls, [
    { assistantId: "assistant-1", userId: "user-1", chatId: "chat-A" }
  ]);

  // A null current chat id returns empty WITHOUT touching the repository — a
  // loop from another chat can never enter the current prompt.
  const emptyResult = await service.execute({
    assistantId: "assistant-1",
    chatId: null,
    requestId: "req-2"
  });
  assert.deepEqual(emptyResult, { unresolvedOpenLoops: [], totalUnresolvedOpenLoops: 0 });
  assert.equal(repoCalls.length, 1, "null chatId must not issue a list query");
  assert.equal(countCalls.length, 1, "null chatId must not issue a count query");

  await assert.rejects(
    () =>
      service.execute({
        assistantId: "assistant-missing",
        chatId: "chat-A",
        requestId: null
      }),
    NotFoundException
  );
}

void run();
