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

async function runHardDeleteRemovesWebRuntimeState(): Promise<void> {
  const calls: string[] = [];
  const tx = {
    sandboxWorkspaceGcLease: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push(`gc-lease:${JSON.stringify(args.data)}`);
        return {};
      }
    },
    runtimeSession: {
      findMany: async () => [{ id: "runtime-session-1" }],
      deleteMany: async (args: Record<string, unknown>) => {
        calls.push(`runtime-session:${JSON.stringify(args)}`);
        return { count: 1 };
      }
    },
    runtimeTurnReceipt: {
      deleteMany: async (args: Record<string, unknown>) => {
        calls.push(`runtime-receipt:${JSON.stringify(args)}`);
        return { count: 2 };
      }
    },
    runtimeSessionCompaction: {
      deleteMany: async (args: Record<string, unknown>) => {
        calls.push(`runtime-compaction:${JSON.stringify(args)}`);
        return { count: 1 };
      }
    },
    assistantChatMessage: {
      deleteMany: async (args: Record<string, unknown>) => {
        calls.push(`chat-message:${JSON.stringify(args)}`);
        return { count: 2 };
      }
    },
    assistantChat: {
      delete: async (args: Record<string, unknown>) => {
        calls.push(`chat:${JSON.stringify(args)}`);
        return {};
      }
    }
  };
  const repository = new PrismaAssistantChatRepository({
    assistantChat: {
      findUnique: async () => ({
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1"
      })
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  } as never);

  assert.equal(await repository.hardDeleteChat("chat-1", "assistant-1"), true);
  assert.equal(
    calls[0]?.startsWith("gc-lease:"),
    true,
    "first call must be the session_subtree GC lease"
  );
  const leasePayload = JSON.parse((calls[0] ?? "").slice("gc-lease:".length)) as {
    kind: string;
    targetId: string;
    metadata: { workspaceId: string; assistantId: string };
  };
  assert.equal(leasePayload.kind, "session_subtree");
  assert.equal(leasePayload.targetId, "chat-1");
  assert.equal(leasePayload.metadata.assistantId, "assistant-1");
  assert.deepEqual(calls.slice(1), [
    'runtime-receipt:{"where":{"assistantId":"assistant-1","channel":"web","externalThreadKey":"thread-1"}}',
    'runtime-compaction:{"where":{"runtimeSessionId":{"in":["runtime-session-1"]},"assistantId":"assistant-1"}}',
    'runtime-session:{"where":{"id":{"in":["runtime-session-1"]},"assistantId":"assistant-1","channel":"web","externalThreadKey":"thread-1"}}',
    'chat-message:{"where":{"chatId":"chat-1","assistantId":"assistant-1"}}',
    'chat:{"where":{"id_assistantId":{"id":"chat-1","assistantId":"assistant-1"}}}'
  ]);
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

void runRetriesSerializableWebChatCap().then(runHardDeleteRemovesWebRuntimeState);
