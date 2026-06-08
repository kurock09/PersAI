import assert from "node:assert/strict";
import { CompactionAdvisoryFollowUpService } from "../src/modules/workspace-management/application/compaction-advisory-follow-up.service";

const intents: Array<Record<string, unknown>> = [];

function createService(): CompactionAdvisoryFollowUpService {
  const assistantRepository = {
    findById: async (id: string) => ({ id })
  };
  const prisma = {
    notificationPolicy: {
      findUnique: async () => ({
        enabled: true,
        cooldownMinutes: 60,
        config: {}
      })
    },
    runtimeSession: {
      findFirst: async () => ({
        id: "session-1",
        currentTokens: 12_000,
        compactionHintTokens: 12_100,
        totalTokensFresh: true,
        compactionCount: 3,
        updatedAt: new Date("2026-06-09T00:00:00.000Z")
      })
    },
    runtimeSessionCompaction: {
      findMany: async () => [
        { reason: "auto_compaction" },
        { reason: "auto_compaction" },
        { reason: "auto_compaction" }
      ]
    },
    notificationIntent: {
      findMany: async () => []
    },
    assistant: {
      findUnique: async () => ({
        draftDisplayName: "PersAI",
        user: { displayName: "Alex" },
        workspace: { locale: "ru", timezone: "UTC" }
      })
    },
    assistantChatMessage: {
      findMany: async () => []
    }
  };
  const specService = {
    resolveCurrent: async () => ({
      runtimeBundle: {
        runtime: {
          sharedCompaction: { reserveTokens: 10_000 },
          contextHydration: { autoCompactionWeb: true, autoCompactionTelegram: true }
        }
      },
      runtimeBundleDocument: JSON.stringify({ ok: true })
    })
  };
  const quotaStatusService = {
    execute: async () => ({
      currentPlan: { code: "start", name: "Start" },
      advisories: {},
      advisoryCandidates: [],
      visiblePlans: [],
      packageOffers: [],
      monthlyToolQuotas: null,
      tools: [],
      buckets: []
    })
  };
  const notificationIntentService = {
    createIntent: async (input: Record<string, unknown>) => {
      intents.push(input);
      return { id: "intent-1" };
    }
  };
  return new CompactionAdvisoryFollowUpService(
    assistantRepository as never,
    prisma as never,
    specService as never,
    quotaStatusService as never,
    notificationIntentService as never
  );
}

async function run(): Promise<void> {
  intents.length = 0;
  const service = createService();
  const result = await service.maybeCreateFollowUp({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    chatId: "chat-1",
    surface: "web",
    surfaceThreadKey: "thread-1",
    externalUserKey: "user-1",
    mainAssistantMessage: "Done.",
    traceId: "trace-1"
  });

  assert.deepEqual(result, { intentId: "intent-1" });
  assert.equal(intents.length, 1);
  const intent = intents[0]!;
  assert.equal(intent["renderStrategy"], "static_fallback");
  assert.equal(intent["source"], "quota_advisory");
  const payload = intent["factPayload"] as Record<string, unknown>;
  assert.equal(payload["advisoryKind"], "compaction_exhausted");
  assert.match(String(payload["pushText"]), /лимит контекста текущего плана/);
}

void run();
