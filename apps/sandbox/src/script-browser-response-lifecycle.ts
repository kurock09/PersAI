import type { Writable } from "node:stream";

// Kubernetes exec stdin cannot be fed a large payload as one write/WebSocket
// frame — see the live-proven 52,582,400-byte loss documented next to
// `WORKSPACE_PUSH_CHUNK_BYTES` in exec-pod-bridge.service.ts. A Script browser
// response frame (base64url-encoded, up to `MAX_SCRIPT_BROWSER_RESPONSE_BYTES`)
// can be well over a megabyte, so it must be split into the same bounded
// chunk size and written with explicit backpressure handling rather than as
// one `stdin.write(frame)` call.
const MAX_WRITE_CHUNK_BYTES = 64 * 1024;

export class ScriptBrowserResponseLifecycle {
  private accepting = true;
  private readonly tasks = new Set<Promise<void>>();
  // Serializes actual stdin writes across concurrently dispatched frames so
  // chunks from different responses can never interleave on the wire, and so
  // `close()` can await one tail promise instead of racing per-frame writes.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly stdin: Writable) {}

  dispatch(input: {
    requestResponse: () => Promise<string>;
    failureResponse: (error: unknown) => string;
  }): void {
    // Reject only *new* dispatches after close begins. Already-accepted tasks
    // must still finish their chunked writes; `accepting` must not abort them.
    if (!this.accepting) {
      return;
    }
    const task = input
      .requestResponse()
      .then((responseFrame) => this.enqueueWrite(responseFrame))
      .catch((error) => {
        // Close-induced rejects (and any failure after close began) must not
        // write after the session is shutting down. Successful frames already
        // resolved before/during close still flush through writeQueue.
        if (!this.accepting) return;
        return this.enqueueWrite(input.failureResponse(error));
      })
      .finally(() => {
        this.tasks.delete(task);
      });
    this.tasks.add(task);
  }

  async close(closeBroker: () => Promise<void>): Promise<void> {
    this.accepting = false;
    try {
      await closeBroker();
    } finally {
      await Promise.allSettled([...this.tasks]);
      // Every dispatched task's write is chained onto `writeQueue`, so
      // awaiting the current tail guarantees no chunked write is still in
      // flight before `stdin.end()` below.
      await this.writeQueue.catch(() => undefined);
      if (!this.stdin.destroyed && !this.stdin.writableEnded) {
        this.stdin.end();
      }
    }
  }

  private enqueueWrite(frame: string): Promise<void> {
    const next = this.writeQueue.catch(() => undefined).then(() => this.writeChunked(frame));
    this.writeQueue = next;
    return next;
  }

  private async writeChunked(frame: string): Promise<void> {
    const buffer = Buffer.from(frame, "utf8");
    for (let offset = 0; offset < buffer.length; offset += MAX_WRITE_CHUNK_BYTES) {
      if (!this.canWrite()) return;
      const end = Math.min(offset + MAX_WRITE_CHUNK_BYTES, buffer.length);
      await this.writeChunk(buffer.subarray(offset, end));
    }
  }

  private canWrite(): boolean {
    // Stream liveness only. Close flips `accepting` to stop new dispatches,
    // but in-flight frames must keep writing until the queue drains.
    return !this.stdin.destroyed && !this.stdin.writableEnded;
  }

  /**
   * Writes one bounded chunk and honors Node's own backpressure signal:
   * `write()` returning `false` means the internal buffer is full, so this
   * waits for `drain` before resolving (letting the caller's loop re-check
   * `canWrite()` before the next chunk). `close`/`error` are also observed so
   * a stream that goes away mid-write can never leave this hanging forever.
   */
  private writeChunk(chunk: Buffer): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.canWrite()) {
        resolve();
        return;
      }
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.stdin.removeListener("drain", settle);
        this.stdin.removeListener("close", settle);
        this.stdin.removeListener("error", settle);
        resolve();
      };
      const wroteWithoutBackpressure = this.stdin.write(chunk, () => settle());
      if (wroteWithoutBackpressure) {
        settle();
        return;
      }
      this.stdin.once("drain", settle);
      this.stdin.once("close", settle);
      this.stdin.once("error", settle);
    });
  }
}
