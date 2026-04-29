import assert from "node:assert/strict";
import { AssistantNotificationDeliveryService } from "../src/modules/workspace-management/application/assistant-notification-delivery.service";
import { AssistantNotificationOutboxService } from "../src/modules/workspace-management/application/assistant-notification-outbox.service";
import { HandleInternalCronFireService } from "../src/modules/workspace-management/application/handle-internal-cron-fire.service";

type OutboxCreate = { data: Record<string, unknown> };

function createHandleInternalCronFireService(params: {
  prisma: unknown;
  bindingRepository: unknown;
  platformRuntimeProviderSecretStoreService: unknown;
  resolveAssistantInboundRuntimeContextService: unknown;
  enforceAssistantCapabilityAndQuotaService: unknown;
  renderAssistantInboundSurfaceMessageService: unknown;
  mediaDeliveryService?: unknown;
  assistantChatRepository: unknown;
  outboxCreates?: OutboxCreate[];
}): HandleInternalCronFireService {
  const prisma = params.prisma as Record<string, unknown>;
  const outboxCreates = params.outboxCreates ?? [];
  prisma.assistantNotificationOutbox ??= {
    findUnique: async ({ where }: { where: { dedupeKey: string } }) => {
      const index = outboxCreates.findIndex((item) => item.data.dedupeKey === where.dedupeKey);
      return index === -1
        ? null
        : { id: `outbox-${index + 1}`, status: outboxCreates[index].data.status };
    },
    create: async ({ data }: OutboxCreate) => {
      outboxCreates.push({ data });
      return { id: `outbox-${outboxCreates.length}`, status: data.status };
    }
  };
  const notificationOutboxService = new AssistantNotificationOutboxService(prisma as never);
  return new HandleInternalCronFireService(
    prisma as never,
    params.bindingRepository as never,
    notificationOutboxService as never
  );
}

async function runWebDeliveryArtifactTest(): Promise<void> {
  const outboxCreates: OutboxCreate[] = [];
  const bindingRepository = {
    claimReminderDeliveryProcessing: async () => "claimed",
    getCompletedReminderDeliveryProcessing: async () => null,
    completeReminderDeliveryProcessing: async () => undefined,
    releaseReminderDeliveryProcessing: async () => undefined
  };

  const prisma = {
    assistant: {
      findUnique: async () => ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1",
        preferredNotificationChannel: "web" as const,
        channelSurfaceBindings: []
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

  const platformRuntimeProviderSecretStoreService = {
    resolveSecretValueByProviderKey: async () => null
  };

  const assistantChatRepository = {
    findChatBySurfaceThread: async () => null,
    createChat: async () => ({
      id: "chat-1"
    }),
    findOrCreateChatBySurfaceThread: async () => ({ id: "chat-1" }),
    createMessage: async () => ({ id: "message-1" })
  };

  const service = createHandleInternalCronFireService({
    prisma,
    bindingRepository,
    platformRuntimeProviderSecretStoreService,
    resolveAssistantInboundRuntimeContextService: {
      async resolveByAssistantId() {
        return {
          assistant: {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "ws-1"
          }
        };
      }
    },
    enforceAssistantCapabilityAndQuotaService: {
      async enforceInboundTurn() {
        return;
      }
    },
    renderAssistantInboundSurfaceMessageService: {
      renderError() {
        return { code: "ok", text: "rendered" };
      }
    },
    assistantChatRepository,
    outboxCreates
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary:
      "Пора спать!\n\nRecent context:\n- Assistant: Напоминание создано\n- User: напомни через 2 минуты спать"
  });

  assert.equal(result.deliveredTo, "none");
  assert.equal(outboxCreates.length, 1);
  assert.equal(outboxCreates[0].data.source, "user_reminder");
  assert.equal(outboxCreates[0].data.status, "pending");
  assert.equal(
    outboxCreates[0].data.text,
    "Пора спать!\n\nRecent context:\n- Assistant: Напоминание создано\n- User: напомни через 2 минуты спать"
  );
}

async function runTelegramTaskTargetTest(): Promise<void> {
  const sentPayloads: Array<{ chat_id: string; text: string }> = [];
  const outboxCreates: OutboxCreate[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string; text: string };
    sentPayloads.push(body);
    return { ok: true } as Response;
  }) as typeof fetch;

  try {
    const prisma = {
      assistant: {
        findUnique: async () => ({
          id: "assistant-1",
          userId: "user-1",
          workspaceId: "ws-1",
          preferredNotificationChannel: "telegram" as const,
          channelSurfaceBindings: [
            {
              providerKey: "telegram" as const,
              metadata: {
                telegramDmChatId: "dm-1",
                telegramDmUsername: "kurock09",
                reminderDeliveryChatId: "group-latest",
                reminderDeliveryChatType: "group",
                reminderTaskTargets: {
                  "job-1": {
                    chatId: "group-locked",
                    chatType: "group",
                    title: "Alex, Jarvis и MASHA",
                    username: null,
                    source: "telegram_group",
                    updatedAt: "2026-03-28T00:00:00.000Z"
                  }
                }
              }
            }
          ]
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

    const platformRuntimeProviderSecretStoreService = {
      resolveSecretValueByProviderKey: async () => "bot-token"
    };

    const assistantChatRepository = {
      findChatBySurfaceThread: async () => null,
      createChat: async () => ({ id: "chat-1" }),
      findOrCreateChatBySurfaceThread: async () => ({ id: "chat-1" }),
      createMessage: async () => ({ id: "message-1" })
    };
    const bindingRepository = {
      claimReminderDeliveryProcessing: async () => "claimed",
      getCompletedReminderDeliveryProcessing: async () => null,
      completeReminderDeliveryProcessing: async () => undefined,
      releaseReminderDeliveryProcessing: async () => undefined
    };

    const service = createHandleInternalCronFireService({
      prisma,
      bindingRepository,
      platformRuntimeProviderSecretStoreService,
      resolveAssistantInboundRuntimeContextService: {
        async resolveByAssistantId() {
          return {
            assistant: {
              id: "assistant-1",
              userId: "user-1",
              workspaceId: "ws-1"
            }
          };
        }
      },
      enforceAssistantCapabilityAndQuotaService: {
        async enforceInboundTurn() {
          return;
        }
      },
      renderAssistantInboundSurfaceMessageService: {
        renderError() {
          return { code: "ok", text: "rendered" };
        }
      },
      assistantChatRepository,
      outboxCreates
    });

    const result = await service.execute({
      assistantId: "assistant-1",
      jobId: "job-1",
      action: "finished",
      status: "ok",
      summary: "Пора идти гулять с Симбой!"
    });

    assert.equal(result.deliveredTo, "none");
    assert.deepEqual(sentPayloads, []);
    assert.equal(outboxCreates.length, 1);
    assert.equal(outboxCreates[0].data.source, "user_reminder");
    assert.equal(outboxCreates[0].data.text, "Пора идти гулять с Симбой!");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runBackgroundNotificationUsesCommonDeliveryTest(): Promise<void> {
  const sentPayloads: Array<{ chat_id: string; text: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string; text: string };
    sentPayloads.push(body);
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } })
    } as Response;
  }) as typeof fetch;

  try {
    const notificationDeliveryService = new AssistantNotificationDeliveryService(
      {
        assistant: {
          findUnique: async () => ({
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "ws-1",
            preferredNotificationChannel: "telegram" as const,
            channelSurfaceBindings: [
              {
                providerKey: "telegram" as const,
                metadata: {
                  telegramDmChatId: "dm-1",
                  reminderTaskTargets: {
                    "background-task-1": {
                      chatId: "reminder-group",
                      chatType: "group",
                      title: "Reminder group",
                      username: null,
                      source: "telegram_group",
                      updatedAt: "2026-03-28T00:00:00.000Z"
                    }
                  }
                }
              }
            ]
          })
        }
      } as never,
      {
        resolveSecretValueByProviderKey: async () => "bot-token"
      } as never,
      {
        async resolveByAssistantId() {
          return {
            assistant: {
              id: "assistant-1",
              userId: "user-1",
              workspaceId: "ws-1"
            }
          };
        }
      } as never,
      {
        async enforceInboundTurn() {
          return;
        }
      } as never,
      {
        renderError() {
          return { code: "ok", text: "rendered" };
        }
      } as never,
      { deliver: async () => ({ attachments: [] }) } as never,
      {
        findOrCreateChatBySurfaceThread: async () => ({ id: "chat-1" }),
        createMessage: async () => ({ id: "message-1" })
      } as never
    );

    const result = await notificationDeliveryService.deliver({
      assistantId: "assistant-1",
      source: "background_task",
      sourceId: "background-task-1",
      status: "ok",
      text: "USD/RUB crossed the threshold."
    });

    assert.equal(result.target, "telegram");
    assert.equal(result.messageId, "42");
    assert.deepEqual(sentPayloads, [{ chat_id: "dm-1", text: "USD/RUB crossed the threshold." }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runQuotaRenderedFallbackTest(): Promise<void> {
  const outboxCreates: OutboxCreate[] = [];
  const bindingRepository = {
    claimReminderDeliveryProcessing: async () => "claimed",
    getCompletedReminderDeliveryProcessing: async () => null,
    completeReminderDeliveryProcessing: async () => undefined,
    releaseReminderDeliveryProcessing: async () => undefined
  };
  const prisma = {
    assistant: {
      findUnique: async () => ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1",
        preferredNotificationChannel: "web" as const,
        channelSurfaceBindings: []
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

  const service = createHandleInternalCronFireService({
    prisma,
    bindingRepository,
    platformRuntimeProviderSecretStoreService: {
      resolveSecretValueByProviderKey: async () => null
    },
    resolveAssistantInboundRuntimeContextService: {},
    enforceAssistantCapabilityAndQuotaService: {
      async enforceInboundTurn() {
        return;
      }
    },
    renderAssistantInboundSurfaceMessageService: {
      renderError() {
        return {
          code: "quota_limit_reached",
          text: "Reminder could not be delivered because the current plan limit was reached."
        };
      }
    },
    assistantChatRepository: {
      findChatBySurfaceThread: async () => null,
      createChat: async () => ({ id: "chat-1" }),
      findOrCreateChatBySurfaceThread: async () => ({ id: "chat-1" }),
      createMessage: async () => ({ id: "message-1" })
    },
    outboxCreates
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary: "Пора спать!"
  });

  assert.equal(result.deliveredTo, "none");
  assert.equal(outboxCreates.length, 1);
  assert.equal(outboxCreates[0].data.text, "Пора спать!");
}

async function runReminderReplayDedupTest(): Promise<void> {
  const deliveredMessages: string[] = [];
  const outboxCreates: OutboxCreate[] = [];
  const replayStates = new Map<
    string,
    {
      active?: string;
      completed?: { replayKey: string; deliveredTo: "telegram" | "web" | "fallback_web" | "none" };
    }
  >();
  const key = "assistant-1:system_notifications:system_notification";
  const prisma = {
    assistant: {
      findUnique: async () => ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1",
        preferredNotificationChannel: "web" as const,
        channelSurfaceBindings: []
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
      return "claimed";
    },
    getCompletedReminderDeliveryProcessing: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      replayKey: string
    ) => {
      const state = replayStates.get(key);
      return state?.completed?.replayKey === replayKey
        ? {
            replayKey,
            deliveredTo: state.completed.deliveredTo,
            completedAt: "2026-04-06T00:00:00.000Z"
          }
        : null;
    },
    completeReminderDeliveryProcessing: async (
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      state: { replayKey: string; deliveredTo: "telegram" | "web" | "fallback_web" | "none" }
    ) => {
      replayStates.set(key, { completed: state });
    },
    releaseReminderDeliveryProcessing: async () => undefined
  };

  const service = createHandleInternalCronFireService({
    prisma,
    bindingRepository,
    platformRuntimeProviderSecretStoreService: {
      resolveSecretValueByProviderKey: async () => null
    },
    resolveAssistantInboundRuntimeContextService: {
      async resolveByAssistantId() {
        return {
          assistant: {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "ws-1"
          }
        };
      }
    },
    enforceAssistantCapabilityAndQuotaService: {
      async enforceInboundTurn() {
        return;
      }
    },
    renderAssistantInboundSurfaceMessageService: {
      renderError() {
        return { code: "ok", text: "rendered" };
      }
    },
    assistantChatRepository: {
      findChatBySurfaceThread: async () => null,
      createChat: async () => ({ id: "chat-1" }),
      findOrCreateChatBySurfaceThread: async () => ({ id: "chat-1" }),
      createMessage: async (input: { content: string }) => {
        deliveredMessages.push(input.content);
        return { id: "message-1" };
      }
    },
    outboxCreates
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
  assert.deepEqual(deliveredMessages, []);
  assert.equal(outboxCreates.length, 1);
}

async function run(): Promise<void> {
  await runWebDeliveryArtifactTest();
  await runTelegramTaskTargetTest();
  await runBackgroundNotificationUsesCommonDeliveryTest();
  await runQuotaRenderedFallbackTest();
  await runReminderReplayDedupTest();
  console.log("handle-internal-cron-fire tests passed");
}

void run();
