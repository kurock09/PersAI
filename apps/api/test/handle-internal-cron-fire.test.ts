import assert from "node:assert/strict";
import { DeliverReminderNotificationService } from "../src/modules/workspace-management/application/deliver-reminder-notification.service";
import { HandleInternalCronFireService } from "../src/modules/workspace-management/application/handle-internal-cron-fire.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";

function createHandleInternalCronFireService(params: {
  prisma: unknown;
  bindingRepository: unknown;
  platformRuntimeProviderSecretStoreService: unknown;
  resolveAssistantInboundRuntimeContextService: unknown;
  enforceAssistantCapabilityAndQuotaService: unknown;
  renderAssistantInboundSurfaceMessageService: unknown;
  assistantChatRepository: unknown;
}): HandleInternalCronFireService {
  const deliveryService = new DeliverReminderNotificationService(
    params.prisma as never,
    params.platformRuntimeProviderSecretStoreService as never,
    params.resolveAssistantInboundRuntimeContextService as never,
    params.enforceAssistantCapabilityAndQuotaService as never,
    params.renderAssistantInboundSurfaceMessageService as never,
    params.assistantChatRepository as never
  );
  return new HandleInternalCronFireService(
    params.prisma as never,
    params.bindingRepository as never,
    deliveryService as never
  );
}

async function runWebDeliveryArtifactTest(): Promise<void> {
  const deliveredMessages: string[] = [];
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
    findOrCreateChatBySurfaceThread: async () => ({
      id: "chat-1"
    }),
    createMessage: async (input: { content: string }) => {
      deliveredMessages.push(input.content);
      return { id: "message-1" };
    }
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
    assistantChatRepository
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary:
      "Пора спать!\n\nRecent context:\n- Assistant: Напоминание создано\n- User: напомни через 2 минуты спать"
  });

  assert.equal(result.deliveredTo, "web");
  assert.deepEqual(deliveredMessages, ["Пора спать!"]);
}

async function runTelegramTaskTargetTest(): Promise<void> {
  const sentPayloads: Array<{ chat_id: string; text: string }> = [];
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
      assistantChatRepository
    });

    const result = await service.execute({
      assistantId: "assistant-1",
      jobId: "job-1",
      action: "finished",
      status: "ok",
      summary: "Пора идти гулять с Симбой!"
    });

    assert.equal(result.deliveredTo, "telegram");
    assert.deepEqual(sentPayloads, [
      { chat_id: "group-locked", text: "Пора идти гулять с Симбой!" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runQuotaRenderedFallbackTest(): Promise<void> {
  const deliveredMessages: string[] = [];
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
    resolveAssistantInboundRuntimeContextService: {
      async resolveByAssistantId() {
        throw new ApiErrorHttpException(409, {
          code: "quota_limit_reached",
          category: "conflict",
          message: "Quota reached."
        });
      }
    },
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
      createMessage: async (input: { content: string }) => {
        deliveredMessages.push(input.content);
        return { id: "message-1" };
      }
    }
  });

  const result = await service.execute({
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary: "Пора спать!"
  });

  assert.equal(result.deliveredTo, "web");
  assert.deepEqual(deliveredMessages, [
    "Reminder could not be delivered because the current plan limit was reached."
  ]);
}

async function runReminderReplayDedupTest(): Promise<void> {
  const deliveredMessages: string[] = [];
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
    }
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

  assert.equal(first.deliveredTo, "web");
  assert.equal(second.deliveredTo, "web");
  assert.deepEqual(deliveredMessages, ["Пора спать!"]);
}

async function run(): Promise<void> {
  await runWebDeliveryArtifactTest();
  await runTelegramTaskTargetTest();
  await runQuotaRenderedFallbackTest();
  await runReminderReplayDedupTest();
  console.log("handle-internal-cron-fire tests passed");
}

void run();
