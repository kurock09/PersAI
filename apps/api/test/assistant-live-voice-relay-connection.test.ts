import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  type RelayWebSocketLike,
  pumpRelayConnection
} from "../src/modules/workspace-management/application/assistant-live-voice-relay-connection";

class FakeSocket extends EventEmitter implements RelayWebSocketLike {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly sent: Array<{ data: unknown; binary: boolean }> = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  override on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  send(data: unknown, opts?: { binary?: boolean }, cb?: (error?: Error) => void): void {
    this.sent.push({ data, binary: opts?.binary === true });
    cb?.();
  }

  close(code?: number, reason?: string): void {
    if (this.readyState !== this.OPEN) {
      return;
    }
    this.readyState = 3;
    this.closed.push({ code, reason });
  }

  emitMessage(data: unknown, binary: boolean): void {
    this.emit("message", data, binary);
  }

  emitClose(code?: number): void {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(""));
  }

  emitError(message: string): void {
    this.emit("error", new Error(message));
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    const dispose = pumpRelayConnection({
      client,
      upstream,
      idleTimeoutMs: 50,
      maxDurationMs: 500
    });
    client.emitMessage(Buffer.from("hello"), true);
    upstream.emitMessage("world", false);
    assert.deepEqual(upstream.sent, [{ data: Buffer.from("hello"), binary: true }]);
    assert.deepEqual(client.sent, [{ data: "world", binary: false }]);
    dispose();
  }

  {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    pumpRelayConnection({
      client,
      upstream,
      idleTimeoutMs: 50,
      maxDurationMs: 500
    });
    client.emitClose(1000);
    assert.equal(upstream.closed.length, 1);
    assert.equal(client.closed.length, 0);
    client.emitClose(1000);
    assert.equal(upstream.closed.length, 1);
  }

  {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    pumpRelayConnection({
      client,
      upstream,
      idleTimeoutMs: 20,
      maxDurationMs: 500
    });
    await wait(35);
    assert.equal(client.closed.length, 1);
    assert.equal(upstream.closed.length, 1);
  }

  {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    pumpRelayConnection({
      client,
      upstream,
      idleTimeoutMs: 500,
      maxDurationMs: 20
    });
    await wait(35);
    assert.equal(client.closed.length, 1);
    assert.equal(upstream.closed.length, 1);
  }

  console.log("assistant-live-voice-relay-connection: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
