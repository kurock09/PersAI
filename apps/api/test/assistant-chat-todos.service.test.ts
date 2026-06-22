import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AssistantChatRepository } from "../src/modules/workspace-management/domain/assistant-chat.repository";
import type { AssistantChat } from "../src/modules/workspace-management/domain/assistant-chat.entity";
import {
  AssistantChatTodosService,
  selectChatPlanWindow
} from "../src/modules/workspace-management/application/assistant-chat-todos.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

interface FakeTodoRow {
  id: string;
  chatId: string;
  assistantId: string;
  parentId: string | null;
  content: string;
  status: "pending" | "in_progress" | "completed";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

class FakeAssistantChatTodoTable {
  private rows: FakeTodoRow[] = [];
  private nextOrdinal = 1;
  private now = Date.UTC(2026, 5, 22, 12, 0, 0);

  reset(): void {
    this.rows = [];
    this.nextOrdinal = 1;
    this.now = Date.UTC(2026, 5, 22, 12, 0, 0);
  }

  snapshot(): readonly FakeTodoRow[] {
    return this.rows.map((row) => ({ ...row }));
  }

  private mintId(prefix: string): string {
    const id = `${prefix}-${String(this.nextOrdinal).padStart(4, "0")}`;
    this.nextOrdinal += 1;
    return id;
  }

  private currentDate(): Date {
    const ts = this.now;
    this.now += 1000;
    return new Date(ts);
  }

  async findMany(args: {
    where: { chatId: string };
    orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  }): Promise<FakeTodoRow[]> {
    const filtered = this.rows.filter((row) => row.chatId === args.where.chatId);
    return filtered.slice().sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  async create(args: {
    data: {
      chatId: string;
      assistantId: string;
      parentId: string | null;
      content: string;
      status: FakeTodoRow["status"];
      sortOrder: number;
    };
  }): Promise<FakeTodoRow> {
    const now = this.currentDate();
    const row: FakeTodoRow = {
      id: this.mintId("todo"),
      chatId: args.data.chatId,
      assistantId: args.data.assistantId,
      parentId: args.data.parentId,
      content: args.data.content,
      status: args.data.status,
      sortOrder: args.data.sortOrder,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    this.rows.push(row);
    return { ...row };
  }

  async update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<FakeTodoRow> {
    const row = this.rows.find((r) => r.id === args.where.id);
    if (!row) {
      throw new Error(`Row not found: ${args.where.id}`);
    }
    if (typeof args.data.content === "string") row.content = args.data.content;
    if (typeof args.data.status === "string") {
      row.status = args.data.status as FakeTodoRow["status"];
    }
    if (args.data.completedAt instanceof Date) {
      row.completedAt = args.data.completedAt;
    }
    const parentDirective = args.data.parent as
      | { disconnect?: true; connect?: { id: string } }
      | undefined;
    if (parentDirective !== undefined) {
      if (parentDirective.disconnect === true) {
        row.parentId = null;
      } else if (parentDirective.connect !== undefined) {
        row.parentId = parentDirective.connect.id;
      }
    }
    row.updatedAt = this.currentDate();
    return { ...row };
  }

  async delete(args: { where: { id: string } }): Promise<FakeTodoRow> {
    const idx = this.rows.findIndex((r) => r.id === args.where.id);
    if (idx === -1) {
      throw new Error(`Row not found: ${args.where.id}`);
    }
    const target = this.rows[idx]!;
    const idsToRemove = new Set<string>([target.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of this.rows) {
        if (row.parentId !== null && idsToRemove.has(row.parentId) && !idsToRemove.has(row.id)) {
          idsToRemove.add(row.id);
          grew = true;
        }
      }
    }
    this.rows = this.rows.filter((row) => !idsToRemove.has(row.id));
    return { ...target };
  }

  async deleteMany(args: { where: { chatId: string } }): Promise<{ count: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.chatId !== args.where.chatId);
    return { count: before - this.rows.length };
  }
}

class FakePrisma {
  readonly assistantChatTodo: FakeAssistantChatTodoTable;
  constructor() {
    this.assistantChatTodo = new FakeAssistantChatTodoTable();
  }
  async $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function buildChat(overrides?: Partial<AssistantChat>): AssistantChat {
  const baseDate = new Date("2026-06-22T12:00:00.000Z");
  return {
    id: "chat-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web",
    surfaceThreadKey: "thread-1",
    title: "Demo chat",
    chatMode: "normal",
    deepModeEnabled: false,
    skillDecisionState: null,
    skillRetrievalState: null,
    lastMessageAt: baseDate,
    lastCrossSessionCarryOverAt: null,
    archivedAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides
  } as AssistantChat;
}

function buildChatRepository(chat: AssistantChat): AssistantChatRepository {
  return {
    async findChatBySurfaceThread(assistantId, surface, surfaceThreadKey) {
      if (
        assistantId === chat.assistantId &&
        surface === chat.surface &&
        surfaceThreadKey === chat.surfaceThreadKey
      ) {
        return chat;
      }
      return null;
    },
    async findChatById(chatId) {
      return chatId === chat.id ? chat : null;
    }
    // The rest of the interface is unused by AssistantChatTodosService for
    // Slice 1; cast to satisfy the type without dead-weight stubs.
  } as unknown as AssistantChatRepository;
}

function buildService(chat: AssistantChat): {
  service: AssistantChatTodosService;
  prisma: FakePrisma;
} {
  const prisma = new FakePrisma();
  const service = new AssistantChatTodosService(
    prisma as unknown as WorkspaceManagementPrismaService,
    buildChatRepository(chat)
  );
  return { service, prisma };
}

async function testAddCreatesRows(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const result = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [
        { content: "Research pricing tiers", status: "in_progress" },
        { content: "Draft the proposal" }
      ]
    }
  });
  assert.equal(result.action, "applied");
  assert.equal(result.reason, null);
  assert.equal(result.warning, null);
  assert.equal(result.todos.length, 2);
  assert.equal(result.todos[0]?.status, "in_progress");
  assert.equal(result.todos[1]?.status, "pending");
  assert.equal(result.totalCount, 2);
  assert.equal(prisma.assistantChatTodo.snapshot().length, 2);
}

async function testAddCoercesSecondInProgress(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  const result = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [
        { content: "First step", status: "in_progress" },
        { content: "Second step", status: "in_progress" }
      ]
    }
  });
  assert.equal(result.action, "applied");
  assert.ok(result.warning !== null && result.warning.includes("coerced to pending"));
  const inProgressCount = result.todos.filter((t) => t.status === "in_progress").length;
  assert.equal(inProgressCount, 1);
}

async function testAddRejectsCompletedParent(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Parent step" }] }
  });
  const list1 = await service.readWindowForSurfaceThread({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey
  });
  const parentId = list1.todos[0]?.id ?? "";
  await service.applyActionForChat({
    chatId: list1.chatId,
    assistantId: chat.assistantId,
    action: { kind: "complete", id: parentId }
  });

  await assert.rejects(
    service.applyAction({
      assistantId: chat.assistantId,
      channel: "web",
      surfaceThreadKey: chat.surfaceThreadKey,
      action: {
        kind: "add",
        items: [{ content: "Child step", parentId }]
      }
    }),
    BadRequestException
  );
}

async function testCompleteRejectsParentWithOpenChildren(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  const result1 = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [{ content: "Parent step", status: "in_progress" }]
    }
  });
  const parentId = result1.todos[0]?.id ?? "";
  await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [{ content: "Child step", parentId }]
    }
  });
  const blocked = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "complete", id: parentId }
  });
  assert.equal(blocked.action, "skipped");
  assert.equal(blocked.reason, "children_open");
}

async function testUpdateRejectsResurrectionOfCompleted(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  const created = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Lone step" }] }
  });
  const id = created.todos[0]?.id ?? "";
  await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "complete", id }
  });
  const resurrection = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "update", id, status: "pending" }
  });
  assert.equal(resurrection.action, "skipped");
  assert.equal(resurrection.reason, "completed_immutable");
}

async function testRemoveCascadesToChildren(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const parent = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Parent" }] }
  });
  const parentId = parent.todos[0]?.id ?? "";
  await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Child", parentId }] }
  });
  const removed = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "remove", id: parentId }
  });
  assert.equal(removed.action, "applied");
  assert.equal(removed.todos.length, 0);
  assert.equal(prisma.assistantChatTodo.snapshot().length, 0);
}

async function testClearWipesPlan(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [{ content: "A" }, { content: "B" }, { content: "C" }]
    }
  });
  const cleared = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "clear" }
  });
  assert.equal(cleared.action, "applied");
  assert.equal(cleared.todos.length, 0);
  assert.equal(prisma.assistantChatTodo.snapshot().length, 0);
}

async function testUnknownChatYieldsNotFound(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  await assert.rejects(
    service.applyAction({
      assistantId: "assistant-other",
      channel: "web",
      surfaceThreadKey: "thread-unknown",
      action: { kind: "clear" }
    }),
    NotFoundException
  );
}

function buildSelectorRow(overrides: {
  id: string;
  status: "pending" | "in_progress" | "completed";
  parentId?: string | null;
  sortOrder: number;
  completedAt?: Date | null;
}): {
  id: string;
  parentId: string | null;
  content: string;
  status: "pending" | "in_progress" | "completed";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
} {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    content: `Todo ${overrides.id}`,
    status: overrides.status,
    sortOrder: overrides.sortOrder,
    createdAt: new Date(Date.UTC(2026, 5, 22, 0, 0, overrides.sortOrder)),
    updatedAt: new Date(Date.UTC(2026, 5, 22, 0, 0, overrides.sortOrder)),
    completedAt: overrides.completedAt ?? null
  };
}

function testWindowSelectorRespectsCap(): void {
  const rows = [
    buildSelectorRow({ id: "1", status: "in_progress", sortOrder: 1 }),
    buildSelectorRow({ id: "2", status: "pending", sortOrder: 2 }),
    buildSelectorRow({ id: "3", status: "pending", sortOrder: 3 }),
    buildSelectorRow({ id: "4", status: "pending", sortOrder: 4 }),
    buildSelectorRow({ id: "5", status: "pending", sortOrder: 5 }),
    buildSelectorRow({ id: "6", status: "pending", sortOrder: 6 }),
    buildSelectorRow({ id: "7", status: "pending", sortOrder: 7 }),
    buildSelectorRow({ id: "8", status: "pending", sortOrder: 8 }),
    buildSelectorRow({ id: "9", status: "pending", sortOrder: 9 }),
    buildSelectorRow({ id: "10", status: "pending", sortOrder: 10 }),
    buildSelectorRow({
      id: "11",
      status: "completed",
      sortOrder: 11,
      completedAt: new Date(Date.UTC(2026, 5, 22, 5, 0, 0))
    }),
    buildSelectorRow({
      id: "12",
      status: "completed",
      sortOrder: 12,
      completedAt: new Date(Date.UTC(2026, 5, 22, 6, 0, 0))
    })
  ];
  const { todos, windowed } = selectChatPlanWindow(rows);
  assert.ok(todos.length <= 12);
  assert.equal(windowed, true);
}

function testWindowSelectorEmpty(): void {
  const { todos, windowed } = selectChatPlanWindow([]);
  assert.deepEqual(todos, []);
  assert.equal(windowed, false);
}

async function testReadFullPlanForWebReturnsAllCompletedRows(): Promise<void> {
  // The user-reported regression: after the model completes every seeded
  // scenario step, the model-prompt window (`selectChatPlanWindow`) caps
  // completed rows at the last two, so the web card was rendering
  // "Plan 2/5 +3 more hidden" with three rows invisibly stashed. The web
  // surface MUST surface all five completed rows so the user sees
  // "Plan 5/5" with every checkmark.
  const chat = buildChat();
  const { service } = buildService(chat);
  const add = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: {
      kind: "add",
      items: [
        { content: "Step 1" },
        { content: "Step 2" },
        { content: "Step 3" },
        { content: "Step 4" },
        { content: "Step 5" }
      ]
    }
  });
  assert.equal(add.action, "applied");
  for (const todo of add.todos) {
    const complete = await service.applyActionForChat({
      chatId: add.chatId,
      assistantId: chat.assistantId,
      action: { kind: "complete", id: todo.id }
    });
    assert.equal(complete.action, "applied", `complete must apply for id=${todo.id}`);
  }

  // Sanity: the model-prompt window collapses to two completed rows.
  const modelWindow = await service.readWindow({ chatId: add.chatId });
  assert.equal(modelWindow.totalCount, 5);
  assert.equal(modelWindow.todos.length, 2);
  assert.equal(modelWindow.windowed, true);

  // The user-facing full read returns every row, no `+N more hidden` tail.
  const fullPlan = await service.readFullPlanForWeb({ chatId: add.chatId });
  assert.equal(fullPlan.totalCount, 5);
  assert.equal(fullPlan.todos.length, 5);
  assert.equal(fullPlan.windowed, false);
  const allCompleted = fullPlan.todos.every((t) => t.status === "completed");
  assert.ok(allCompleted, "every full-plan row must be completed");
  const contents = fullPlan.todos.map((t) => t.content);
  assert.deepEqual(contents, ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]);
}

async function testReadFullPlanForWebFlagsOverflow(): Promise<void> {
  // When a plan grows past the per-call cap (50 rows) the response must
  // expose `windowed: true` and the real total so the card can render its
  // "+N more" tail.
  const chat = buildChat();
  const { service } = buildService(chat);
  const items = Array.from({ length: 60 }, (_, index) => ({
    content: `Item ${String(index + 1).padStart(2, "0")}`
  }));
  // The add path enforces a per-call max of 50, so split into two batches.
  const first = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: items.slice(0, 50) }
  });
  assert.equal(first.action, "applied");
  const second = await service.applyActionForChat({
    chatId: first.chatId,
    assistantId: chat.assistantId,
    action: { kind: "add", items: items.slice(50) }
  });
  assert.equal(second.action, "applied");

  const fullPlan = await service.readFullPlanForWeb({ chatId: first.chatId });
  assert.equal(fullPlan.totalCount, 60);
  assert.equal(fullPlan.todos.length, 50);
  assert.equal(fullPlan.windowed, true);
}

function testWindowSelectorKeepsChildrenWithParent(): void {
  const rows = [
    buildSelectorRow({ id: "parent", status: "in_progress", sortOrder: 1 }),
    buildSelectorRow({
      id: "child",
      status: "pending",
      sortOrder: 2,
      parentId: "parent"
    }),
    buildSelectorRow({ id: "other", status: "pending", sortOrder: 3 })
  ];
  const { todos } = selectChatPlanWindow(rows);
  const ids = todos.map((t) => t.id);
  assert.ok(ids.includes("parent"));
  assert.ok(ids.includes("child"));
  const parentIdx = ids.indexOf("parent");
  const childIdx = ids.indexOf("child");
  assert.ok(childIdx > parentIdx, "child must render after its parent");
}

export async function runAssistantChatTodosServiceTest(): Promise<void> {
  await testAddCreatesRows();
  await testAddCoercesSecondInProgress();
  await testAddRejectsCompletedParent();
  await testCompleteRejectsParentWithOpenChildren();
  await testUpdateRejectsResurrectionOfCompleted();
  await testRemoveCascadesToChildren();
  await testClearWipesPlan();
  await testUnknownChatYieldsNotFound();
  testWindowSelectorRespectsCap();
  testWindowSelectorEmpty();
  testWindowSelectorKeepsChildrenWithParent();
  await testReadFullPlanForWebReturnsAllCompletedRows();
  await testReadFullPlanForWebFlagsOverflow();
  console.log("[assistant-chat-todos.service] all tests passed");
}

if (process.argv[1] && process.argv[1].endsWith("assistant-chat-todos.service.test.ts")) {
  runAssistantChatTodosServiceTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
