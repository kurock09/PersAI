import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { ManageAssistantWorkspaceMemoryService } from "../src/modules/workspace-management/application/manage-assistant-workspace-memory.service";

type AssistantStub = {
  id: string;
  userId: string;
  workspaceId: string;
};

type MemoryItem = {
  id: string;
  assistantId: string;
  summary: string;
  createdAt: Date;
  sourceType: "memory_write";
  sourceLabel: string;
  memoryClass: "core";
  kind: "fact";
  resolvedAt: Date | null;
};

async function run(): Promise<void> {
  const assistantA: AssistantStub = { id: "assistant-a", userId: "user-1", workspaceId: "ws-1" };
  const assistantB: AssistantStub = { id: "assistant-b", userId: "user-1", workspaceId: "ws-1" };
  let activeAssistant = assistantA;
  let nextId = 1;
  const items = new Map<string, MemoryItem>();

  const service = new ManageAssistantWorkspaceMemoryService(
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return { assistantId: activeAssistant.id, assistant: activeAssistant };
      }
    } as never,
    {
      async findByAssistantId() {
        return null;
      }
    } as never,
    {
      async listActiveByAssistantId(assistantId: string) {
        return [...items.values()].filter(
          (item) => item.assistantId === assistantId && item.resolvedAt === null
        );
      },
      async searchActiveByAssistantId(assistantId: string, query: string) {
        return [...items.values()].filter(
          (item) =>
            item.assistantId === assistantId &&
            item.resolvedAt === null &&
            item.summary.includes(query)
        );
      },
      async create(input: {
        assistantId: string;
        summary: string;
        sourceLabel: string;
        sourceType: "memory_write";
        memoryClass: "core";
        kind: "fact";
      }) {
        const created: MemoryItem = {
          id: `memory-${nextId++}`,
          assistantId: input.assistantId,
          summary: input.summary,
          createdAt: new Date("2026-05-26T15:00:00.000Z"),
          sourceType: input.sourceType,
          sourceLabel: input.sourceLabel,
          memoryClass: input.memoryClass,
          kind: input.kind,
          resolvedAt: null
        };
        items.set(created.id, created);
        return created;
      },
      async findActiveByIdAndAssistantId(itemId: string, assistantId: string) {
        const item = items.get(itemId);
        return item !== undefined && item.assistantId === assistantId && item.resolvedAt === null
          ? item
          : null;
      },
      async updateSummaryById(itemId: string, assistantId: string, summary: string) {
        const item = items.get(itemId);
        if (item === undefined || item.assistantId !== assistantId) {
          return false;
        }
        item.summary = summary;
        return true;
      },
      async markForgottenById(itemId: string, assistantId: string) {
        const item = items.get(itemId);
        if (item === undefined || item.assistantId !== assistantId) {
          return false;
        }
        item.resolvedAt = new Date("2026-05-26T15:05:00.000Z");
        return true;
      }
    } as never
  );

  const createdForA = await service.add("user-1", "Remember assistant A");
  assert.equal(createdForA.content, "Remember assistant A");

  activeAssistant = assistantB;
  const listForB = await service.list("user-1");
  assert.deepEqual(listForB, []);

  activeAssistant = assistantA;
  const listForA = await service.list("user-1");
  assert.equal(listForA.length, 1);
  assert.equal(listForA[0]?.id, createdForA.id);

  activeAssistant = assistantB;
  await assert.rejects(
    () => service.edit("user-1", createdForA.id, "assistant B should not edit this"),
    (error) =>
      error instanceof NotFoundException && error.message === "Workspace memory item not found."
  );
  await assert.rejects(
    () => service.forget("user-1", createdForA.id),
    (error) =>
      error instanceof NotFoundException && error.message === "Workspace memory item not found."
  );

  const createdForB = await service.add("user-1", "Remember assistant B");
  assert.equal(createdForB.content, "Remember assistant B");

  activeAssistant = assistantA;
  const searchForA = await service.search("user-1", "assistant");
  assert.deepEqual(
    searchForA.map((item) => item.id),
    [createdForA.id]
  );
}

void run();
