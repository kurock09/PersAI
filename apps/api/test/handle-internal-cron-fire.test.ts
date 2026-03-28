import assert from "node:assert/strict";
import { HandleInternalCronFireService } from "../src/modules/workspace-management/application/handle-internal-cron-fire.service";

async function run(): Promise<void> {
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

  console.log("handle-internal-cron-fire tests passed");
}

void run();
