import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { BuildReminderContextSnapshotService } from "../src/modules/workspace-management/application/build-reminder-context-snapshot.service";
import { ControlInternalScheduledActionService } from "../src/modules/workspace-management/application/control-internal-scheduled-action.service";

type TaskRow = {
  id: string;
  assistantId: string;
  title: string;
  audience: "user" | "assistant";
  actionType: string | null;
  controlStatus: "active" | "disabled" | "cancelled";
  nextRunAt: Date | null;
  externalRef: string | null;
  scheduleJson: unknown;
  actionPayloadJson?: unknown;
  payloadText?: string | null;
  schedulerClaimEpoch?: number | null;
};

class FakeAssistantRepository {
  async findById(id: string) {
    return {
      id,
      userId: "user-1",
      workspaceId: "workspace-1"
    };
  }
}

class FakeAssistantChannelSurfaceBindingRepository {
  patched: Array<{
    assistantId: string;
    provider: string;
    surface: string;
    patch: Record<string, unknown>;
  }> = [];
  binding = {
    assistantId: "assistant-1",
    provider: "telegram",
    surface: "telegram_bot",
    bindingState: "active",
    metadata: {
      telegramDmChatId: "dm-1",
      telegramDmUsername: "alex",
      telegramLastGroupChatId: "group-1",
      telegramLastGroupChatType: "supergroup",
      telegramLastGroupChatTitle: "Team Group"
    }
  };

  async findByAssistantProviderSurface() {
    return this.binding;
  }

  async patchMetadata(
    assistantId: string,
    provider: string,
    surface: string,
    patch: Record<string, unknown>
  ) {
    this.patched.push({ assistantId, provider, surface, patch });
  }
}

class FakeAssistantRuntimeFacade {
  controlCalls: unknown[] = [];

  async controlCronJob(input: unknown) {
    this.controlCalls.push(input);
    return {
      details: {
        id: "legacy-job",
        name: "Legacy reminder",
        enabled: false,
        state: {
          nextRunAtMs: Date.parse("2026-04-14T12:00:00.000Z")
        },
        schedule: {
          kind: "at"
        }
      }
    };
  }
}

class FakeSyncAssistantTaskRegistryService {
  calls: unknown[] = [];

  async execute(input: unknown) {
    this.calls.push(input);
    return { ok: true };
  }
}

class FakeResolveAssistantRuntimeTierService {
  async resolveByAssistantId() {
    return "paid_shared_restricted";
  }
}

class FakeAssistantChatRepository {
  async findChatBySurfaceThread() {
    return { id: "chat-1" };
  }

  async listMessagesByChatId() {
    return [
      {
        id: "m1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "Напоминание создам",
        createdAt: new Date("2026-04-13T10:00:00.000Z")
      },
      {
        id: "m2",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "Напомни вечером про релиз",
        createdAt: new Date("2026-04-13T10:01:00.000Z")
      }
    ];
  }
}

class FakeWorkspaceManagementPrismaService {
  rows: TaskRow[] = [];
  nextId = 1;

  assistantTaskRegistryItem = {
    create: async ({
      data,
      select
    }: {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => {
      const row: TaskRow = {
        id: `task-${this.nextId++}`,
        assistantId: String(data.assistantId),
        title: String(data.title),
        audience: data.audience as TaskRow["audience"],
        actionType: (data.actionType as string | null) ?? null,
        controlStatus: data.controlStatus as TaskRow["controlStatus"],
        nextRunAt: data.nextRunAt as Date | null,
        externalRef: (data.externalRef as string | null) ?? null,
        scheduleJson: data.scheduleJson,
        actionPayloadJson: data.actionPayloadJson,
        payloadText: (data.payloadText as string | null) ?? null
      };
      this.rows.push(row);
      return this.pick(row, select);
    },
    findFirst: async ({
      where,
      select
    }: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => {
      const row =
        this.rows.find(
          (entry) => entry.id === where.id && entry.assistantId === where.assistantId
        ) ?? null;
      return row === null ? null : this.pick(row, select);
    },
    update: async ({
      where,
      data
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find((entry) => entry.id === where.id);
      if (!row) {
        throw new Error("task row not found");
      }
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: { where: Record<string, unknown> }) => {
      this.rows = this.rows.filter((entry) => entry.id !== where.id);
      return {};
    }
  };

  private pick(row: TaskRow, select: Record<string, boolean>) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (select[key]) {
        result[key] = (row as Record<string, unknown>)[key];
      }
    }
    return result;
  }
}

async function runNativeCreateTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const runtimeFacade = new FakeAssistantRuntimeFacade();
  const syncService = new FakeSyncAssistantTaskRegistryService();
  const tierService = new FakeResolveAssistantRuntimeTierService();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    runtimeFacade as never,
    prisma as never,
    contextSnapshotService as never,
    syncService as never,
    tierService as never
  );

  const runAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const input = service.parseInput({
    assistantId: "assistant-1",
    action: "create",
    audience: "user",
    title: "Group reminder",
    reminderText: "Group reminder",
    runAt: runAtIso,
    contextMessages: 2,
    conversationContext: {
      channel: "telegram",
      externalThreadKey: "group-1"
    }
  });

  const result = await service.execute(input);

  assert.equal(runtimeFacade.controlCalls.length, 0);
  assert.equal(syncService.calls.length, 0);
  assert.equal(prisma.rows.length, 1);
  assert.equal(prisma.rows[0]?.audience, "user");
  assert.equal(prisma.rows[0]?.scheduleJson && typeof prisma.rows[0].scheduleJson, "object");
  assert.match(prisma.rows[0]?.payloadText ?? "", /Recent context:/);
  assert.match(prisma.rows[0]?.payloadText ?? "", /User: Напомни вечером про релиз/);
  assert.equal(bindingRepository.patched.length, 1);
  assert.deepEqual(result, {
    ok: true,
    created: true,
    task: {
      id: "task-1",
      title: "Group reminder",
      audience: "user",
      actionType: null,
      controlStatus: "active",
      nextRunAt: runAtIso
    }
  });

  const reminderTaskTargets = bindingRepository.patched[0]?.patch.reminderTaskTargets as Record<
    string,
    Record<string, unknown>
  >;
  const createdTarget = Object.values(reminderTaskTargets)[0];
  assert.equal(createdTarget?.chatId, "group-1");
  assert.equal(createdTarget?.chatType, "supergroup");
  assert.equal(createdTarget?.title, "Team Group");
  assert.equal(createdTarget?.source, "telegram_group");
}

async function runAssistantActionCreateTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const runtimeFacade = new FakeAssistantRuntimeFacade();
  const syncService = new FakeSyncAssistantTaskRegistryService();
  const tierService = new FakeResolveAssistantRuntimeTierService();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    runtimeFacade as never,
    prisma as never,
    contextSnapshotService as never,
    syncService as never,
    tierService as never
  );

  const input = service.parseInput({
    assistantId: "assistant-1",
    action: "create",
    audience: "assistant",
    title: "Project follow-up",
    reminderText: "Quietly decide whether a project follow-up would be helpful.",
    actionType: "follow_up",
    actionPayload: {
      topic: "project",
      suggestedDelayDays: 1
    },
    delayMs: 60_000,
    contextMessages: 2,
    conversationContext: {
      channel: "telegram",
      externalThreadKey: "group-1"
    }
  });

  const result = await service.execute(input);

  assert.equal(runtimeFacade.controlCalls.length, 0);
  assert.equal(syncService.calls.length, 0);
  assert.equal(prisma.rows.length, 1);
  assert.equal(prisma.rows[0]?.audience, "assistant");
  assert.equal(prisma.rows[0]?.actionType, "follow_up");
  assert.deepEqual(prisma.rows[0]?.actionPayloadJson, {
    topic: "project",
    suggestedDelayDays: 1
  });
  assert.match(prisma.rows[0]?.payloadText ?? "", /Quietly decide whether a project follow-up/);
  assert.equal(bindingRepository.patched.length, 0);
  assert.deepEqual(result, {
    ok: true,
    created: true,
    task: {
      id: "task-1",
      title: "Project follow-up",
      audience: "assistant",
      actionType: "follow_up",
      controlStatus: "active",
      nextRunAt: prisma.rows[0]?.nextRunAt?.toISOString() ?? null
    }
  });
}

async function runLegacyPauseFallbackTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const runtimeFacade = new FakeAssistantRuntimeFacade();
  const syncService = new FakeSyncAssistantTaskRegistryService();
  const tierService = new FakeResolveAssistantRuntimeTierService();
  const prisma = new FakeWorkspaceManagementPrismaService();
  prisma.rows.push({
    id: "task-legacy",
    assistantId: "assistant-1",
    title: "Legacy reminder",
    audience: "user",
    actionType: null,
    controlStatus: "active",
    nextRunAt: new Date("2026-04-14T12:00:00.000Z"),
    externalRef: "legacy-job",
    scheduleJson: null,
    payloadText: null
  });
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    runtimeFacade as never,
    prisma as never,
    contextSnapshotService as never,
    syncService as never,
    tierService as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    action: "pause",
    taskId: "task-legacy"
  });

  assert.equal(runtimeFacade.controlCalls.length, 1);
  assert.deepEqual(runtimeFacade.controlCalls[0], {
    runtimeTier: "paid_shared_restricted",
    action: "update",
    args: {
      id: "legacy-job",
      patch: {
        enabled: false
      }
    }
  });
  assert.equal(syncService.calls.length, 1);
  assert.deepEqual(result, {
    ok: true,
    paused: true,
    taskId: "task-legacy",
    title: "Legacy reminder"
  });
}

async function runNestedAssistantActionRejectedTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const runtimeFacade = new FakeAssistantRuntimeFacade();
  const syncService = new FakeSyncAssistantTaskRegistryService();
  const tierService = new FakeResolveAssistantRuntimeTierService();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    runtimeFacade as never,
    prisma as never,
    contextSnapshotService as never,
    syncService as never,
    tierService as never
  );

  const input = service.parseInput({
    assistantId: "assistant-1",
    action: "create",
    audience: "assistant",
    title: "Nested assistant action",
    reminderText: "Do not create nested background jobs.",
    actionType: "follow_up",
    delayMs: 1,
    contextSessionKey: "system:scheduled-action:abc-123"
  });

  await assert.rejects(
    () => service.execute(input),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("Nested assistant scheduled_action creation is not allowed")
  );
}

async function run(): Promise<void> {
  await runNativeCreateTest();
  await runAssistantActionCreateTest();
  await runLegacyPauseFallbackTest();
  await runNestedAssistantActionRejectedTest();
}

void run();
