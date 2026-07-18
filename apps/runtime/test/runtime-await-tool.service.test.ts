import assert from "node:assert/strict";
import {
  RuntimeAwaitToolService,
  type RuntimeAwaitClock
} from "../src/modules/turns/runtime-await-tool.service";
import {
  AsyncJobStatusDeadlineExceededError,
  type PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";

const base = {
  assistantId: "a",
  workspaceId: "w",
  chatId: "c",
  channel: "web" as const,
  threadKey: "t"
};
const ref = `jr1.media.${"A".repeat(32)}`;

export async function runRuntimeAwaitToolServiceTest(): Promise<void> {
  const terminal = {
    found: true as const,
    jobRef: ref,
    kind: "media" as const,
    status: "completed" as const,
    terminal: true,
    errorCode: null,
    message: "Job completed and was delivered.",
    narrationOutcome: "claimed_current_turn" as const,
    narrationOwner: "current_turn" as const
  };
  const pending = {
    found: true as const,
    jobRef: ref,
    kind: "media" as const,
    status: "pending" as const,
    terminal: false,
    errorCode: null,
    message: null,
    narrationOutcome: null,
    narrationOwner: null
  };
  {
    const { service } = makeService(
      async () => pending,
      undefined,
      async () => ({
        outcome: "subscribed",
        continuationClientTurnId: "async-cont:1",
        duplicate: false
      })
    );
    const result = await executeArguments(service, { action: "notify", jobRef: ref });
    assert.equal(result.payload.action, "notified");
    assert.equal(result.payload.turnControl, "continue");
    assert.equal(result.payload.staticAssistantText, null);
  }
  {
    const { service } = makeService(
      async () => pending,
      undefined,
      async () => ({
        outcome: "terminal_inline",
        kind: "media",
        status: "completed",
        errorCode: null,
        message: "Job completed and was delivered."
      })
    );
    const result = await executeArguments(service, { action: "notify", jobRef: ref });
    assert.equal(result.payload.action, "terminal_inline");
    assert.equal(result.payload.turnControl, "continue");
  }
  {
    const { service } = makeService(async () => terminal);
    for (const argumentsValue of [
      { jobRef: ref },
      { action: "wait", jobRef: ref, timeoutMs: 1.5 },
      { action: "wait", jobRef: ref, timeoutMs: -1 },
      { action: "wait", jobRef: ref, timeoutMs: Number.NaN },
      { action: "wait", jobRef: ref, timeoutMs: "10" }
    ]) {
      const result = await executeArguments(service, argumentsValue);
      assert.equal(result.payload.reason, "invalid_arguments");
      assert.equal(result.isError, true);
    }
  }
  {
    let calls = 0;
    const { service } = makeService(async () => {
      calls += 1;
      return terminal;
    });
    const result = await execute(service, 60_000);
    assert.equal(result.payload.status, "completed");
    assert.equal(calls, 1, "early terminal must not block or poll");
  }
  {
    const { service } = makeService(async () => pending);
    const result = await execute(service, 0);
    assert.equal(result.payload.action, "status");
    assert.equal(result.payload.status, "pending");
  }
  {
    let calls = 0;
    const { service } = makeService(async () => (++calls === 1 ? pending : terminal));
    const result = await execute(service, 1);
    assert.equal(
      result.payload.status,
      "completed",
      "deadline boundary performs the final canonical read"
    );
    assert.equal(calls, 2);
  }
  {
    const waits = new Set<string>();
    const { service } = makeService(async () => pending);
    const first = await execute(service, 1, waits);
    assert.equal(first.payload.status, "pending");
    const second = await execute(service, 1, waits);
    assert.equal(second.payload.status, "pending");
    const statusOnly = await execute(service, 0, waits);
    assert.equal(statusOnly.payload.status, "pending");
  }
  {
    const { service } = makeService(async () => terminal);
    const result = await execute(service, 60_001);
    assert.equal(result.payload.reason, "invalid_arguments");
  }
  {
    let statusCalls = 0;
    const { service } = makeService(
      async () => {
        statusCalls += 1;
        return pending;
      },
      undefined,
      undefined,
      async () => ({ outcome: "snapshot", jobs: [{ ...pending, sandboxResult: null }] })
    );
    const result = await executeArguments(service, { action: "wait", timeoutMs: 0 });
    assert.equal(result.payload.jobs?.length, 1);
    assert.equal(statusCalls, 0);
  }
  {
    let snapshotCalls = 0;
    const clock = createClock();
    const { service } = makeService(
      async () => pending,
      clock,
      undefined,
      async () => {
        snapshotCalls += 1;
        return { outcome: "snapshot", jobs: [] };
      }
    );
    const result = await executeArguments(service, { action: "wait", timeoutMs: 60_000 });
    assert.equal(result.payload.action, "status");
    assert.equal(result.payload.jobs?.length, 0);
    assert.equal(snapshotCalls, 1, "empty snapshot must return immediately without polling");
    assert.equal(clock.current, 0, "empty snapshot must not delay");
  }
  {
    let snapshotCalls = 0;
    const clock = createClock();
    const { service } = makeService(
      async () => pending,
      clock,
      undefined,
      async () => {
        snapshotCalls += 1;
        return {
          outcome: "snapshot",
          jobs: [{ ...terminal, sandboxResult: null }]
        };
      }
    );
    const result = await executeArguments(service, { action: "wait", timeoutMs: 60_000 });
    assert.equal(result.payload.action, "status");
    assert.equal(result.payload.terminal, true);
    assert.equal(snapshotCalls, 1, "already-terminal snapshot must not poll");
    assert.equal(clock.current, 0);
  }
  {
    const { service } = makeService(async () => ({
      ...terminal,
      narrationOutcome: "already_owned" as const,
      narrationOwner: "continuation" as const
    }));
    const result = await execute(service, 0);
    assert.equal(result.payload.turnControl, "continue");
    assert.equal(result.payload.staticAssistantText, null);
  }
  {
    const { service } = makeService(async () => ({
      ...terminal,
      narrationOutcome: "already_owned" as const,
      narrationOwner: "legacy" as const
    }));
    const result = await execute(service, 0);
    assert.equal(result.payload.turnControl, "terminal_static");
  }
  {
    const admitted = new Set<string>();
    const { service } = makeService(async () => pending);
    for (let index = 0; index < 20; index += 1) {
      const result = await service.executeToolCall({
        ...base,
        sourceClientTurnId: "turn",
        toolCall: {
          id: `wait-${String(index)}`,
          name: "await",
          arguments: { action: "wait", jobRef: ref, timeoutMs: 0 }
        },
        admittedWaitToolCallIds: admitted
      });
      assert.notEqual(result.payload.reason, "wait_budget_exhausted");
    }
    const blocked = await service.executeToolCall({
      ...base,
      sourceClientTurnId: "turn",
      toolCall: {
        id: "wait-21",
        name: "await",
        arguments: { action: "wait", jobRef: ref, timeoutMs: 0 }
      },
      admittedWaitToolCallIds: admitted
    });
    assert.equal(blocked.payload.reason, "wait_budget_exhausted");
  }
  {
    for (const status of ["failed", "cancelled"] as const) {
      const { service } = makeService(async () => ({
        ...terminal,
        status,
        terminal: true,
        errorCode: status === "failed" ? "provider_failed" : null
      }));
      assert.equal((await execute(service, 10)).payload.status, status);
    }
  }
  {
    const { service } = makeService(async () => ({
      found: false as const,
      code: "job_not_found" as const
    }));
    assert.equal((await execute(service, 0)).payload.reason, "job_not_found");
  }
  {
    const controller = new AbortController();
    const clock = createClock();
    clock.delay = (_ms, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true
        });
      });
    const { service } = makeService(async () => pending, clock);
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(() => execute(service, 60_000, new Set(), controller.signal), /Abort/);
  }
  {
    const controller = new AbortController();
    controller.abort();
    const { service } = makeService(async (input) => {
      if (input.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      return pending;
    });
    await assert.rejects(
      () => execute(service, 60_000, new Set(), controller.signal),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError"
    );
  }
  {
    const clock = createClock();
    const { service } = makeService(async (input) => {
      assert.equal(input.timeoutMs, 60_000);
      clock.current = 60_000;
      throw new AsyncJobStatusDeadlineExceededError();
    }, clock);
    const result = await execute(service, 60_000);
    assert.equal(result.payload.reason, "wait_deadline_expired_before_status");
    assert.equal(result.payload.kind, null);
    assert.equal(result.payload.status, null);
    assert.equal(clock.current, 60_000);
  }
  {
    const clock = createClock();
    let calls = 0;
    const { service } = makeService(async (input) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(input.timeoutMs, 500);
        return pending;
      }
      assert.equal(input.timeoutMs, 1);
      clock.current += 1;
      throw new AsyncJobStatusDeadlineExceededError();
    }, clock);
    const result = await execute(service, 500);
    assert.equal(result.payload.status, "pending");
    assert.equal(clock.current, 500);
    assert.equal(calls, 2);
  }
}

function makeService(
  resolveAsyncJobStatus: PersaiInternalApiClientService["resolveAsyncJobStatus"],
  clock = createClock(),
  subscribeAsyncJob: PersaiInternalApiClientService["subscribeAsyncJob"] = async () => ({
    outcome: "not_found"
  }),
  resolveAsyncJobSnapshot: PersaiInternalApiClientService["resolveAsyncJobSnapshot"] = async () => ({
    outcome: "snapshot",
    jobs: []
  })
) {
  return {
    service: new RuntimeAwaitToolService(
      {
        resolveAsyncJobStatus,
        subscribeAsyncJob,
        resolveAsyncJobSnapshot
      } as PersaiInternalApiClientService,
      clock
    ),
    clock
  };
}

function createClock(): RuntimeAwaitClock & { current: number } {
  return {
    current: 0,
    now() {
      return this.current;
    },
    async delay(ms: number, signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      this.current += ms;
    }
  };
}

function execute(
  service: RuntimeAwaitToolService,
  timeoutMs: number,
  blockingWaitedJobRefs = new Set<string>(),
  abortSignal?: AbortSignal
) {
  return service.executeToolCall({
    ...base,
    toolCall: { id: "call", name: "await", arguments: { action: "wait", jobRef: ref, timeoutMs } },
    blockingWaitedJobRefs,
    ...(abortSignal === undefined ? {} : { abortSignal })
  });
}

function executeArguments(
  service: RuntimeAwaitToolService,
  argumentsValue: Record<string, unknown>
) {
  return service.executeToolCall({
    ...base,
    toolCall: { id: "call", name: "await", arguments: argumentsValue },
    blockingWaitedJobRefs: new Set<string>()
  });
}
