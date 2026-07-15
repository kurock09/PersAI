import type { RuntimeSandboxJobResult, RuntimeToolProgressEvent } from "@persai/runtime-contract";

export const TOOL_PROGRESS_MAX_PER_TOOL_CALL = 30;
export const TOOL_PROGRESS_MAX_PER_TURN = 60;
export const TOOL_PROGRESS_LINE_MAX_CHARS = 200;
export const TOOL_PROGRESS_STEP_MAX_CHARS = 120;

type ToolProgressKind = RuntimeToolProgressEvent["kind"];

export interface TurnToolProgressSink {
  emit(input: {
    toolCallId: string;
    toolName: string;
    kind: ToolProgressKind;
    line?: string;
    step?: string;
  }): void;
  trackSandboxPoll(input: {
    toolCallId: string;
    toolName: string;
    job: RuntimeSandboxJobResult;
  }): void;
  drain(): RuntimeToolProgressEvent[];
}

export function truncateToolProgressLine(value: string, maxChars: number): string {
  const trimmed = value.trimEnd();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return trimmed.slice(0, maxChars);
}

export function extractNewSandboxOutputLines(
  previous: string | null | undefined,
  next: string | null | undefined
): string[] {
  if (typeof next !== "string" || next.length === 0) {
    return [];
  }
  const prior = typeof previous === "string" ? previous : "";
  if (!next.startsWith(prior)) {
    return next
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  }
  const delta = next.slice(prior.length);
  if (delta.length === 0) {
    return [];
  }
  const parts = delta.split("\n");
  const completeLines = parts.slice(0, -1).map((line) => line.trimEnd());
  const tail = parts[parts.length - 1] ?? "";
  const lines = completeLines.filter((line) => line.length > 0);
  if (tail.trim().length > 0 && next.endsWith("\n")) {
    lines.push(tail.trimEnd());
  }
  return lines;
}

export function createTurnToolProgressSink(params: {
  requestId: string;
  sessionId: string;
}): TurnToolProgressSink {
  const pending: RuntimeToolProgressEvent[] = [];
  const seqByToolCallId = new Map<string, number>();
  const countByToolCallId = new Map<string, number>();
  const sandboxStdoutTail = new Map<string, string>();
  const sandboxStderrTail = new Map<string, string>();
  let turnCount = 0;

  const emit = (input: {
    toolCallId: string;
    toolName: string;
    kind: ToolProgressKind;
    line?: string;
    step?: string;
  }): void => {
    if (turnCount >= TOOL_PROGRESS_MAX_PER_TURN) {
      return;
    }
    const perToolCount = countByToolCallId.get(input.toolCallId) ?? 0;
    if (perToolCount >= TOOL_PROGRESS_MAX_PER_TOOL_CALL) {
      return;
    }

    const nextSeq = (seqByToolCallId.get(input.toolCallId) ?? 0) + 1;
    seqByToolCallId.set(input.toolCallId, nextSeq);
    countByToolCallId.set(input.toolCallId, perToolCount + 1);
    turnCount += 1;

    const line =
      input.line === undefined
        ? undefined
        : truncateToolProgressLine(input.line, TOOL_PROGRESS_LINE_MAX_CHARS);
    const step =
      input.step === undefined
        ? undefined
        : truncateToolProgressLine(input.step, TOOL_PROGRESS_STEP_MAX_CHARS);

    pending.push({
      type: "tool_progress",
      requestId: params.requestId,
      sessionId: params.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      kind: input.kind,
      ...(line === undefined ? {} : { line }),
      ...(step === undefined ? {} : { step }),
      seq: nextSeq
    });
  };

  return {
    emit,
    trackSandboxPoll: ({ toolCallId, toolName, job }) => {
      const stdoutKey = toolCallId;
      const stderrKey = toolCallId;
      for (const line of extractNewSandboxOutputLines(
        sandboxStdoutTail.get(stdoutKey),
        job.stdout
      )) {
        emit({ toolCallId, toolName, kind: "stdout_line", line });
      }
      for (const line of extractNewSandboxOutputLines(
        sandboxStderrTail.get(stderrKey),
        job.stderr
      )) {
        emit({ toolCallId, toolName, kind: "stderr_line", line });
      }
      if (typeof job.stdout === "string") {
        sandboxStdoutTail.set(stdoutKey, job.stdout);
      }
      if (typeof job.stderr === "string") {
        sandboxStderrTail.set(stderrKey, job.stderr);
      }
    },
    drain: () => {
      if (pending.length === 0) {
        return [];
      }
      const drained = pending.splice(0, pending.length);
      return drained;
    }
  };
}
