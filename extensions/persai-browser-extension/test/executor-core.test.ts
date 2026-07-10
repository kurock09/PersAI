import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionDeniedResult,
  buildUnsupportedPdfResult,
  computeReconnectDelayMs,
  mergeWarnings,
  shouldSurfaceNeedsUserAction
} from "../src/executor-core.js";

test("computeReconnectDelayMs uses bounded backoff", () => {
  assert.equal(computeReconnectDelayMs(0), 1_000);
  assert.equal(computeReconnectDelayMs(2), 5_000);
  assert.equal(computeReconnectDelayMs(999), 30_000);
});

test("mergeWarnings drops empty items and preserves order", () => {
  assert.equal(mergeWarnings("first", "", null, "second"), "first; second");
  assert.equal(mergeWarnings("", null, undefined), null);
});

test("shouldSurfaceNeedsUserAction detects challenge and payment flows", () => {
  assert.equal(
    shouldSurfaceNeedsUserAction({
      pageText: "Please verify you are human to continue."
    }),
    true
  );
  assert.equal(
    shouldSurfaceNeedsUserAction({
      operations: [{ kind: "click", selector: "button[data-testid='pay-now']" }]
    }),
    true
  );
  assert.equal(
    shouldSurfaceNeedsUserAction({
      pageText: "Normal product listing",
      operations: [{ kind: "click", selector: "button.buy" }]
    }),
    false
  );
  assert.equal(
    shouldSurfaceNeedsUserAction({
      pageText: "Корзина · Оплата картой доступна при оформлении заказа"
    }),
    false
  );
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
