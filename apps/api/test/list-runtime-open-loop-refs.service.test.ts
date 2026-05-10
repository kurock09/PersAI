import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ListRuntimeOpenLoopRefsService } from "../src/modules/workspace-management/application/list-runtime-open-loop-refs.service";

async function run(): Promise<void> {
  const repoCalls: Array<{ assistantId: string; userId: string; limit: number }> = [];
  const countCalls: Array<{ assistantId: string; userId: string }> = [];
  const service = new ListRuntimeOpenLoopRefsService(
    {
      async findById(id: string) {
        return id === "assistant-missing" ? null : { id, userId: "user-1" };
      }
    } as never,
    {
      async findLatestActiveOpenLoopsByAssistantUser(
        assistantId: string,
        userId: string,
        limit: number
      ) {
        repoCalls.push({ assistantId, userId, limit });
        return [
          {
            id: "loop-2",
            summary: "Confirm final pricing plan",
            createdAt: new Date("2026-05-10T10:00:00.000Z")
          },
          {
            id: "loop-1",
            summary: "Send onboarding file",
            createdAt: new Date("2026-05-09T10:00:00.000Z")
          }
        ];
      },
      async countActiveOpenLoopsByAssistantUser(assistantId: string, userId: string) {
        countCalls.push({ assistantId, userId });
        return 7;
      }
    } as never
  );

  assert.deepEqual(service.parseInput({ assistantId: "assistant-1", requestId: "req-1" }), {
    assistantId: "assistant-1",
    requestId: "req-1"
  });
  assert.deepEqual(service.parseInput({ assistantId: "assistant-1" }), {
    assistantId: "assistant-1",
    requestId: null
  });
  assert.throws(
    () => service.parseInput({ assistantId: "assistant-1", extra: true }),
    BadRequestException
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    requestId: "req-1"
  });
  assert.deepEqual(result, {
    unresolvedOpenLoops: [
      {
        id: "loop-2",
        summary: "Confirm final pricing plan",
        createdAt: "2026-05-10T10:00:00.000Z"
      },
      {
        id: "loop-1",
        summary: "Send onboarding file",
        createdAt: "2026-05-09T10:00:00.000Z"
      }
    ],
    totalUnresolvedOpenLoops: 7
  });
  assert.deepEqual(repoCalls, [{ assistantId: "assistant-1", userId: "user-1", limit: 100 }]);
  assert.deepEqual(countCalls, [{ assistantId: "assistant-1", userId: "user-1" }]);

  await assert.rejects(
    () =>
      service.execute({
        assistantId: "assistant-missing",
        requestId: null
      }),
    NotFoundException
  );
}

void run();
