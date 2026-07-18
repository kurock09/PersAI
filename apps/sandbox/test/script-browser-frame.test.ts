import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import {
  SCRIPT_BROWSER_REQUEST_FRAME_PREFIX,
  SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX,
  type RuntimeScriptBrowserSdkRequest
} from "@persai/runtime-contract";
import {
  parseScriptBrowserRequestFrame,
  ScriptBrowserFrameDecoder
} from "../src/script-browser-frame";
import { buildScriptBrowserResponseFrame } from "../src/script-browser-broker.service";

function frame(value: unknown): string {
  return `${SCRIPT_BROWSER_REQUEST_FRAME_PREFIX}${Buffer.from(
    JSON.stringify(value),
    "utf8"
  ).toString("base64url")}`;
}

const validRequest: RuntimeScriptBrowserSdkRequest = {
  version: 1,
  requestId: "request_12345678",
  action: "snapshot",
  profile: "Work",
  arguments: { url: "https://example.com" }
};

test("browser frame parser accepts only bounded snapshot/act requests with a profile", () => {
  assert.deepEqual(parseScriptBrowserRequestFrame(frame(validRequest)), validRequest);
  assert.throws(
    () => parseScriptBrowserRequestFrame(frame({ ...validRequest, action: "request_user_action" })),
    /invalid/
  );
  assert.throws(
    () => parseScriptBrowserRequestFrame(frame({ ...validRequest, profile: "" })),
    /invalid/
  );
  assert.throws(
    () => parseScriptBrowserRequestFrame(frame({ ...validRequest, internalToken: "secret" })),
    /invalid/
  );
});

test("duplex decoder strips fragmented broker frames and preserves result stdout", async () => {
  let ordinary = "";
  const requests: RuntimeScriptBrowserSdkRequest[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      ordinary += chunk.toString();
      callback();
    }
  });
  const decoder = new ScriptBrowserFrameDecoder((request) => requests.push(request), sink);
  const encoded = `${frame(validRequest)}\n`;
  decoder.write(encoded.slice(0, 13));
  decoder.write(`${encoded.slice(13)}\n___PERSAI_SCRIPT_RESULT___\n{"ok":true}`);
  decoder.flushRemainder();
  assert.deepEqual(requests, [validRequest]);
  assert.equal(ordinary, '\n___PERSAI_SCRIPT_RESULT___\n{"ok":true}');
});

test("duplex decoder rejects malformed, oversized, and unterminated frames", () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  assert.throws(
    () => parseScriptBrowserRequestFrame(`${SCRIPT_BROWSER_REQUEST_FRAME_PREFIX}not-json`),
    /malformed/
  );
  const unterminated = new ScriptBrowserFrameDecoder(() => undefined, sink);
  unterminated.write(frame(validRequest));
  assert.throws(() => unterminated.flushRemainder(), /unterminated/);
});

test("sandbox strips Redis routing credentials before returning a response to Script", () => {
  const encoded = buildScriptBrowserResponseFrame({
    version: 1,
    brokerId: "internal-broker",
    authToken: "internal-token",
    sandboxJobId: "internal-job",
    requestId: "request_12345678",
    ok: true,
    result: { action: "completed" } as never
  });
  const payload = JSON.parse(
    Buffer.from(
      encoded.slice(SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX.length).trim(),
      "base64url"
    ).toString("utf8")
  ) as Record<string, unknown>;
  assert.equal(payload.requestId, "request_12345678");
  assert.equal(JSON.stringify(payload).includes("internal-"), false);
});

test("decoder streams a large newline-free ordinary Script result without treating it as a frame", () => {
  let byteCount = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      byteCount += chunk.length;
      callback();
    }
  });
  const decoder = new ScriptBrowserFrameDecoder(() => assert.fail("unexpected frame"), sink);
  const ordinary = "x".repeat(300_000);
  decoder.write(ordinary);
  decoder.flushRemainder();
  assert.equal(byteCount, ordinary.length);
});
