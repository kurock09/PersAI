import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryTurnStreamEventStore } from "../src/modules/workspace-management/application/memory-turn-stream-event-store";
import { WebChatTurnStreamBusService } from "../src/modules/workspace-management/application/web-chat-turn-stream-bus.service";
import { WebChatTurnStreamRegistry } from "../src/modules/workspace-management/application/web-chat-turn-stream-registry.service";
import { buildTurnStreamKey } from "../src/modules/workspace-management/application/turn-stream-event-store";

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

  test("reattach degrades non-live on store failure then recovers replay and live subscription", async () => {
    const { store, podA, podB } = createBusPair();
    const identity = { assistantId: "assistant-1", clientTurnId: "turn-outage", userId: "user-1" };
    await podA.registerTurn(identity);
    await podA.publishAsync({ ...identity, event: "delta", payload: { delta: "before" } });

    const originalGetMeta = store.getMeta.bind(store);
    store.getMeta = async () => {
      throw new Error("redis unavailable");
    };
    const unavailable = await podB.attach({ ...identity, onEvent: () => undefined });
    assert.equal(unavailable, null);

    store.getMeta = originalGetMeta;
    const events: string[] = [];
    const detach = await podB.attach({
      ...identity,
      onEvent: (event, payload) => events.push(`${event}:${(payload as { delta: string }).delta}`)
    });
    assert.notEqual(detach, null);
    await podA.publishAsync({ ...identity, event: "delta", payload: { delta: "after" } });
    assert.deepEqual(events, ["delta:before", "delta:after"]);
    detach?.();
  });

  test("same-owner registration preserves replay, sequence, and local sinks", async () => {
    const { store, podA } = createBusPair();
    const identity = {
      assistantId: "assistant-1",
      clientTurnId: "turn-reregister",
      userId: "user-1"
    };
    await podA.registerTurn(identity);
    const received: string[] = [];
    const detach = await podA.attach({
      ...identity,
      onEvent: (_event, payload) => received.push((payload as { value: string }).value)
    });
    await podA.publishAsync({ ...identity, event: "delta", payload: { value: "one" } });
    await podA.registerTurn(identity);
    await podA.publishAsync({ ...identity, event: "delta", payload: { value: "two" } });

    const key = buildTurnStreamKey(identity.assistantId, identity.userId, identity.clientTurnId);
    const replay = await store.listFrom(key);
    assert.deepEqual(
      replay.map((item) => item.seq),
      [1, 2]
    );
    assert.deepEqual(
      replay.map((item) => (item.payload as { value: string }).value),
      ["one", "two"]
    );
    assert.deepEqual(received, ["one", "two"]);
    detach?.();
  });

  test("same clientTurnId is tenant-isolated by userId in stream key", async () => {
    const { store, podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "shared-turn",
      userId: "user-1"
    });
    await podB.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "shared-turn",
      userId: "user-2"
    });

    await podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "shared-turn",
      userId: "user-1",
      event: "delta",
      payload: { owner: "user-1" }
    });
    await podB.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "shared-turn",
      userId: "user-2",
      event: "delta",
      payload: { owner: "user-2" }
    });

    const key1 = buildTurnStreamKey("assistant-1", "user-1", "shared-turn");
    const key2 = buildTurnStreamKey("assistant-1", "user-2", "shared-turn");
    assert.notEqual(key1, key2);
    const events1 = await store.listFrom(key1);
    const events2 = await store.listFrom(key2);
    assert.equal(events1.length, 1);
    assert.equal(events2.length, 1);
    assert.deepEqual(events1[0]?.payload, { owner: "user-1" });
    assert.deepEqual(events2[0]?.payload, { owner: "user-2" });

    const cross = await podA.attach({
      assistantId: "assistant-1",
      clientTurnId: "shared-turn",
      userId: "user-2",
      onEvent: () => undefined
    });
    // podA has local for user-1 only; user-2 attach on podA uses store key for user-2
    assert.notEqual(cross, null);
    cross?.();
  });

  test("registerTurn fail-closed when store meta has different userId", async () => {
    const store = new MemoryTurnStreamEventStore();
    const turnKey = buildTurnStreamKey("assistant-1", "user-1", "turn-fence");
    await store.registerTurn({ turnKey, userId: "user-1" });
    await store.append({
      turnKey,
      userId: "user-1",
      event: "delta",
      payload: { keep: true }
    });

    // Corrupt meta userId under the same key (defense-in-depth path).
    const originalGetMeta = store.getMeta.bind(store);
    store.getMeta = async (key: string) => {
      const meta = await originalGetMeta(key);
      if (meta !== null && key === turnKey) {
        return { ...meta, userId: "attacker" };
      }
      return meta;
    };

    const bus = new WebChatTurnStreamBusService(store);
    await assert.rejects(
      bus.registerTurn({
        assistantId: "assistant-1",
        clientTurnId: "turn-fence",
        userId: "user-1"
      }),
      { name: "TurnStreamRegistrationError" }
    );

    assert.equal(bus.hasLocalRegistrationForTesting("assistant-1", "user-1", "turn-fence"), false);
    store.getMeta = originalGetMeta;
    const meta = await store.getMeta(turnKey);
    assert.equal(meta?.userId, "user-1");
    const events = await store.listFrom(turnKey);
    assert.equal(events.length, 1);
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
    assert.equal(await podB.hasActiveStream("assistant-1", "user-1", "turn-active"), true);
    assert.equal(
      podB.hasLocalRegistrationForTesting("assistant-1", "user-1", "turn-active"),
      false
    );
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

    const turnKey = buildTurnStreamKey("assistant-1", "user-1", "turn-concurrent");
    const envelopes = await store.listFrom(turnKey);
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

  test("release mid-publish drains queue; remote attach sees terminal + contiguous seq", async () => {
    const { store, podA, podB } = createBusPair();
    await podA.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-release",
      userId: "user-1"
    });

    const count = 40;
    const publishes = Array.from({ length: count }, (_, i) =>
      podA.publishAsync({
        assistantId: "assistant-1",
        clientTurnId: "turn-release",
        userId: "user-1",
        event: "delta",
        payload: { i }
      })
    );
    const terminal = podA.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-release",
      userId: "user-1",
      event: "completed",
      payload: { transport: null }
    });
    const release = podA.releaseAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-release",
      userId: "user-1"
    });

    await Promise.all([...publishes, terminal, release]);

    const turnKey = buildTurnStreamKey("assistant-1", "user-1", "turn-release");
    const envelopes = await store.listFrom(turnKey);
    assert.equal(envelopes.length, count + 1);
    assert.deepEqual(
      envelopes.map((envelope) => envelope.seq),
      Array.from({ length: count + 1 }, (_, i) => i + 1)
    );
    assert.equal(envelopes[envelopes.length - 1]?.event, "completed");

    const received: Array<{ event: string; seq?: number }> = [];
    let seqCounter = 0;
    const detach = await podB.attach({
      assistantId: "assistant-1",
      clientTurnId: "turn-release",
      userId: "user-1",
      onEvent: (event) => {
        seqCounter += 1;
        received.push({ event, seq: seqCounter });
      }
    });
    assert.notEqual(detach, null);
    assert.equal(received.length, count + 1);
    assert.equal(received[received.length - 1]?.event, "completed");
    assert.deepEqual(
      received.map((item) => item.seq),
      Array.from({ length: count + 1 }, (_, i) => i + 1)
    );
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

  test("memory store registerTurn fail-closed for different userId", async () => {
    const store = new MemoryTurnStreamEventStore();
    await store.registerTurn({ turnKey: "k", userId: "user-1" });
    await store.append({
      turnKey: "k",
      userId: "user-1",
      event: "delta",
      payload: { keep: true }
    });
    await store.registerTurn({ turnKey: "k", userId: "user-2" });
    const meta = await store.getMeta("k");
    assert.equal(meta?.userId, "user-1");
    const events = await store.listFrom("k");
    assert.equal(events.length, 1);
  });

  test("touch is invoked and release keeps shortGrace buffer readable", async () => {
    const store = new MemoryTurnStreamEventStore();
    let touchCount = 0;
    const originalTouch = store.touch.bind(store);
    store.touch = async (turnKey: string) => {
      touchCount += 1;
      await originalTouch(turnKey);
    };

    const bus = new WebChatTurnStreamBusService(store);
    await bus.registerTurn({
      assistantId: "assistant-1",
      clientTurnId: "turn-touch",
      userId: "user-1"
    });
    await bus.touch({
      assistantId: "assistant-1",
      clientTurnId: "turn-touch",
      userId: "user-1"
    });
    assert.equal(touchCount, 1);

    await bus.publishAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-touch",
      userId: "user-1",
      event: "completed",
      payload: { transport: null }
    });
    await bus.releaseAsync({
      assistantId: "assistant-1",
      clientTurnId: "turn-touch",
      userId: "user-1"
    });

    const turnKey = buildTurnStreamKey("assistant-1", "user-1", "turn-touch");
    assert.equal(await store.exists(turnKey), true);
    const envelopes = await store.listFrom(turnKey);
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0]?.event, "completed");
  });
});
