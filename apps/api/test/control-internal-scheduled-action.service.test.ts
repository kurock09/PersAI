import assert from "node:assert/strict";
import { BadRequestException, ConflictException } from "@nestjs/common";
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
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    prisma as never,
    contextSnapshotService as never
  );

  const runAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const input = service.parseInput({
    assistantId: "assistant-1",
    action: "create",
    kind: "user_reminder",
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

async function runAssistantActionCreateRejectedTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    prisma as never,
    contextSnapshotService as never
  );

  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        action: "create",
        kind: "assistant_check",
        title: "Project follow-up",
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
      }),
    (error) =>
      error instanceof BadRequestException && error.message.includes('kind must be "user_reminder"')
  );
  assert.equal(prisma.rows.length, 0);
  assert.equal(bindingRepository.patched.length, 0);
}

async function runLegacyPauseRejectedTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
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
    prisma as never,
    contextSnapshotService as never
  );

  await assert.rejects(
    () =>
      service.execute({
        assistantId: "assistant-1",
        action: "pause",
        taskId: "task-legacy"
      }),
    (error) =>
      error instanceof ConflictException && error.message.includes("retired legacy scheduler")
  );
  assert.equal(prisma.rows.length, 1);
}

async function runLegacyCancelFallbackTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
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
    prisma as never,
    contextSnapshotService as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    action: "cancel",
    taskId: "task-legacy"
  });

  assert.equal(prisma.rows.length, 0);
  assert.deepEqual(result, {
    ok: true,
    cancelled: true,
    taskId: "task-legacy",
    title: "Legacy reminder"
  });
}

async function runAssistantCheckRequiresNonEmptyPayloadTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    prisma as never,
    contextSnapshotService as never
  );

  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        action: "create",
        kind: "assistant_check",
        title: "пнуть пользователя через 2 минуты",
        actionType: "check_status",
        delayMs: 120_000,
        conversationContext: {
          channel: "telegram",
          externalThreadKey: "group-1"
        }
      }),
    (error) =>
      error instanceof BadRequestException && error.message.includes('kind must be "user_reminder"')
  );
  assert.equal(prisma.rows.length, 0);
  assert.equal(bindingRepository.patched.length, 0);
}

async function runUserReminderRejectsHiddenFieldsTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    prisma as never,
    contextSnapshotService as never
  );

  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        action: "create",
        kind: "user_reminder",
        title: "пнуть пользователя через 2 минуты",
        reminderText: "Пора вернуться 🙂",
        actionType: "check_status",
        actionPayload: { foo: "bar" },
        delayMs: 120_000
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("Use background_task for assistant-side background work.")
  );
}

async function runNestedAssistantActionRejectedTest(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const prisma = new FakeWorkspaceManagementPrismaService();
  const contextSnapshotService = new BuildReminderContextSnapshotService(
    new FakeAssistantChatRepository() as never
  );

  const service = new ControlInternalScheduledActionService(
    assistantRepository as never,
    bindingRepository as never,
    prisma as never,
    contextSnapshotService as never
  );

  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        action: "create",
        kind: "assistant_check",
        title: "Nested assistant action",
        actionType: "follow_up",
        actionPayload: {
          topic: "nested"
        },
        delayMs: 1,
        contextSessionKey: "system:scheduled-action:abc-123"
      }),
    (error) =>
      error instanceof BadRequestException && error.message.includes('kind must be "user_reminder"')
  );
}

async function run(): Promise<void> {
  await runNativeCreateTest();
  await runAssistantActionCreateRejectedTest();
  await runAssistantCheckRequiresNonEmptyPayloadTest();
  await runUserReminderRejectsHiddenFieldsTest();
  await runLegacyPauseRejectedTest();
  await runLegacyCancelFallbackTest();
  await runNestedAssistantActionRejectedTest();
}

void run();
