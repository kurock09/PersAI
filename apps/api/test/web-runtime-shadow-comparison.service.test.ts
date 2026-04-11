import assert from "node:assert/strict";
import { WebRuntimeShadowComparisonService } from "../src/modules/workspace-management/application/web-runtime-shadow-comparison.service";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function* streamChunks(text: string): AsyncGenerator<{
  type: "delta" | "done";
  delta?: string;
  accumulated?: string;
}> {
  yield { type: "delta", delta: text, accumulated: text };
  yield { type: "done" };
}

async function run(): Promise<void> {
  const service = new WebRuntimeShadowComparisonService();

  service.queueSyncNativeComparison({
    assistantId: "assistant-sync",
    surfaceThreadKey: "thread-sync",
    clientTurnId: "turn-sync",
    primary: {
      status: "completed",
      runtimeMs: 120,
      assistantMessage: "shadow sync ok"
    },
    executeShadow: async () => ({
      assistantMessage: "shadow sync ok",
      rawOutput: null
    })
  });

  await flushMicrotasks();

  let state = service.getState();
  assert.equal(state.recent.length, 1);
  assert.equal(state.recent[0]?.route, "sync");
  assert.equal(state.recent[0]?.verdict, "match");
  assert.equal(state.recent[0]?.primary.preview, "shadow sync ok");

  service.queueStreamNativeComparison({
    assistantId: "assistant-stream",
    surfaceThreadKey: "thread-stream",
    clientTurnId: "turn-stream",
    primary: {
      status: "completed",
      runtimeMs: 240,
      firstDeltaMs: 40,
      deltaCount: 1,
      assistantText: "primary stream text",
      errorCode: null,
      errorMessage: null
    },
    executeShadow: () => streamChunks("different stream text")
  });

  await flushMicrotasks();

  state = service.getState();
  assert.equal(state.recent.length, 2);
  assert.equal(state.recent[0]?.route, "stream");
  assert.equal(state.recent[0]?.verdict, "mismatch");
  assert.equal(state.recent[0]?.contentMatch, false);
  assert.equal(state.recent[0]?.primary.deltaCount, 1);
  assert.equal(state.recent[0]?.shadow.deltaCount, 1);
  assert.equal(state.updatedAt, state.recent[0]?.comparedAt ?? null);
}

void run();
