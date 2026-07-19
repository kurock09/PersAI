import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryTurnStreamEventStore } from "../src/modules/workspace-management/application/memory-turn-stream-event-store";
import { WebChatTurnStreamBusService } from "../src/modules/workspace-management/application/web-chat-turn-stream-bus.service";
import { WebChatTurnStreamRegistry } from "../src/modules/workspace-management/application/web-chat-turn-stream-registry.service";

function createBusPair(): {
  store: MemoryTurnStreamEventStore;
  podA: WebChatTurnStreamBusService;
  podB: WebChatTurnStreamBusService;
} {
  const store = new MemoryTurnStreamEventStore();
  return {
    store,
    podA: new WebChatTurnStreamBusService(store),
    podB: new WebChatTurnStreamBusService(store)
  };
}

describe("ADR-158 durable web turn stream bus", () => {
  test("pod B attach replays pod A publishes then receives live appends", async () => {
    const { podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1"
    });

    await podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "started",
      payload: { requestId: "req-1" }
    });
    await podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "delta",
      payload: { delta: "hello" }
    });

    const received: Array<{ event: string; payload: unknown }> = [];
    const detach = await podB.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      onEvent: (event, payload) => {
        received.push({ event, payload });
      }
    });
    assert.notEqual(detach, null);

    assert.deepEqual(received, [
      { event: "started", payload: { requestId: "req-1" } },
      { event: "delta", payload: { delta: "hello" } }
    ]);

    await podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "delta",
      payload: { delta: " world" }
    });
    await podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "completed",
      payload: { transport: null }
    });

    assert.deepEqual(received.slice(2), [
      { event: "delta", payload: { delta: " world" } },
      { event: "completed", payload: { transport: null } }
    ]);

    detach?.();
    await podA.releaseAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1"
    });
  });

  test("attach returns null for unknown turn or wrong user", async () => {
    const { podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1"
    });

    const missing = await podB.attach({
      assistantId: "assistant-1",
      clientTurnId: "missing",
      userId: "user-1",
      onEvent: () => undefined
    });
    assert.equal(missing, null);

    const wrongUser = await podB.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-2",
      onEvent: () => undefined
    });
    assert.equal(wrongUser, null);
  });

  test("same-pod attach uses local sinks after replay", async () => {
    const store = new MemoryTurnStreamEventStore();
    const bus = new WebChatTurnStreamBusService(store);
    await bus.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1"
    });
    await bus.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "delta",
      payload: { delta: "a" }
    });

    const received: string[] = [];
    const detach = await bus.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      onEvent: (event) => {
        received.push(event);
      }
    });
    assert.notEqual(detach, null);
    assert.deepEqual(received, ["delta"]);

    await bus.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      event: "thinking",
      payload: { delta: "…" }
    });
    assert.deepEqual(received, ["delta", "thinking"]);
    detach?.();
  });

  test("registry facade delegates publish/attach across shared store", async () => {
    const store = new MemoryTurnStreamEventStore();
    const busA = new WebChatTurnStreamBusService(store);
    const registryA = new WebChatTurnStreamRegistry(busA);
    const registryB = new WebChatTurnStreamRegistry(new WebChatTurnStreamBusService(store));

    await registryA.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-reg",
      userId: "user-1"
    });
    await busA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-reg",
      userId: "user-1",
      event: "tool",
      payload: { phase: "started", toolName: "shell" }
    });

    const received: Array<{ event: string; payload: unknown }> = [];
    const detach = await registryB.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-reg",
      userId: "user-1",
      onEvent: (event, payload) => {
        received.push({ event, payload });
      }
    });
    assert.notEqual(detach, null);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.event, "tool");
    detach?.();
  });

  test("hasActiveStream is true on remote pod while buffer exists", async () => {
    const { podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-active",
      userId: "user-1"
    });
    assert.equal(await podB.hasActiveStream("assistant-1", "turn-active"), true);
    assert.equal(podB.hasLocalRegistrationForTesting("assistant-1", "turn-active"), false);
  });

  test("concurrent publishes keep contiguous unique seq and drop no payloads", async () => {
    const { store, podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-concurrent",
      userId: "user-1"
    });

    const count = 80;
    const expectedIds = Array.from({ length: count }, (_, i) => `p-${i}`);
    await Promise.all(
      expectedIds.map((id) =>
        podA.publishAsync({
          assistantId: "assistant-1",
          clientTurnId: "turn-concurrent",
          userId: "user-1",
          event: "delta",
          payload: { id }
        })
      )
    );

    const envelopes = await store.listFrom("assistant-1:turn-concurrent");
    assert.equal(envelopes.length, count);
    const seqs = envelopes.map((envelope) => envelope.seq);
    assert.deepEqual(
      seqs,
      Array.from({ length: count }, (_, i) => i + 1),
      "seq must be contiguous and unique starting at 1"
    );
    const storedIds = new Set(
      envelopes.map((envelope) => {
        const payload = envelope.payload as { id?: string };
        return payload.id;
      })
    );
    for (const id of expectedIds) {
      assert.equal(storedIds.has(id), true, `missing payload id=${id}`);
    }

    const received: string[] = [];
    const detach = await podB.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-concurrent",
      userId: "user-1",
      onEvent: (_event, payload) => {
        const id = (payload as { id?: string }).id;
        if (typeof id === "string") {
          received.push(id);
        }
      }
    });
    assert.notEqual(detach, null);
    assert.equal(received.length, count);
    assert.deepEqual(new Set(received).size, count);
    for (const id of expectedIds) {
      assert.equal(received.includes(id), true, `attach missing id=${id}`);
    }
    detach?.();
  });

  test("memory store concurrent append allocates unique contiguous seq", async () => {
    const store = new MemoryTurnStreamEventStore();
    await store.registerTurn({ turnKey: "t1", userId: "user-1" });
    const count = 60;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        store.append({
          turnKey: "t1",
          userId: "user-1",
          event: "delta",
          payload: { i }
        })
      )
    );
    const envelopes = await store.listFrom("t1");
    assert.equal(envelopes.length, count);
    assert.deepEqual(
      envelopes.map((envelope) => envelope.seq),
      Array.from({ length: count }, (_, i) => i + 1)
    );
    const indexes = new Set(envelopes.map((envelope) => (envelope.payload as { i: number }).i));
    assert.equal(indexes.size, count);
  });
});
