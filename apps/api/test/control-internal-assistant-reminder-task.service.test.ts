import assert from "node:assert/strict";
import { ControlInternalAssistantReminderTaskService } from "../src/modules/workspace-management/application/control-internal-assistant-reminder-task.service";

class FakeAssistantRepository {
  async findById(id: string) {
    return { id };
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

class FakeAssistantTaskRegistryRepository {
  async findByIdAndAssistantId() {
    return null;
  }

  async listByAssistantId() {
    return [];
  }
}

class FakeAssistantRuntimeFacade {
  controlCalls: unknown[] = [];

  async controlCronJob(input: unknown) {
    this.controlCalls.push(input);
    return {
      details: {
        id: "job-1",
        name: "Group reminder",
        enabled: true,
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

async function run(): Promise<void> {
  const assistantRepository = new FakeAssistantRepository();
  const bindingRepository = new FakeAssistantChannelSurfaceBindingRepository();
  const taskRepository = new FakeAssistantTaskRegistryRepository();
  const runtimeFacade = new FakeAssistantRuntimeFacade();
  const syncService = new FakeSyncAssistantTaskRegistryService();
  const tierService = new FakeResolveAssistantRuntimeTierService();

  const service = new ControlInternalAssistantReminderTaskService(
    assistantRepository as never,
    bindingRepository as never,
    taskRepository as never,
    runtimeFacade as never,
    syncService as never,
    tierService as never
  );

  const input = service.parseInput({
    assistantId: "assistant-1",
    action: "create",
    title: "Group reminder",
    reminderText: "Group reminder",
    callbackBaseUrl: "https://persai.example",
    runAt: "2026-04-14T12:00:00.000Z",
    conversationContext: {
      channel: "telegram",
      externalThreadKey: "group-1"
    }
  });

  const result = await service.execute(input);

  assert.deepEqual(runtimeFacade.controlCalls, [
    {
      runtimeTier: "paid_shared_restricted",
      action: "add",
      args: {
        job: {
          name: "Group reminder",
          schedule: {
            kind: "at",
            at: "2026-04-14T12:00:00.000Z"
          },
          payload: {
            kind: "systemEvent",
            text: "Group reminder"
          },
          enabled: true,
          delivery: {
            mode: "webhook",
            to: "https://persai.example/api/v1/internal/cron-fire?assistantId=assistant-1"
          }
        }
      }
    }
  ]);
  assert.equal(bindingRepository.patched.length, 1);
  assert.equal(syncService.calls.length, 1);
  assert.deepEqual(result, {
    ok: true,
    created: true,
    task: {
      id: null,
      title: "Group reminder",
      controlStatus: "active",
      nextRunAt: "2026-04-14T12:00:00.000Z"
    }
  });

  const reminderTaskTargets = bindingRepository.patched[0]?.patch.reminderTaskTargets as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(reminderTaskTargets["job-1"]?.chatId, "group-1");
  assert.equal(reminderTaskTargets["job-1"]?.chatType, "supergroup");
  assert.equal(reminderTaskTargets["job-1"]?.title, "Team Group");
  assert.equal(reminderTaskTargets["job-1"]?.source, "telegram_group");
}

void run();
