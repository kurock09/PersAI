import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaAssistantChatRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository";

async function runRetriesSerializableWebChatCap(): Promise<void> {
  let transactionCalls = 0;

  const repository = new PrismaAssistantChatRepository({
    $transaction: async (
      callback: (tx: {
        assistantChat: {
          findUnique: typeof assistantChatTx.findUnique;
          count: typeof assistantChatTx.count;
          create: typeof assistantChatTx.create;
        };
      }) => Promise<unknown>
    ) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        throw new Prisma.PrismaClientKnownRequestError("serialization conflict", {
          code: "P2034",
          clientVersion: "test"
        });
      }
      return callback({ assistantChat: assistantChatTx });
    }
  } as never);

  const created = await repository.getOrCreateWebChatBySurfaceThreadUnderCap({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web",
    surfaceThreadKey: "thread-1",
    title: "Hello",
    activeWebChatsLimit: 20
  });

  assert.equal(transactionCalls, 2);
  assert.equal(created.outcome, "created");
  if (created.outcome === "created") {
    assert.equal(created.chat.id, "chat-1");
  }

  const capRepository = new PrismaAssistantChatRepository({
    $transaction: async (
      callback: (tx: {
        assistantChat: {
          findUnique: typeof assistantChatCapTx.findUnique;
          count: typeof assistantChatCapTx.count;
          create: typeof assistantChatCapTx.create;
        };
      }) => Promise<unknown>
    ) => callback({ assistantChat: assistantChatCapTx })
  } as never);

  const capped = await capRepository.getOrCreateWebChatBySurfaceThreadUnderCap({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web",
    surfaceThreadKey: "thread-2",
    title: "Blocked",
    activeWebChatsLimit: 20
  });

  assert.deepEqual(capped, {
    outcome: "cap_reached",
    activeCount: 20,
    limit: 20
  });
}

const assistantChatTx = {
  findUnique: async () => null,
  count: async () => 19,
  create: async () => ({
    id: "chat-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web",
    surfaceThreadKey: "thread-1",
    title: "Hello",
    archivedAt: null,
    lastMessageAt: null,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  })
};

const assistantChatCapTx = {
  findUnique: async () => null,
  count: async () => 20,
  create: async () => {
    throw new Error("create must not run after cap is reached");
  }
};

void runRetriesSerializableWebChatCap();
