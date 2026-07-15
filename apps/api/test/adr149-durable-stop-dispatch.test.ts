import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WebChatTurnStopDispatchService } from "../src/modules/workspace-management/application/web-chat-turn-stop-dispatch.service";

describe("ADR-149 durable stop dispatch", () => {
  test("local stop aborts the registered controller and marks user stop", async () => {
    const service = new WebChatTurnStopDispatchService();
    const controller = new AbortController();
    service.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      controller
    });

    const outcome = await service.dispatchStop({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      attemptStatus: "running"
    });

    assert.deepEqual(outcome, { status: "stopped" });
    assert.equal(controller.signal.aborted, true);
    assert.equal(service.wasUserStopped("assistant-1", "turn-1"), true);
    assert.equal(service.hasLocalTurnForTesting("assistant-1", "turn-1"), false);
  });

  test("dispatchStop returns turn_not_found when no inflight owner or attempt", async () => {
    const service = new WebChatTurnStopDispatchService();
    const outcome = await service.dispatchStop({
      assistantId: "assistant-1",
      clientTurnId: "missing",
      userId: "user-1",
      attemptStatus: null
    });
    assert.deepEqual(outcome, { status: "turn_not_found" });
  });

  test("dispatchStop returns already_done for terminal attempts", async () => {
    const service = new WebChatTurnStopDispatchService();
    const outcome = await service.dispatchStop({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      attemptStatus: "completed"
    });
    assert.deepEqual(outcome, { status: "already_done" });
  });

  test("dispatchStop refuses cross-user stop", async () => {
    const service = new WebChatTurnStopDispatchService();
    const controller = new AbortController();
    service.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-1",
      controller
    });

    const outcome = await service.dispatchStop({
      assistantId: "assistant-1",
      clientTurnId: "turn-1",
      userId: "user-2",
      attemptStatus: "running"
    });

    assert.deepEqual(outcome, { status: "forbidden" });
    assert.equal(controller.signal.aborted, false);
  });

  test("release only deletes when the matching controller is still registered", () => {
    const service = new WebChatTurnStopDispatchService();
    const firstController = new AbortController();
    const secondController = new AbortController();

    service.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      userId: "user-1",
      controller: firstController
    });
    service.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      userId: "user-1",
      controller: secondController
    });

    service.release({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      controller: firstController
    });
    assert.equal(service.hasLocalTurnForTesting("assistant-1", "turn-3"), true);

    service.release({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      controller: secondController
    });
    assert.equal(service.hasLocalTurnForTesting("assistant-1", "turn-3"), false);
  });
});
