import assert from "node:assert/strict";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";

function createRuntimeTurnRequest(): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "message-current",
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "current enriched user message",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-11T12:00:00.000Z"
    }
  };
}

class FakeRuntimeStatePrismaService {
  chat: { id: string } | null = {
    id: "chat-1"
  };
  messages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
  }> = [];

  assistantChat = {
    findFirst: async () => this.chat
  };

  assistantChatMessage = {
    findMany: async () => this.messages
  };
}

export async function runTurnContextHydrationServiceTest(): Promise<void> {
  const prisma = new FakeRuntimeStatePrismaService();
  const service = new TurnContextHydrationService(prisma as unknown as RuntimeStatePrismaService);
  const request = createRuntimeTurnRequest();

  prisma.messages = [
    {
      id: "message-1",
      author: "user",
      content: "first user"
    },
    {
      id: "message-2",
      author: "assistant",
      content: "first assistant"
    },
    {
      id: "message-3",
      author: "system",
      content: "ignore this system marker"
    },
    {
      id: "message-current",
      author: "user",
      content: "raw persisted user message"
    }
  ];

  const hydrated = await service.buildMessages(request);
  assert.deepEqual(hydrated, [
    {
      role: "user",
      content: "first user"
    },
    {
      role: "assistant",
      content: "first assistant"
    },
    {
      role: "user",
      content: "current enriched user message"
    }
  ]);

  prisma.chat = null;
  const fallback = await service.buildMessages(request);
  assert.deepEqual(fallback, [
    {
      role: "user",
      content: "current enriched user message"
    }
  ]);

  prisma.chat = { id: "chat-1" };
  prisma.messages = Array.from({ length: 22 }, (_, index) => ({
    id: `message-${index + 1}`,
    author: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message-${index + 1}`
  }));

  const capped = await service.buildMessages(request);
  assert.equal(capped.length, 20);
  assert.deepEqual(capped.at(0), {
    role: "assistant",
    content: "message-4"
  });
  assert.deepEqual(capped.at(-1), {
    role: "user",
    content: "current enriched user message"
  });
}
