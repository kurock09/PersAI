import assert from "node:assert/strict";
import {
  AutoSkillRoutingStateService,
  createEnabledSkillBootstrapCadenceState,
  createInactiveSkillDecisionState,
  createNewChatSkillCadenceState
} from "../src/modules/workspace-management/application/auto-skill-routing-state.service";

async function run(): Promise<void> {
  const chatUpdates: Array<Record<string, unknown>> = [];
  const chatStateById = new Map<
    string,
    {
      skillDecisionState: Record<string, unknown> | null;
      skillCadenceState: Record<string, unknown> | null;
    }
  >();
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
        findUnique: async ({ where }: { where: { id: string } }) => ({
          skillDecisionState: chatStateById.get(where.id)?.skillDecisionState ?? null,
          skillCadenceState: chatStateById.get(where.id)?.skillCadenceState ?? null
        }),
        update: async (input: Record<string, unknown>) => {
          chatUpdates.push(input);
          const where = input.where as { id: string };
          const data = input.data as {
            skillDecisionState?: Record<string, unknown> | null;
            skillCadenceState?: Record<string, unknown> | null;
          };
          chatStateById.set(where.id, {
            skillDecisionState: (data.skillDecisionState as Record<string, unknown>) ?? null,
            skillCadenceState: (data.skillCadenceState as Record<string, unknown>) ?? null
          });
          return null;
        }
      }
    } as never,
    {
      clearForChatWhenSkillMismatches: async () => undefined
    } as never
  );

  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: null,
      cadence: createNewChatSkillCadenceState(),
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет" }]
    }),
    false
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: null,
      cadence: createNewChatSkillCadenceState(),
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
      decision: null,
      cadence: createNewChatSkillCadenceState(),
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Белка 120" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: null,
      cadence: createNewChatSkillCadenceState(),
      currentUserMessageIndex: 4,
      recentMessages: [{ role: "user", text: "Unrelated" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 3
      },
      cadence: {
        messageCountSinceCheck: 5,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
      },
      currentUserMessageIndex: 8,
      recentMessages: [{ role: "user", text: "А если добавить кардио?" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: createInactiveSkillDecisionState({
        checkedAtMessageIndex: 19,
        confidence: "medium",
        topicSummary: "weight loss and diabetes"
      }),
      cadence: {
        messageCountSinceCheck: 5,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
      },
      currentUserMessageIndex: 24,
      recentMessages: [{ role: "user", text: "Составь меню на день при диабете 1 типа" }]
    }),
    true
  );
  assert.equal(
    await service.shouldRunBackgroundCheck({
      decision: createInactiveSkillDecisionState({
        checkedAtMessageIndex: 22,
        confidence: "medium",
        topicSummary: "weight loss and diabetes"
      }),
      cadence: {
        messageCountSinceCheck: 1,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
      },
      currentUserMessageIndex: 23,
      recentMessages: [{ role: "user", text: "Именно про диабет" }]
    }),
    false
  );

  await service.markBackgroundCheckQueued({
    chatId: "chat-1",
    context: {
      decision: null,
      cadence: createNewChatSkillCadenceState(),
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Белка 120" }]
    }
  });
  assert.deepEqual((chatUpdates[0]?.where as { id: string } | undefined)?.id, "chat-1");
  assert.deepEqual(
    (chatUpdates[0]?.data as { skillCadenceState?: Record<string, unknown> } | undefined)
      ?.skillCadenceState,
    {
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: 3,
      needsBootstrap: true,
      bootstrapReason: "new_chat"
    }
  );

  await service.markBackgroundCheckQueued({
    chatId: "chat-2",
    context: {
      decision: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 3
      },
      cadence: {
        messageCountSinceCheck: 5,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
      },
      currentUserMessageIndex: 8,
      recentMessages: [{ role: "user", text: "А если добавить кардио?" }]
    }
  });
  assert.deepEqual((chatUpdates[1]?.where as { id: string } | undefined)?.id, "chat-2");
  assert.deepEqual(
    (chatUpdates[1]?.data as { skillDecisionState?: Record<string, unknown> } | undefined)
      ?.skillDecisionState,
    {
      status: "active",
      activeSkillId: "skill-diet",
      activeSkillName: "Диетолог",
      topicSummary: "nutrition",
      confidence: "high",
      checkedAtMessageIndex: 3
    }
  );
  assert.deepEqual(
    (chatUpdates[1]?.data as { skillCadenceState?: Record<string, unknown> } | undefined)
      ?.skillCadenceState,
    {
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: 8,
      needsBootstrap: false,
      bootstrapReason: null
    }
  );

  chatStateById.set("chat-3", {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "persai landing copy",
      confidence: "high",
      checkedAtMessageIndex: 87
    },
    skillCadenceState: {
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });
  const updatesBeforeStalePersist = chatUpdates.length;
  await service.persistFromTurnRouting({
    chatId: "chat-3",
    currentUserMessageIndex: 88,
    turnRouting: {
      skillState: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 82
      }
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeStalePersist + 1);
  assert.deepEqual(chatStateById.get("chat-3"), {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "persai landing copy",
      confidence: "high",
      checkedAtMessageIndex: 87
    },
    skillCadenceState: {
      messageCountSinceCheck: 1,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });
  const updatesBeforeEqualIndexRevive = chatUpdates.length;
  await service.persistFromSkillCheckResult({
    chatId: "chat-3",
    result: {
      requestId: "request-equal-index-revive",
      skillState: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 87
      }
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeEqualIndexRevive);
  assert.deepEqual(chatStateById.get("chat-3"), {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "persai landing copy",
      confidence: "high",
      checkedAtMessageIndex: 87
    },
    skillCadenceState: {
      messageCountSinceCheck: 1,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });
  const updatesBeforeStaleQueue = chatUpdates.length;
  await service.markBackgroundCheckQueued({
    chatId: "chat-3",
    context: {
      decision: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 82
      },
      cadence: createEnabledSkillBootstrapCadenceState(),
      currentUserMessageIndex: 82,
      recentMessages: [{ role: "user", text: "Сделай БЖУ" }]
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeStaleQueue);
  assert.deepEqual(chatStateById.get("chat-3"), {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "persai landing copy",
      confidence: "high",
      checkedAtMessageIndex: 87
    },
    skillCadenceState: {
      messageCountSinceCheck: 1,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });

  await service.persistFromTurnRouting({
    chatId: "chat-3",
    currentUserMessageIndex: 88,
    turnRouting: {}
  });
  assert.deepEqual(chatStateById.get("chat-3"), {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "persai landing copy",
      confidence: "high",
      checkedAtMessageIndex: 87
    },
    skillCadenceState: {
      messageCountSinceCheck: 2,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });

  chatStateById.set("chat-4", {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "image generation",
      confidence: "high",
      checkedAtMessageIndex: 12
    },
    skillCadenceState: {
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });
  await service.persistFromTurnRouting({
    chatId: "chat-4",
    currentUserMessageIndex: 13,
    turnRouting: {
      skillState: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: "image generation",
        confidence: "high",
        checkedAtMessageIndex: 12
      }
    }
  });
  assert.deepEqual(chatStateById.get("chat-4"), {
    skillDecisionState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: "image generation",
      confidence: "high",
      checkedAtMessageIndex: 12
    },
    skillCadenceState: {
      messageCountSinceCheck: 1,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    }
  });
}

void run();
