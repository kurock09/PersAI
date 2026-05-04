import assert from "node:assert/strict";
import { AutoSkillRoutingStateService } from "../src/modules/workspace-management/application/auto-skill-routing-state.service";

async function run(): Promise<void> {
  const chatUpdates: Array<Record<string, unknown>> = [];
  const service = new AutoSkillRoutingStateService(
    {
      platformRuntimeProviderSettings: {
        findUnique: async () => ({
          routerPolicy: {
            skillRoutingPolicy: {
              initialCheckUserMessageIndex: 3,
              backgroundRecheckIntervalMessages: 5
            }
          }
        })
      },
      assistantChat: {
        update: async (input: Record<string, unknown>) => {
          chatUpdates.push(input);
          return null;
        }
      }
    } as never,
    {} as never
  );

  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет" }]
    }),
    false
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 2,
      recentMessages: [
        { role: "user", text: "У меня вес стоит" },
        { role: "assistant", text: "Расскажи про рацион." },
        { role: "user", text: "Калории 1800" }
      ]
    }),
    false
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Белка 120" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 4,
      recentMessages: [{ role: "user", text: "Unrelated" }]
    }),
    false
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 5
      },
      currentUserMessageIndex: 8,
      recentMessages: [{ role: "user", text: "А если добавить кардио?" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: "weight loss and diabetes",
        confidence: "medium",
        checkedAtMessageIndex: 19,
        messageCountSinceCheck: 5
      },
      currentUserMessageIndex: 24,
      recentMessages: [{ role: "user", text: "Составь меню на день при диабете 1 типа" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      state: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: "weight loss and diabetes",
        confidence: "medium",
        checkedAtMessageIndex: 22,
        messageCountSinceCheck: 1
      },
      currentUserMessageIndex: 23,
      recentMessages: [{ role: "user", text: "Именно про диабет" }]
    }),
    false
  );

  await service.markBackgroundCheckQueued({
    chatId: "chat-1",
    context: {
      state: null,
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Белка 120" }]
    }
  });
  assert.deepEqual(chatUpdates[0], {
    where: { id: "chat-1" },
    data: {
      autoSkillRoutingState: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: null,
        confidence: "low",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 0,
        backgroundCheckQueuedAtMessageIndex: 3
      }
    }
  });

  await service.markBackgroundCheckQueued({
    chatId: "chat-2",
    context: {
      state: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 5
      },
      currentUserMessageIndex: 8,
      recentMessages: [{ role: "user", text: "А если добавить кардио?" }]
    }
  });
  assert.deepEqual(chatUpdates[1], {
    where: { id: "chat-2" },
    data: {
      autoSkillRoutingState: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 8,
        messageCountSinceCheck: 0,
        backgroundCheckQueuedAtMessageIndex: 8
      }
    }
  });
}

void run();
