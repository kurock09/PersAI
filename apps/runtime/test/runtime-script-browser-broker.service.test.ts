import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { RuntimeScriptBrowserBrokerService } from "../src/modules/turns/runtime-script-browser-broker.service";

const brokerId = "b".repeat(32);
const authToken = "t".repeat(43);
const sandboxJobId = "11111111-1111-4111-8111-111111111111";

type FakeRedisClient = EventEmitter & { quit: () => Promise<void>; quitCalls: number };

function fakeRedisClient(): FakeRedisClient {
  const emitter = new EventEmitter() as FakeRedisClient;
  emitter.quitCalls = 0;
  emitter.quit = async () => {
    emitter.quitCalls += 1;
  };
  return emitter;
}

function registerInput(): Record<string, unknown> {
  return {
    bundle: {},
    sessionId: "session",
    chatId: "chat",
    transportSurface: "web",
    bridgeDeviceId: "device",
    bridgeDeviceKind: "desktop_extension",
    sourceUserMessageText: null,
    sourceUserMessageCreatedAt: null,
    allowedProfile: "Work",
    ttlMs: 30_000
  };
}

export async function runRuntimeScriptBrowserBrokerServiceTest(): Promise<void> {
  await test("broker calls the existing browser dispatcher and enforces one in-flight request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatched: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];
    const browserService = {
      async executeToolCall(input: Record<string, unknown>) {
        dispatched.push(input);
        await gate;
        return {
          payload: { action: "snapshot", status: "completed", text: "safe page text" },
          artifacts: []
        };
      }
    };
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      browserService as never
    );
    const internal = service as unknown as {
      current: { publisher: { publish(channel: string, message: string): Promise<number> } } | null;
      brokers: Map<string, Record<string, unknown>>;
      handleMessage(message: string): Promise<void>;
    };
    internal.current = {
      publisher: {
        async publish(_channel, message) {
          published.push(JSON.parse(message) as Record<string, unknown>);
          return 1;
        }
      }
    };
    internal.brokers.set(brokerId, {
      binding: {
        brokerId,
        authToken,
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      sandboxJobId: null,
      inFlight: false,
      bundle: {},
      sessionId: "session",
      chatId: "chat",
      transportSurface: "web",
      bridgeDeviceId: "device",
      bridgeDeviceKind: "desktop_extension",
      sourceUserMessageText: "use profile Work",
      sourceUserMessageCreatedAt: "2026-07-18T00:00:00.000Z",
      allowedProfile: "Work",
      ttlMs: 30_000
    });
    const envelope = (requestId: string) =>
      JSON.stringify({
        version: 1,
        brokerId,
        authToken,
        sandboxJobId,
        request: {
          version: 1,
          requestId,
          action: "snapshot",
          profile: "Work",
          arguments: { url: "https://example.com" }
        }
      });

    const first = internal.handleMessage(envelope("request_11111111"));
    await new Promise((resolve) => setImmediate(resolve));
    await internal.handleMessage(envelope("request_22222222"));
    assert.equal(dispatched.length, 1);
    assert.equal(
      (published[0]?.error as { code?: string } | undefined)?.code,
      "script_browser_request_in_flight"
    );
    release();
    await first;
    assert.equal(dispatched.length, 1);
    const toolCall = dispatched[0]?.toolCall as { arguments?: Record<string, unknown> };
    assert.deepEqual(toolCall.arguments, {
      url: "https://example.com",
      action: "snapshot",
      profile: "Work"
    });
    assert.equal(JSON.stringify(published).includes("device"), false);
    assert.equal(JSON.stringify(published).includes(authToken), true);
  });

  await test("broker rejects unsupported actions, internal fields, and missing profile", async () => {
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      {} as never
    );
    const sanitize = (
      service as unknown as {
        sanitizeArguments(
          value: Record<string, unknown>,
          allowedProfile: string
        ): Record<string, unknown> | Error;
      }
    ).sanitizeArguments.bind(service);
    const base = {
      request: {
        action: "snapshot",
        profile: "Work",
        arguments: { url: "https://example.com" }
      }
    };
    assert.ok(
      sanitize(
        {
          request: { ...base.request, action: "request_user_action" }
        },
        "Work"
      ) instanceof Error
    );
    assert.ok(sanitize({ request: { ...base.request, profile: "" } }, "Work") instanceof Error);
    assert.ok(
      sanitize(
        {
          request: { ...base.request, arguments: { bridgeDeviceId: "secret" } }
        },
        "Work"
      ) instanceof Error
    );
    assert.ok(sanitize({ request: base.request }, "Personal") instanceof Error);
  });

  await test("broker subscriber boundary contains publisher failures and oversized results", async () => {
    for (const mode of ["throw", "zero", "oversized"] as const) {
      const browserService = {
        async executeToolCall() {
          return {
            payload:
              mode === "oversized"
                ? { action: "completed", text: "x".repeat(1024 * 1024 + 1) }
                : { action: "completed" },
            artifacts: []
          };
        }
      };
      const published: Array<Record<string, unknown>> = [];
      const service = new RuntimeScriptBrowserBrokerService(
        { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
        browserService as never
      );
      const internal = service as unknown as {
        current: { publisher: { publish(channel: string, message: string): Promise<number> } } | null;
        brokers: Map<string, Record<string, unknown>>;
        handleMessageSafely(message: string): Promise<void>;
      };
      internal.current = {
        publisher: {
          async publish(_channel, message) {
            if (mode === "throw") throw new Error("redis unavailable");
            if (mode === "zero") return 0;
            published.push(JSON.parse(message) as Record<string, unknown>);
            return 1;
          }
        }
      };
      internal.brokers.set(brokerId, {
        binding: {
          brokerId,
          authToken,
          expiresAt: "2099-01-01T00:00:00.000Z"
        },
        sandboxJobId: sandboxJobId,
        inFlight: false,
        bundle: {},
        sessionId: "session",
        chatId: "chat",
        transportSurface: "web",
        bridgeDeviceId: "device",
        bridgeDeviceKind: "desktop_extension",
        sourceUserMessageText: null,
        sourceUserMessageCreatedAt: null,
        allowedProfile: "Work",
        ttlMs: 30_000
      });
      await assert.doesNotReject(
        internal.handleMessageSafely(
          JSON.stringify({
            version: 1,
            brokerId,
            authToken,
            sandboxJobId,
            request: {
              version: 1,
              requestId: `request_${mode.padEnd(8, "x")}`,
              action: "snapshot",
              profile: "Work",
              arguments: {}
            }
          })
        )
      );
      if (mode === "oversized") {
        assert.equal(
          (published[0]?.error as { code?: string } | undefined)?.code,
          "script_browser_dispatch_failed"
        );
      }
    }
  });

  await test("broker parser rejects attacker-controlled channels and malformed envelopes", () => {
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      {} as never
    );
    const parse = (
      service as unknown as {
        parseEnvelope(message: string): unknown;
      }
    ).parseEnvelope.bind(service);
    assert.equal(
      parse(
        JSON.stringify({
          version: 1,
          brokerId: "attacker:channel",
          authToken,
          sandboxJobId,
          request: {
            version: 1,
            requestId: "request_12345678",
            action: "snapshot",
            profile: "Work",
            arguments: {}
          }
        })
      ),
      null
    );
    assert.equal(
      parse(
        JSON.stringify({
          version: 1,
          brokerId,
          authToken,
          sandboxJobId,
          extra: true,
          request: {
            version: 1,
            requestId: "short",
            action: "snapshot",
            profile: "Work",
            arguments: {}
          }
        })
      ),
      null
    );
  });

  await test("an initial connect() failure clears the cached connect promise so a later register() actually retries instead of replaying the failure", async () => {
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      {} as never
    );
    const internal = service as unknown as {
      connect(): Promise<void>;
      connectPromise: Promise<void> | null;
      current: { publisher: { publish(channel: string, message: string): Promise<number> } } | null;
    };
    let calls = 0;
    internal.connect = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("initial_connect_failed");
      }
      internal.current = { publisher: { publish: async () => 1 } };
    };

    await assert.rejects(service.register(registerInput() as never), /initial_connect_failed/);
    assert.equal(
      internal.connectPromise,
      null,
      "a failed connect must clear the cached promise, not permanently poison future attempts"
    );

    const registered = await service.register(registerInput() as never);
    assert.equal(calls, 2, "the second register() call must actually re-invoke connect(), not reuse the failed attempt");
    registered.close();
  });

  await test("a terminal end disposes exactly the current pair, lets the next connection replace it, and a stale event from a superseded pair never clobbers the replacement", async () => {
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      {} as never
    );
    const internal = service as unknown as {
      adoptPair(
        publisher: FakeRedisClient,
        subscriber: FakeRedisClient
      ): { publisher: FakeRedisClient; subscriber: FakeRedisClient };
      current: { publisher: FakeRedisClient; subscriber: FakeRedisClient } | null;
      connectPromise: Promise<void> | null;
    };

    const pairA = { publisher: fakeRedisClient(), subscriber: fakeRedisClient() };
    internal.adoptPair(pairA.publisher, pairA.subscriber);
    assert.equal(internal.current?.publisher, pairA.publisher);

    // Simulate a fresh reconnect superseding pairA (e.g. after pairA's own
    // connect promise had already been cleared and a new connect() ran).
    const pairB = { publisher: fakeRedisClient(), subscriber: fakeRedisClient() };
    internal.adoptPair(pairB.publisher, pairB.subscriber);
    assert.equal(internal.current?.publisher, pairB.publisher);

    // A stale "end" from the OLD, already-superseded pairA must not tear down
    // the live pairB.
    pairA.publisher.emit("end");
    assert.equal(internal.current?.publisher, pairB.publisher, "pairB must remain current");
    assert.equal(pairB.publisher.quitCalls, 0);
    assert.equal(pairB.subscriber.quitCalls, 0);

    // The current pair's own terminal end (e.g. bounded reconnect exhaustion)
    // must dispose both paired clients and clear the cache so the next
    // register()/ensureConnected() call reconnects.
    pairB.subscriber.emit("end");
    assert.equal(internal.current, null);
    assert.equal(internal.connectPromise, null);
    assert.equal(pairB.publisher.quitCalls, 1);
    assert.equal(pairB.subscriber.quitCalls, 1);

    // A second, redundant "end" on an already-disposed pair must not double-dispose.
    pairB.publisher.emit("end");
    assert.equal(pairB.publisher.quitCalls, 1);
    assert.equal(pairB.subscriber.quitCalls, 1);
  });

  await test("onModuleDestroy quits the current pair exactly once and is a safe no-op with no connection", async () => {
    const service = new RuntimeScriptBrowserBrokerService(
      { RUNTIME_STATE_REDIS_URL: "redis://unused" } as never,
      {} as never
    );
    await assert.doesNotReject(service.onModuleDestroy());

    const internal = service as unknown as {
      adoptPair(
        publisher: FakeRedisClient,
        subscriber: FakeRedisClient
      ): { publisher: FakeRedisClient; subscriber: FakeRedisClient };
      current: unknown;
    };
    const publisher = fakeRedisClient();
    const subscriber = fakeRedisClient();
    internal.adoptPair(publisher, subscriber);

    await service.onModuleDestroy();
    assert.equal(publisher.quitCalls, 1);
    assert.equal(subscriber.quitCalls, 1);
    assert.equal(internal.current, null);
  });
}
