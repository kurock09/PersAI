import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TOOL_PROGRESS_LINE_MAX_CHARS,
  TOOL_PROGRESS_MAX_PER_TOOL_CALL,
  TOOL_PROGRESS_MAX_PER_TURN,
  TOOL_PROGRESS_STEP_MAX_CHARS,
  createTurnToolProgressSink,
  extractNewSandboxOutputLines,
  truncateToolProgressLine
} from "../src/modules/turns/tool-progress-sink";

test("truncateToolProgressLine caps stdout/stderr tails", () => {
  const longLine = "x".repeat(TOOL_PROGRESS_LINE_MAX_CHARS + 25);
  assert.equal(truncateToolProgressLine(longLine, TOOL_PROGRESS_LINE_MAX_CHARS).length, 200);
});

test("extractNewSandboxOutputLines emits only appended complete lines", () => {
  assert.deepEqual(extractNewSandboxOutputLines(null, "hello\nworld\n"), ["hello", "world"]);
  assert.deepEqual(extractNewSandboxOutputLines("hello\n", "hello\nworld\n"), ["world"]);
  assert.deepEqual(extractNewSandboxOutputLines("partial", "partial line"), []);
});

test("createTurnToolProgressSink enforces per-tool and per-turn caps", () => {
  const sink = createTurnToolProgressSink({
    requestId: "req-1",
    sessionId: "sess-1"
  });
  for (let index = 0; index < TOOL_PROGRESS_MAX_PER_TOOL_CALL + 5; index += 1) {
    sink.emit({
      toolCallId: "tool-a",
      toolName: "shell",
      kind: "stdout_line",
      line: `line-${String(index)}`
    });
  }
  const firstDrain = sink.drain();
  assert.equal(firstDrain.length, TOOL_PROGRESS_MAX_PER_TOOL_CALL);
  assert.equal(firstDrain[0]?.seq, 1);
  assert.equal(firstDrain.at(-1)?.seq, TOOL_PROGRESS_MAX_PER_TOOL_CALL);

  for (let index = 0; index < TOOL_PROGRESS_MAX_PER_TURN; index += 1) {
    sink.emit({
      toolCallId: `tool-${String(index)}`,
      toolName: "shell",
      kind: "stdout_line",
      line: "x"
    });
  }
  const turnDrain = sink.drain();
  assert.equal(turnDrain.length, TOOL_PROGRESS_MAX_PER_TURN - TOOL_PROGRESS_MAX_PER_TOOL_CALL);
});

test("trackSandboxPoll emits bounded stdout/stderr progress", () => {
  const sink = createTurnToolProgressSink({
    requestId: "req-2",
    sessionId: "sess-2"
  });
  sink.trackSandboxPoll({
    toolCallId: "tool-shell",
    toolName: "shell",
    job: {
      jobId: "job-1",
      status: "running",
      toolCode: "shell",
      reason: null,
      warning: null,
      violationCode: null,
      violationMessage: null,
      exitCode: null,
      stdout: "Collecting\n",
      stderr: null,
      content: null,
      files: []
    }
  });
  sink.trackSandboxPoll({
    toolCallId: "tool-shell",
    toolName: "shell",
    job: {
      jobId: "job-1",
      status: "running",
      toolCode: "shell",
      reason: null,
      warning: null,
      violationCode: null,
      violationMessage: null,
      exitCode: null,
      stdout: "Collecting\nDownloading pkg\n",
      stderr: "warn: slow\n",
      content: null,
      files: []
    }
  });
  const events = sink.drain();
  assert.equal(events.length, 3);
  assert.equal(events[0]?.kind, "stdout_line");
  assert.equal(events[0]?.line, "Collecting");
  assert.equal(events[1]?.kind, "stdout_line");
  assert.equal(events[1]?.line, "Downloading pkg");
  assert.equal(events[2]?.kind, "stderr_line");
  assert.equal(events[2]?.line, "warn: slow");
});

test("browser_step progress respects step char cap", () => {
  const sink = createTurnToolProgressSink({
    requestId: "req-3",
    sessionId: "sess-3"
  });
  const longStep = "navigate ".concat("y".repeat(TOOL_PROGRESS_STEP_MAX_CHARS + 10));
  sink.emit({
    toolCallId: "tool-browser",
    toolName: "browser",
    kind: "browser_step",
    step: truncateToolProgressLine(longStep, TOOL_PROGRESS_STEP_MAX_CHARS)
  });
  const [event] = sink.drain();
  assert.equal(event?.kind, "browser_step");
  assert.equal(event?.step?.length, TOOL_PROGRESS_STEP_MAX_CHARS);
});
