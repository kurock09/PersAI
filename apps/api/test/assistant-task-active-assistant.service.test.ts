import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { EnableAssistantTaskRegistryItemService } from "../src/modules/workspace-management/application/enable-assistant-task-registry-item.service";
import { ListAssistantTaskItemsService } from "../src/modules/workspace-management/application/list-assistant-task-items.service";

type AssistantStub = {
  id: string;
  userId: string;
  workspaceId: string;
};

type TaskItem = {
  id: string;
  assistantId: string;
  title: string;
  sourceSurface: "web";
  sourceLabel: string;
  audience: "user";
  actionType: "background_task";
  controlStatus: "active" | "disabled" | "cancelled";
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function run(): Promise<void> {
  const assistantA: AssistantStub = { id: "assistant-a", userId: "user-1", workspaceId: "ws-1" };
  const assistantB: AssistantStub = { id: "assistant-b", userId: "user-1", workspaceId: "ws-1" };
  let activeAssistant = assistantA;
  const controlCalls: Array<{ assistantId: string; taskId: string; action: string }> = [];
  const tasks: TaskItem[] = [
    {
      id: "task-a",
      assistantId: assistantA.id,
      title: "Task A",
      sourceSurface: "web",
      sourceLabel: "Assistant A",
      audience: "user",
      actionType: "background_task",
      controlStatus: "active",
      nextRunAt: null,
      createdAt: new Date("2026-05-26T15:00:00.000Z"),
      updatedAt: new Date("2026-05-26T15:00:00.000Z")
    },
    {
      id: "task-b",
      assistantId: assistantB.id,
      title: "Task B",
      sourceSurface: "web",
      sourceLabel: "Assistant B",
      audience: "user",
      actionType: "background_task",
      controlStatus: "disabled",
      nextRunAt: null,
      createdAt: new Date("2026-05-26T15:01:00.000Z"),
      updatedAt: new Date("2026-05-26T15:01:00.000Z")
    }
  ];

  const resolveActiveAssistantService = {
    async execute({ userId }: { userId: string }) {
      assert.equal(userId, "user-1");
      return { assistantId: activeAssistant.id, assistant: activeAssistant };
    }
  };
  const taskRegistryRepository = {
    async listByAssistantId(assistantId: string) {
      return tasks.filter((task) => task.assistantId === assistantId);
    },
    async findByIdAndAssistantId(itemId: string, assistantId: string) {
      return tasks.find((task) => task.id === itemId && task.assistantId === assistantId) ?? null;
    }
  };

  const listService = new ListAssistantTaskItemsService(
    taskRegistryRepository as never,
    resolveActiveAssistantService as never
  );
  const enableService = new EnableAssistantTaskRegistryItemService(
    resolveActiveAssistantService as never,
    {
      async findByAssistantId() {
        return null;
      }
    } as never,
    taskRegistryRepository as never,
    {
      async execute(input: { assistantId: string; taskId: string; action: string }) {
        controlCalls.push(input);
      }
    } as never
  );

  activeAssistant = assistantA;
  const listForA = await listService.execute("user-1");
  assert.deepEqual(
    listForA.map((item) => item.id),
    ["task-a"]
  );

  await assert.rejects(
    () => enableService.execute("user-1", "task-b"),
    (error) =>
      error instanceof NotFoundException &&
      error.message === "Task was not found for this assistant."
  );
  assert.deepEqual(controlCalls, []);

  activeAssistant = assistantB;
  const result = await enableService.execute("user-1", "task-b");
  assert.deepEqual(result, { enabled: true });
  assert.deepEqual(controlCalls, [
    {
      assistantId: assistantB.id,
      taskId: "task-b",
      action: "resume"
    }
  ]);
}

void run();
