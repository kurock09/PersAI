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
    registry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      controller
    });

    assert.equal(controller.signal.aborted, false);
    const dispatched = registry.signalHardStop({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1"
    });

    assert.equal(dispatched, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(registry.hasForTesting("assistant-1", "turn-1"), false);
  });

  test("signalHardStop returns false when no turn is registered", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const dispatched = registry.signalHardStop({
      assistantId: "assistant-1",
      clientTurnId: "missing",
      userId: "user-1"
    });
    assert.equal(dispatched, false);
  });

  test("signalHardStop refuses cross-user dispatch and leaves the controller intact", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    registry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-2",
      userId: "user-1",
      controller
    });

    const dispatched = registry.signalHardStop({
      assistantId: "assistant-1",
      clientTurnId: "turn-2",
      userId: "user-2"
    });

    assert.equal(dispatched, false);
    assert.equal(controller.signal.aborted, false);
    // The owning user must still be able to stop their own turn afterwards.
    assert.equal(registry.hasForTesting("assistant-1", "turn-2"), true);
    const ownerDispatch = registry.signalHardStop({
      assistantId: "assistant-1",
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
    registry.release({ assistantId: "assistant-1", clientTurnId: "never-registered", controller });
    assert.equal(registry.hasForTesting("assistant-1", "never-registered"), false);
  });

  test("release only deletes when the matching controller is still registered", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const firstController = new AbortController();
    const secondController = new AbortController();

    // Rapid retry with the same clientTurnId — the second register replaces
    // the first entry (matches the production race where the SSE handler
    // for retry #1 has not yet hit its `finally` block when retry #2 runs).
    registry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      userId: "user-1",
      controller: firstController
    });
    registry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      userId: "user-1",
      controller: secondController
    });

    // The first SSE handler now hits `finally`. It must not delete the
    // newer registration, otherwise the user's Stop click on the
    // currently-running retry would land on an empty registry.
    registry.release({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      controller: firstController
    });
    assert.equal(registry.hasForTesting("assistant-1", "turn-3"), true);

    registry.release({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      controller: secondController
    });
    assert.equal(registry.hasForTesting("assistant-1", "turn-3"), false);
  });

  test("a soft-detached SSE close is decoupled from the registered controller", () => {
    // Simulates the controller refactor: the SSE handler used to abort on
    // socket close; after Slice 1.2 the registered controller is only
    // touched via signalHardStop. This test is the unit-level guard that
    // nothing in the registry surface has hidden auto-abort semantics.
    const registry = new WebChatTurnHardStopRegistry();
    const controller = new AbortController();
    registry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-4",
      userId: "user-1",
      controller
    });

    // Simulate the post-refactor SSE handler: socket dies, handler hits
    // `finally`, registry release is called — but there was no hard stop.
    registry.release({ assistantId: "assistant-1", clientTurnId: "turn-4", controller });

    assert.equal(controller.signal.aborted, false);
    assert.equal(registry.hasForTesting("assistant-1", "turn-4"), false);
  });

  test("same clientTurnId stays isolated across assistants", () => {
    const registry = new WebChatTurnHardStopRegistry();
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    registry.register({
      assistantId: "assistant-A",
      clientTurnId: "turn-1",
      userId: "user-1",
      controller: controllerA
    });
    registry.register({
      assistantId: "assistant-B",
      clientTurnId: "turn-1",
      userId: "user-1",
      controller: controllerB
    });

    const stoppedB = registry.signalHardStop({
      assistantId: "assistant-B",
      clientTurnId: "turn-1",
      userId: "user-1"
    });

    assert.equal(stoppedB, true);
    assert.equal(controllerA.signal.aborted, false);
    assert.equal(controllerB.signal.aborted, true);
    assert.equal(registry.hasForTesting("assistant-A", "turn-1"), true);
    assert.equal(registry.hasForTesting("assistant-B", "turn-1"), false);
  });
});
