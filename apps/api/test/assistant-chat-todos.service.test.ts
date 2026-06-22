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
  origin: "model_authored" | "scenario_seeded";
  seedSkillId: string | null;
  seedSkillLabel: string | null;
  seedScenarioKey: string | null;
  seedKey: string | null;
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
      origin: FakeTodoRow["origin"];
      seedSkillId?: string | null;
      seedSkillLabel?: string | null;
      seedScenarioKey?: string | null;
      seedKey?: string | null;
      sortOrder: number;
    };
  }): Promise<FakeTodoRow> {
    const now = this.currentDate();
    const seedKey = args.data.seedKey ?? null;
    const row: FakeTodoRow = {
      id: this.mintId("todo"),
      chatId: args.data.chatId,
      assistantId: args.data.assistantId,
      parentId: args.data.parentId,
      content: args.data.content,
      status: args.data.status,
      origin: args.data.origin,
      seedSkillId: args.data.seedSkillId ?? null,
      seedSkillLabel: args.data.seedSkillLabel ?? null,
      seedScenarioKey: args.data.seedScenarioKey ?? null,
      seedKey,
      sortOrder: args.data.sortOrder,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    this.rows.push(row);
    return { ...row };
  }

  async findFirst(args: {
    where: { chatId: string; seedKey?: string };
  }): Promise<{ id: string } | null> {
    const match = this.rows.find((row) => {
      if (row.chatId !== args.where.chatId) return false;
      const keyFilter = args.where.seedKey;
      if (keyFilter === undefined) return true;
      return row.seedKey === keyFilter;
    });
    return match ? { id: match.id } : null;
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

async function testSeedSkillScenarioTopLevel(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const outcome = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: "00000000-0000-0000-0000-000000000001",
    skillLabel: "Marketer",
    scenarioKey: "instagram_carousel",
    seedKey: "00000000-0000-0000-0000-000000000001::instagram_carousel::",
    directives: ["  Gather   brief from user  ", "Generate slides", ""]
  });
  assert.equal(outcome.kind, "seeded");
  if (outcome.kind !== "seeded") return;
  assert.equal(outcome.insertedCount, 2);
  assert.equal(outcome.todos.length, 2);
  const snap = prisma.assistantChatTodo.snapshot();
  assert.equal(snap.length, 2);
  const expectedSeedKey = "00000000-0000-0000-0000-000000000001::instagram_carousel::";
  for (const row of snap) {
    assert.equal(row.parentId, null);
    assert.equal(row.origin, "scenario_seeded");
    assert.equal(row.status, "pending");
    assert.equal(row.seedSkillLabel, "Marketer");
    assert.equal(row.seedScenarioKey, "instagram_carousel");
    assert.equal(row.seedSkillId, "00000000-0000-0000-0000-000000000001");
    assert.equal(
      row.seedKey,
      expectedSeedKey,
      `expected every row of one seeded batch to share the same seedKey but got ${
        row.seedKey ?? "null"
      }`
    );
  }
  assert.equal(snap[0]?.content, "Gather brief from user");
  assert.equal(snap[1]?.content, "Generate slides");
  assert.ok((snap[1]?.sortOrder ?? 0) > (snap[0]?.sortOrder ?? 0));
}

async function testSeedSkillScenarioUnderDeepestInProgress(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const root = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Root", status: "in_progress" }] }
  });
  const rootId = root.todos[0]?.id ?? "";
  const child = await service.applyAction({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    action: { kind: "add", items: [{ content: "Child", parentId: rootId, status: "in_progress" }] }
  });
  const childId = child.todos.find((t) => t.parentId === rootId)?.id ?? "";

  const outcome = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: "Marketer",
    scenarioKey: "deep_scenario",
    seedKey: "marketer::deep_scenario::",
    directives: ["Step A", "Step B"]
  });
  assert.equal(outcome.kind, "seeded");
  if (outcome.kind !== "seeded") return;
  const snap = prisma.assistantChatTodo.snapshot();
  const seeded = snap.filter((row) => row.origin === "scenario_seeded");
  assert.equal(seeded.length, 2);
  for (const row of seeded) {
    assert.equal(row.parentId, childId);
  }
}

async function testSeedSkillScenarioIdempotency(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const seedKey = "skill-1::scenario-x::v1";
  const first = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: null,
    scenarioKey: "scenario-x",
    seedKey,
    directives: ["First", "Second"]
  });
  assert.equal(first.kind, "seeded");
  assert.equal(prisma.assistantChatTodo.snapshot().length, 2);

  const second = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: null,
    scenarioKey: "scenario-x",
    seedKey,
    directives: ["First", "Second"]
  });
  assert.equal(second.kind, "already_seeded");
  assert.equal(prisma.assistantChatTodo.snapshot().length, 2, "second seed must not add rows");
}

async function testSeedSkillScenarioNoDirectivesSkipped(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const outcome = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: null,
    scenarioKey: "empty_scenario",
    seedKey: "empty::scenario::",
    directives: ["   ", ""]
  });
  assert.equal(outcome.kind, "skipped");
  if (outcome.kind === "skipped") {
    assert.equal(outcome.reason, "no_directives");
  }
  assert.equal(prisma.assistantChatTodo.snapshot().length, 0);
}

async function testSeedSkillScenarioTruncatesOverlongDirectives(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const long = "x".repeat(500);
  const outcome = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: null,
    scenarioKey: "trunc",
    seedKey: "trunc::scenario::",
    directives: [long]
  });
  assert.equal(outcome.kind, "seeded");
  const snap = prisma.assistantChatTodo.snapshot();
  assert.equal(snap.length, 1);
  const content = snap[0]?.content ?? "";
  // ADR-125 — scenario step titles are capped at SCENARIO_STEP_TITLE_MAX_CHARS (80).
  assert.ok(
    content.length <= 80,
    `expected scenario step title to fit in 80 chars, got ${content.length}`
  );
  assert.ok(content.endsWith("…"), "long directive must be truncated with an ellipsis");
}

async function testSeedSkillScenarioDerivesTitleFromColonSeparator(): Promise<void> {
  // Mirrors the actual Маркетолог step shape seen in the live plan card:
  // a short imperative headline, a colon, then a long enumeration of detail.
  // The card row should carry only the headline.
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  const outcome = await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: "Маркетолог",
    scenarioKey: "instagram_carousel",
    seedKey: "marketer::instagram_carousel::",
    directives: [
      "Уточни короткий бриф: аудитория, продукт/услуга, главное сообщение, желаемое действие (CTA), тональность бренда и любые табу. Если что-то критичное отсутствует, задай 1–3 точечных вопроса и подожди ответ перед продолжением.",
      "Спроектируй нарратив на 4 слайда по схеме: 1) хук, 2) проблема/боль, 3) инсайт, 4) решение/оффер.",
      "Step A.",
      "Step B"
    ]
  });
  assert.equal(outcome.kind, "seeded");
  const snap = prisma.assistantChatTodo.snapshot();
  assert.equal(snap.length, 4);
  assert.equal(snap[0]?.content, "Уточни короткий бриф");
  assert.equal(snap[1]?.content, "Спроектируй нарратив на 4 слайда по схеме");
  // Trailing period dropped on a short single-sentence directive.
  assert.equal(snap[2]?.content, "Step A");
  // No terminator → returned verbatim.
  assert.equal(snap[3]?.content, "Step B");
}

async function testSeedSkillScenarioRejectsMissingScenarioKey(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  await assert.rejects(
    service.seedSkillScenarioTodos({
      assistantId: chat.assistantId,
      channel: "web",
      surfaceThreadKey: chat.surfaceThreadKey,
      skillId: null,
      skillLabel: null,
      scenarioKey: "   ",
      seedKey: "valid::seed::",
      directives: ["A"]
    }),
    BadRequestException
  );
}

async function testSeedSkillScenarioRejectsMissingSeedKey(): Promise<void> {
  const chat = buildChat();
  const { service } = buildService(chat);
  await assert.rejects(
    service.seedSkillScenarioTodos({
      assistantId: chat.assistantId,
      channel: "web",
      surfaceThreadKey: chat.surfaceThreadKey,
      skillId: null,
      skillLabel: null,
      scenarioKey: "scenario",
      seedKey: "",
      directives: ["A"]
    }),
    BadRequestException
  );
}

async function testSeedSkillScenarioReleaseDoesNotDeleteSeeded(): Promise<void> {
  const chat = buildChat();
  const { service, prisma } = buildService(chat);
  await service.seedSkillScenarioTodos({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey,
    skillId: null,
    skillLabel: "Marketer",
    scenarioKey: "release_test",
    seedKey: "skill::release_test::",
    directives: ["Persistent step"]
  });
  assert.equal(prisma.assistantChatTodo.snapshot().length, 1);
  // The runtime "release" path only calls updateSkillState, not the todos
  // service, so seeded todos persist by construction. This test pins the
  // invariant from the API side: there is no service method that mass-deletes
  // by skill or scenario engagement state.
  const window = await service.readWindowForSurfaceThread({
    assistantId: chat.assistantId,
    channel: "web",
    surfaceThreadKey: chat.surfaceThreadKey
  });
  assert.equal(window.todos.length, 1);
}

function buildSelectorRow(overrides: {
  id: string;
  status: "pending" | "in_progress" | "completed";
  parentId?: string | null;
  sortOrder: number;
  origin?: "model_authored" | "scenario_seeded";
  seedSkillLabel?: string | null;
  completedAt?: Date | null;
}): {
  id: string;
  parentId: string | null;
  content: string;
  status: "pending" | "in_progress" | "completed";
  origin: "model_authored" | "scenario_seeded";
  seedSkillLabel: string | null;
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
    origin: overrides.origin ?? "model_authored",
    seedSkillLabel: overrides.seedSkillLabel ?? null,
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
  await testSeedSkillScenarioTopLevel();
  await testSeedSkillScenarioUnderDeepestInProgress();
  await testSeedSkillScenarioIdempotency();
  await testSeedSkillScenarioNoDirectivesSkipped();
  await testSeedSkillScenarioTruncatesOverlongDirectives();
  await testSeedSkillScenarioDerivesTitleFromColonSeparator();
  await testSeedSkillScenarioRejectsMissingScenarioKey();
  await testSeedSkillScenarioRejectsMissingSeedKey();
  await testSeedSkillScenarioReleaseDoesNotDeleteSeeded();
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
