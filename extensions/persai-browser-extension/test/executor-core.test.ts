import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionDeniedResult,
  buildUnsupportedPdfResult,
  computeReconnectDelayMs,
  mergeWarnings
} from "../src/executor-core.js";
import { LOCAL_BROWSER_COMMAND_ACTIONS } from "../src/contract.js";
import { runPageCommandInPage } from "../src/page-runner.js";

test("local contract carries the turn observer lock action", () => {
  assert.equal(LOCAL_BROWSER_COMMAND_ACTIONS.includes("set_observer_lock"), true);
});

test("computeReconnectDelayMs uses bounded backoff", () => {
  assert.equal(computeReconnectDelayMs(0), 1_000);
  assert.equal(computeReconnectDelayMs(2), 5_000);
  assert.equal(computeReconnectDelayMs(999), 30_000);
});

test("mergeWarnings drops empty items and preserves order", () => {
  assert.equal(mergeWarnings("first", "", null, "second"), "first; second");
  assert.equal(mergeWarnings("", null, undefined), null);
});

test("structured unsupported results stay honest", () => {
  assert.deepEqual(buildUnsupportedPdfResult("cmd-1"), {
    commandId: "cmd-1",
    ok: false,
    errorReason: "unsupported_pdf",
    warning: "Chrome extension PDF capture is not supported in this MVP."
  });
  assert.deepEqual(buildPermissionDeniedResult("cmd-2", "https://lavka.yandex.ru/*"), {
    commandId: "cmd-2",
    ok: false,
    errorReason: "permission_denied",
    warning: "Host permission was denied for https://lavka.yandex.ru/*."
  });
});

test("page runner uses the bounded mutation-observed readiness gate", () => {
  const source = runPageCommandInPage.toString();
  assert.doesNotMatch(source, /text\.length\s*>=\s*40|visibleControls/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /quietIntervalMs\s*=\s*750/);
  assert.match(source, /loadStatus/);
});
