import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryTurnStreamEventStore } from "../src/modules/workspace-management/application/memory-turn-stream-event-store";
import { WebChatContinuationDiscoveryService } from "../src/modules/workspace-management/application/web-chat-continuation-discovery.service";

const owner = {
  assistantId: "assistant-1",
  userId: "user-1",
  chatId: "chat-1",
  threadKey: "web-thread-1"
};

describe("web chat continuation discovery", () => {
  test("replica B publication reaches replica A and replay is cursor-deduped", async () => {
    const sharedStore = new MemoryTurnStreamEventStore();
    const replicaA = new WebChatContinuationDiscoveryService(sharedStore);
    const replicaB = new WebChatContinuationDiscoveryService(sharedStore);
    const received: Array<{ seq: number; clientTurnId: string }> = [];
    const detach = await replicaA.attach({
      ...owner,
      onDiscovery: (event) => received.push(event)
    });

    await replicaB.publishReady({ ...owner, clientTurnId: "async-cont:handle-1" });
    await replicaB.publishReady({ ...owner, clientTurnId: "async-cont:handle-1" });
    assert.deepEqual(received, [{ seq: 1, clientTurnId: "async-cont:handle-1" }]);
    detach();

    const replayed: Array<{ seq: number; clientTurnId: string }> = [];
    const detachReplay = await replicaA.attach({
      ...owner,
      fromSeq: 0,
      onDiscovery: (event) => replayed.push(event)
    });
    assert.deepEqual(replayed, [{ seq: 1, clientTurnId: "async-cont:handle-1" }]);
    detachReplay();

    const afterCursor: string[] = [];
    const detachAfterCursor = await replicaA.attach({
      ...owner,
      fromSeq: 1,
      onDiscovery: (event) => afterCursor.push(event.clientTurnId)
    });
    assert.deepEqual(afterCursor, []);
    detachAfterCursor();
  });

  test("discovery is isolated by user, chat, and thread identity", async () => {
    const sharedStore = new MemoryTurnStreamEventStore();
    const publisher = new WebChatContinuationDiscoveryService(sharedStore);
    const subscriber = new WebChatContinuationDiscoveryService(sharedStore);
    const unrelated: string[] = [];
    const detaches = await Promise.all([
      subscriber.attach({
        ...owner,
        userId: "user-2",
        onDiscovery: (event) => unrelated.push(`user:${event.clientTurnId}`)
      }),
      subscriber.attach({
        ...owner,
        chatId: "chat-2",
        onDiscovery: (event) => unrelated.push(`chat:${event.clientTurnId}`)
      }),
      subscriber.attach({
        ...owner,
        threadKey: "web-thread-2",
        onDiscovery: (event) => unrelated.push(`thread:${event.clientTurnId}`)
      })
    ]);

    await publisher.publishReady({ ...owner, clientTurnId: "async-cont:isolated" });
    assert.deepEqual(unrelated, []);
    for (const detach of detaches) detach();
  });
});
