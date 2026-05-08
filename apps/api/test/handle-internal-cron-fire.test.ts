import assert from "node:assert/strict";
import { HandleInternalCronFireService } from "../src/modules/workspace-management/application/handle-internal-cron-fire.service";
import { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";

type IntentCreate = { workspaceId: string; source: string; factPayload: Record<string, unknown> };

function createService(params: {
  prisma: unknown;
  bindingRepository: unknown;
  intentCreates?: IntentCreate[];
}): HandleInternalCronFireService {
  const intentCreates = params.intentCreates ?? [];
  const notificationIntentService = {
    createIntent: async (input: IntentCreate) => {
      intentCreates.push(input);
      return {
        id: `intent-${intentCreates.length}`,
        lifecycleStatus: "pending",
        dedupeKey: (input as Record<string, unknown>).dedupeKey ?? null
      };
    }
  } as unknown as NotificationIntentService;

  return new HandleInternalCronFireService(
    params.prisma as never,
    params.bindingRepository as never,
    notificationIntentService
  );
}

function makeDefaultPrisma() {
  return {
    assistant: {
      findUnique: async () => ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1"
      })
    },
    assistantTaskRegistryItem: {
      deleteMany: async () => ({ count: 1 }),
      updateMany: async () => ({ count: 0 })
    },
    assistantChannelSurfaceBinding: {
      findFirst: async () => null,
      update: async () => ({})
    }
  };
}

function makeDefaultBindingRepository() {
  return {
    claimReminderDeliveryProcessing: async () => "claimed" as const,
    getCompletedReminderDeliveryProcessing: async () => null,
    completeReminderDeliveryProcessing: async () => undefined,
    releaseReminderDeliveryProcessing: async () => undefined
  };
}

async function runReminderCreatesIntent(): Promise<void> {
  const intentCreates: IntentCreate[] = [];
  const service = createService({
    prisma: makeDefaultPrisma(),
    bindingRepository: makeDefaultBindingRepository(),
    intentCreates
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary: "Пора спать!"
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveredTo, "none");
  assert.equal(intentCreates.length, 1);
  assert.equal(intentCreates[0].source, "reminder");
  assert.equal((intentCreates[0] as Record<string, unknown>).class, "conversational");
  assert.equal((intentCreates[0] as Record<string, unknown>).priority, "immediate");
  assert.equal((intentCreates[0] as Record<string, unknown>).respectQuietHours, false);
  assert.equal(intentCreates[0].factPayload["pushText"], "Пора спать!");
}

async function runNoIntentWhenStatusError(): Promise<void> {
  const intentCreates: IntentCreate[] = [];
  const service = createService({
    prisma: makeDefaultPrisma(),
    bindingRepository: makeDefaultBindingRepository(),
    intentCreates
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "error",
    error: "Runtime crashed"
  });

  assert.equal(result.deliveredTo, "none");
  assert.equal(intentCreates.length, 0);
}

async function runNoIntentWhenNoSummary(): Promise<void> {
  const intentCreates: IntentCreate[] = [];
  const service = createService({
    prisma: makeDefaultPrisma(),
    bindingRepository: makeDefaultBindingRepository(),
    intentCreates
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok"
  });

  assert.equal(result.deliveredTo, "none");
  assert.equal(intentCreates.length, 0);
}

async function runReminderReplayDedupTest(): Promise<void> {
  const intentCreates: IntentCreate[] = [];
  const replayStates = new Map<
    string,
    { active?: string; completed?: { replayKey: string; deliveredTo: "none" } }
  >();
  const key = "assistant-1:system_notifications:system_notification";

  const bindingRepository = {
    claimReminderDeliveryProcessing: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      replayKey: string
    ) => {
      const state = replayStates.get(key) ?? {};
      if (state.completed?.replayKey === replayKey) return "duplicate_handled";
      if (state.active === replayKey) return "duplicate_inflight";
      replayStates.set(key, { ...state, active: replayKey });
      return "claimed" as const;
    },
    getCompletedReminderDeliveryProcessing: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      replayKey: string
    ) => {
      const state = replayStates.get(key);
      return state?.completed?.replayKey === replayKey
        ? { replayKey, deliveredTo: "none" as const, completedAt: "2026-04-06T00:00:00.000Z" }
        : null;
    },
    completeReminderDeliveryProcessing: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      state: { replayKey: string; deliveredTo: "none" }
    ) => {
      replayStates.set(key, { completed: state });
    },
    releaseReminderDeliveryProcessing: async () => undefined
  };

  const service = createService({
    prisma: makeDefaultPrisma(),
    bindingRepository,
    intentCreates
  });

  const first = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    sessionId: "cron-run-1",
    runAtMs: 1712352000000,
    summary: "Пора спать!"
  });

  const second = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    sessionId: "cron-run-1",
    runAtMs: 1712352000000,
    summary: "Пора спать!"
  });

  assert.equal(first.deliveredTo, "none");
  assert.equal(second.deliveredTo, "none");
  assert.equal(intentCreates.length, 1, "Only one intent should be created for duplicate fires");
}

async function run(): Promise<void> {
  await runReminderCreatesIntent();
  await runNoIntentWhenStatusError();
  await runNoIntentWhenNoSummary();
  await runReminderReplayDedupTest();
  console.log("handle-internal-cron-fire tests passed");
}

void run();
