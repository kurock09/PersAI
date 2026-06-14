import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSafetyInboundWarnMessengerCopy } from "../src/modules/workspace-management/application/system-copy/system-copy-catalog";

describe("resolveSafetyInboundWarnMessengerCopy", () => {
  it("localizes warn copy with reason-specific body", () => {
    const copy = resolveSafetyInboundWarnMessengerCopy("hack_abuse", "ru", "fallback");
    assert.match(copy, /Внимание/);
    assert.match(copy, /В этой переписке было сообщение/);
    assert.match(copy, /Пока можно продолжать чат/);
  });
});
