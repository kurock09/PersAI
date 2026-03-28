import assert from "node:assert/strict";
import { HandleInternalCronFireService } from "../src/modules/workspace-management/application/handle-internal-cron-fire.service";

async function runWebDeliveryArtifactTest(): Promise<void> {
  const deliveredMessages: string[] = [];

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
    createMessage: async (input: { content: string }) => {
      deliveredMessages.push(input.content);
      return { id: "message-1" };
    }
  };

  const service = new HandleInternalCronFireService(
    prisma as never,
    platformRuntimeProviderSecretStoreService as never,
    assistantChatRepository as never
  );

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
      createMessage: async () => ({ id: "message-1" })
    };

    const service = new HandleInternalCronFireService(
      prisma as never,
      platformRuntimeProviderSecretStoreService as never,
      assistantChatRepository as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      jobId: "job-1",
      action: "finished",
      status: "ok",
      summary: "Пора идти гулять с Симбой!"
    });

    assert.equal(result.deliveredTo, "telegram");
    assert.deepEqual(sentPayloads, [{ chat_id: "group-locked", text: "Пора идти гулять с Симбой!" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run(): Promise<void> {
  await runWebDeliveryArtifactTest();
  await runTelegramTaskTargetTest();
  console.log("handle-internal-cron-fire tests passed");
}

void run();
