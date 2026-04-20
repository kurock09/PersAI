import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EventEmitter } from "node:events";
import { createStreamWriterInstrumentation } from "../src/modules/workspace-management/interface/http/stream-writer-instrumentation";

describe("createStreamWriterInstrumentation", () => {
  test("counts writes and ignores backpressure when write returns true", () => {
    const instrumentation = createStreamWriterInstrumentation();
    const emitter = new EventEmitter();

    instrumentation.recordWrite(true, emitter);
    instrumentation.recordWrite(true, emitter);
    instrumentation.recordWrite(true, emitter);

    const stats = instrumentation.snapshot();
    assert.equal(stats.writes, 3);
    assert.equal(stats.backpressureWrites, 0);
    assert.equal(stats.backpressureMaxDrainMs, 0);
    assert.equal(stats.backpressureTotalDrainMs, 0);
    assert.equal(emitter.listenerCount("drain"), 0);
  });

  test("counts backpressure when write returns false and records max drain", async () => {
    const instrumentation = createStreamWriterInstrumentation();
    const emitter = new EventEmitter();

    instrumentation.recordWrite(false, emitter);
    instrumentation.recordWrite(false, emitter);

    assert.equal(emitter.listenerCount("drain"), 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    emitter.emit("drain");

    const stats = instrumentation.snapshot();
    assert.equal(stats.writes, 2);
    assert.equal(stats.backpressureWrites, 2);
    assert.ok(
      stats.backpressureMaxDrainMs >= 15,
      `expected drain ms >= 15, got ${stats.backpressureMaxDrainMs}`
    );
    assert.equal(stats.backpressureTotalDrainMs, stats.backpressureMaxDrainMs);
    assert.equal(emitter.listenerCount("drain"), 0);
  });

  test("formatStats returns a stable string with all four fields", () => {
    const instrumentation = createStreamWriterInstrumentation();
    const emitter = new EventEmitter();
    instrumentation.recordWrite(true, emitter);
    instrumentation.recordWrite(false, emitter);
    emitter.emit("drain");

    const summary = instrumentation.formatStats();
    assert.match(
      summary,
      /^writes=2 backpressureWrites=1 backpressureMaxDrainMs=\d+ backpressureTotalDrainMs=\d+$/
    );
  });

  test("recordWrite handles repeated drain handlers without leaking", () => {
    const instrumentation = createStreamWriterInstrumentation();
    const emitter = new EventEmitter();

    instrumentation.recordWrite(false, emitter);
    instrumentation.recordWrite(false, emitter);
    instrumentation.recordWrite(false, emitter);

    assert.equal(emitter.listenerCount("drain"), 1);
    emitter.emit("drain");
    assert.equal(emitter.listenerCount("drain"), 0);

    instrumentation.recordWrite(false, emitter);
    assert.equal(emitter.listenerCount("drain"), 1);
  });
});
