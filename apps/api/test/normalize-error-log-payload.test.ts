import assert from "node:assert/strict";
import { normalizeErrorLogPayload } from "@persai/logger";

// ADR-074 F1: regression for the GKE log-quality bug where Nest's
// ExceptionsHandler used to log `{level:50,context:"ExceptionsHandler",msg:{}}`
// because pino serialised raw Error objects to `{}`. The new helper extracts
// `name`/`message`/`stack`/`cause` so the structured payload actually contains
// the failure reason while still emitting a useful `msg` string.
function runErrorInstanceTest(): void {
  const error = new TypeError("boom");
  const payload = normalizeErrorLogPayload(error);
  assert.equal(payload.msg, "boom");
  assert.ok(payload.err !== undefined);
  assert.equal(payload.err?.name, "TypeError");
  assert.equal(payload.err?.message, "boom");
  assert.ok(typeof payload.err?.stack === "string");
}

function runErrorWithCauseTest(): void {
  const cause = new Error("upstream 500");
  const error = new Error("downstream wrapper");
  (error as Error & { cause?: unknown }).cause = cause;
  const payload = normalizeErrorLogPayload(error);
  assert.ok(payload.err !== undefined);
  assert.deepEqual(
    {
      name: (payload.err?.cause as { name?: string }).name,
      message: (payload.err?.cause as { message?: string }).message
    },
    { name: "Error", message: "upstream 500" }
  );
}

function runStringTest(): void {
  const payload = normalizeErrorLogPayload("plain string error", "stack-trace");
  assert.equal(payload.msg, "plain string error");
  assert.equal(payload.trace, "stack-trace");
  assert.equal(payload.err, undefined);
}

function runObjectTest(): void {
  const payload = normalizeErrorLogPayload({ status: 500, body: "oops" });
  assert.equal(payload.msg, '{"status":500,"body":"oops"}');
  assert.equal(payload.err, undefined);
}

function runCircularObjectTest(): void {
  const obj: Record<string, unknown> = { name: "loop" };
  obj.self = obj;
  const payload = normalizeErrorLogPayload(obj);
  // Falls back to String(input) when JSON.stringify throws on circular refs.
  assert.equal(typeof payload.msg, "string");
  assert.ok(payload.msg.length > 0);
}

async function main(): Promise<void> {
  runErrorInstanceTest();
  runErrorWithCauseTest();
  runStringTest();
  runObjectTest();
  runCircularObjectTest();
  console.log("normalizeErrorLogPayload OK");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
