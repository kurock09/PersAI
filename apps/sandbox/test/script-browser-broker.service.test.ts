import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { RuntimeScriptBrowserSdkRequest } from "@persai/runtime-contract";
import { ScriptBrowserBrokerService } from "../src/script-browser-broker.service";
import { ScriptBrowserResponseLifecycle } from "../src/script-browser-response-lifecycle";

type FakeRedisClient = EventEmitter & { quit: () => Promise<void>; quitCalls: number };

function fakeRedisClient(): FakeRedisClient {
  const emitter = new EventEmitter() as FakeRedisClient;
  emitter.quitCalls = 0;
  emitter.quit = async () => {
    emitter.quitCalls += 1;
  };
  return emitter;
}

/**
 * A `Writable` that records the exact byte boundaries of every underlying
 * `write()` call (deferring each callback to a later tick so backpressure is
 * realistic) instead of relying on a downstream `Readable`'s own 'data'
 * event chunking, which is free to re-buffer independently of what was
 * written and would make chunk-boundary assertions non-deterministic.
 */
function collectingWritable(highWaterMark: number): { stream: Writable; chunks: Buffer[] } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    highWaterMark,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    }
  });
  return { stream, chunks };
}

const binding = () => ({
  brokerId: "b".repeat(32),
  authToken: "t".repeat(43),
  expiresAt: new Date(Date.now() + 60_000).toISOString()
});
const sandboxJobId = "11111111-1111-4111-8111-111111111111";
const request: RuntimeScriptBrowserSdkRequest = {
  version: 1,
  requestId: "request_12345678",
  action: "snapshot",
  profile: "Work",
  arguments: {}
};

function serviceWithPublisher(publish: () => Promise<number>): {
  service: ScriptBrowserBrokerService;
  subscriber: {
    subscribe(_channel: string, listener: (message: string) => void): Promise<void>;
    unsubscribe(): Promise<void>;
    quit(): Promise<void>;
    connect(): Promise<void>;
    on(): void;
    emit(message: string): void;
  };
} {
  let listener: ((message: string) => void) | null = null;
  const subscriber = {
    on() {},
    async connect() {},
    async subscribe(_channel: string, next: (message: string) => void) {
      listener = next;
    },
    async unsubscribe() {},
    async quit() {},
    emit(message: string) {
      listener?.(message);
    }
  };
  const service = new ScriptBrowserBrokerService({
    SCRIPT_BROWSER_BROKER_REDIS_URL: "redis://unused"
  } as never);
  (service as unknown as { publisher: unknown }).publisher = {
    publish,
    duplicate: () => subscriber
  };
  return { service, subscriber };
}

test("broker clears pending state when publish throws or has zero receivers", async () => {
  let calls = 0;
  const { service } = serviceWithPublisher(async () => {
    calls += 1;
    if (calls === 1) throw new Error("redis unavailable");
    return 0;
  });
  const session = await service.openSession({
    binding: binding(),
    sandboxJobId,
    deadlineAtMs: Date.now() + 90_000
  });
  await assert.rejects(session.request(request), /redis unavailable/);
  await assert.rejects(
    session.request({ ...request, requestId: "request_87654321" }),
    /script_browser_broker_unavailable/
  );
  await session.close();
});

test("broker close rejects an active request promptly", async () => {
  const { service } = serviceWithPublisher(async () => 1);
  const session = await service.openSession({
    binding: binding(),
    sandboxJobId,
    deadlineAtMs: Date.now() + 90_000
  });
  const active = session.request(request);
  await new Promise((resolve) => setImmediate(resolve));
  await session.close();
  await assert.rejects(active, /script_browser_broker_closed/);
});

test("broker request times out within its binding deadline", async () => {
  const { service } = serviceWithPublisher(async () => 1);
  const shortBinding = binding();
  shortBinding.expiresAt = new Date(Date.now() + 20).toISOString();
  const session = await service.openSession({
    binding: shortBinding,
    sandboxJobId,
    deadlineAtMs: Date.now() + 100
  });
  await assert.rejects(session.request(request), /script_browser_response_timeout/);
  await session.close();
});

test("broker rejects malformed bindings and non-exclusive response unions", async () => {
  const { service, subscriber } = serviceWithPublisher(async () => 1);
  await assert.rejects(
    service.openSession({
      binding: { ...binding(), brokerId: "attacker:channel" },
      sandboxJobId,
      deadlineAtMs: Date.now() + 90_000
    }),
    /script_browser_broker_binding_invalid/
  );
  await assert.rejects(
    service.openSession({
      binding: { ...binding(), expiresAt: new Date(Date.now() + 120_000).toISOString() },
      sandboxJobId,
      deadlineAtMs: Date.now() + 60_000
    }),
    /script_browser_broker_binding_invalid/
  );
  const activeBinding = binding();
  const session = await service.openSession({
    binding: activeBinding,
    sandboxJobId,
    deadlineAtMs: Date.now() + 90_000
  });
  const active = session.request(request);
  await new Promise((resolve) => setImmediate(resolve));
  subscriber.emit(
    JSON.stringify({
      version: 1,
      brokerId: activeBinding.brokerId,
      authToken: activeBinding.authToken,
      sandboxJobId,
      requestId: request.requestId,
      ok: false,
      result: { action: "completed" },
      error: { code: "failed", message: "failed" }
    })
  );
  await assert.rejects(active, /script_browser_response_mismatched/);
  await session.close();
});

test("frame-then-exit closes the request and never writes after stdin end", async () => {
  const stdin = new PassThrough();
  let written = "";
  stdin.on("data", (chunk) => {
    written += chunk.toString();
  });
  const lifecycle = new ScriptBrowserResponseLifecycle(stdin);
  let rejectRequest!: (error: Error) => void;
  lifecycle.dispatch({
    requestResponse: () =>
      new Promise<string>((_resolve, reject) => {
        rejectRequest = reject;
      }),
    failureResponse: () => "must-not-write"
  });
  await lifecycle.close(async () => {
    rejectRequest(new Error("script_browser_broker_closed"));
  });
  assert.equal(stdin.writableEnded, true);
  assert.equal(written, "");
});

test("a fragmented >64KiB response is written in bounded chunks and honors backpressure before close ends stdin", async () => {
  const { stream: stdin, chunks: writes } = collectingWritable(4 * 1024);
  const lifecycle = new ScriptBrowserResponseLifecycle(stdin);
  const largeFrame = "x".repeat(200 * 1024);
  lifecycle.dispatch({
    requestResponse: async () => largeFrame,
    failureResponse: () => "must-not-write"
  });
  await lifecycle.close(async () => undefined);

  assert.equal(stdin.writableEnded, true);
  const received = Buffer.concat(writes).toString("utf8");
  assert.equal(received, largeFrame, "the full fragmented payload must round-trip byte-for-byte");
  assert.ok(
    writes.length > 1,
    "a >64KiB frame must be split across more than one underlying stream write"
  );
  for (const chunk of writes) {
    assert.ok(chunk.length <= 64 * 1024, "no single write may exceed the 64KiB chunk bound");
  }
});

test("close awaits an in-flight chunked write before ending stdin, and never hangs", async () => {
  const { stream: stdin, chunks: writes } = collectingWritable(1024);
  const lifecycle = new ScriptBrowserResponseLifecycle(stdin);
  const largeFrame = "y".repeat(150 * 1024);
  lifecycle.dispatch({
    requestResponse: async () => largeFrame,
    failureResponse: () => "must-not-write"
  });
  await lifecycle.close(async () => undefined);
  assert.equal(Buffer.concat(writes).toString("utf8"), largeFrame);
  assert.equal(stdin.writableEnded, true);
});

test("two concurrently dispatched frames never interleave their chunks on the wire", async () => {
  const { stream: stdin, chunks: writes } = collectingWritable(2 * 1024);
  const lifecycle = new ScriptBrowserResponseLifecycle(stdin);
  const frameA = "a".repeat(150 * 1024);
  const frameB = "b".repeat(150 * 1024);
  let releaseB!: () => void;
  const gateB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  // Frame A resolves immediately and is dispatched first, so it is enqueued
  // onto the write queue first. Frame B is dispatched second but resolves
  // later — its bytes must still queue strictly after ALL of frame A's
  // chunks (enqueue order, not completion order), and neither frame's bytes
  // may interleave with the other's.
  lifecycle.dispatch({
    requestResponse: async () => frameA,
    failureResponse: () => "must-not-write"
  });
  lifecycle.dispatch({
    requestResponse: async () => {
      await gateB;
      return frameB;
    },
    failureResponse: () => "must-not-write"
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseB();
  await lifecycle.close(async () => undefined);

  const received = Buffer.concat(writes).toString("utf8");
  assert.equal(received, frameA + frameB);
});

test("publisherClient invalidates exactly the current client on terminal end and lets the next call reconnect; a stale event from a superseded client never clobbers the replacement", async () => {
  const service = new ScriptBrowserBrokerService({
    SCRIPT_BROWSER_BROKER_REDIS_URL: "redis://unused"
  } as never);
  const internal = service as unknown as {
    adoptPublisher(client: FakeRedisClient): FakeRedisClient;
    publisher: FakeRedisClient | null;
    publisherPromise: Promise<FakeRedisClient> | null;
  };

  const clientA = fakeRedisClient();
  internal.adoptPublisher(clientA);
  assert.equal(internal.publisher, clientA);

  // Simulate a fresh reconnect superseding clientA.
  const clientB = fakeRedisClient();
  internal.adoptPublisher(clientB);
  assert.equal(internal.publisher, clientB);

  // A stale "end" from the OLD, already-superseded clientA must not tear
  // down the live clientB.
  clientA.emit("end");
  assert.equal(internal.publisher, clientB);

  // clientB's own terminal end must clear the cache so the next
  // publisherClient()/openSession() call reconnects.
  clientB.emit("end");
  assert.equal(internal.publisher, null);
  assert.equal(internal.publisherPromise, null);

  // A second, redundant "end" on an already-disposed client is a no-op.
  clientB.emit("end");
  assert.equal(internal.publisher, null);
});
