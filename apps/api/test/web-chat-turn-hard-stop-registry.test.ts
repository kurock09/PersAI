import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WebChatTurnHardStopRegistry } from "../src/modules/workspace-management/application/web-chat-turn-hard-stop-registry.service";

/**
 * Pre-prod polish 2026 / FIX 1, Slice 1.2 — registry-level invariants.
 *
 * The integration boundary (controller wiring + SSE / runtime cooperation)
 * is exercised by `stream-web-chat-turn.service.test.ts` and the
 * controller route tests. These tests pin down the in-memory dispatcher's
 * own contract: register/release lifecycle, idempotency on rapid retry,
 * and authorization-by-userId at the second line of defense.
 */
describe("WebChatTurnHardStopRegistry", () => {
  test("signalHardStop aborts the registered controller and removes the entry", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    registry.register({ clientTurnId: "turn-1", userId: "user-1", controller });

    assert.equal(controller.signal.aborted, false);
    const dispatched = registry.signalHardStop({ clientTurnId: "turn-1", userId: "user-1" });

    assert.equal(dispatched, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(registry.hasForTesting("turn-1"), false);
  });

  test("signalHardStop returns false when no turn is registered", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const dispatched = registry.signalHardStop({
      clientTurnId: "missing",
      userId: "user-1"
    });
    assert.equal(dispatched, false);
  });

  test("signalHardStop refuses cross-user dispatch and leaves the controller intact", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    registry.register({ clientTurnId: "turn-2", userId: "user-1", controller });

    const dispatched = registry.signalHardStop({
      clientTurnId: "turn-2",
      userId: "user-2"
    });

    assert.equal(dispatched, false);
    assert.equal(controller.signal.aborted, false);
    // The owning user must still be able to stop their own turn afterwards.
    assert.equal(registry.hasForTesting("turn-2"), true);
    const ownerDispatch = registry.signalHardStop({
      clientTurnId: "turn-2",
      userId: "user-1"
    });
    assert.equal(ownerDispatch, true);
    assert.equal(controller.signal.aborted, true);
  });

  test("release is a no-op when no entry exists", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    // Should not throw.
    registry.release({ clientTurnId: "never-registered", controller });
    assert.equal(registry.hasForTesting("never-registered"), false);
  });

  test("release only deletes when the matching controller is still registered", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const firstController = new AbortController();
    const secondController = new AbortController();

    // Rapid retry with the same clientTurnId — the second register replaces
    // the first entry (matches the production race where the SSE handler
    // for retry #1 has not yet hit its `finally` block when retry #2 runs).
    registry.register({ clientTurnId: "turn-3", userId: "user-1", controller: firstController });
    registry.register({ clientTurnId: "turn-3", userId: "user-1", controller: secondController });

    // The first SSE handler now hits `finally`. It must not delete the
    // newer registration, otherwise the user's Stop click on the
    // currently-running retry would land on an empty registry.
    registry.release({ clientTurnId: "turn-3", controller: firstController });
    assert.equal(registry.hasForTesting("turn-3"), true);

    registry.release({ clientTurnId: "turn-3", controller: secondController });
    assert.equal(registry.hasForTesting("turn-3"), false);
  });

  test("a soft-detached SSE close is decoupled from the registered controller", () => {
    // Simulates the controller refactor: the SSE handler used to abort on
    // socket close; after Slice 1.2 the registered controller is only
    // touched via signalHardStop. This test is the unit-level guard that
    // nothing in the registry surface has hidden auto-abort semantics.
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    registry.register({ clientTurnId: "turn-4", userId: "user-1", controller });

    // Simulate the post-refactor SSE handler: socket dies, handler hits
    // `finally`, registry release is called — but there was no hard stop.
    registry.release({ clientTurnId: "turn-4", controller });

    assert.equal(controller.signal.aborted, false);
    assert.equal(registry.hasForTesting("turn-4"), false);
  });
});
