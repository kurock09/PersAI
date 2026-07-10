import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_RUNNER_SOURCE } from "./browser-bridge-page-runner-source";

class TestMutationObserver {
  static instances: TestMutationObserver[] = [];

  constructor(private readonly callback: MutationCallback) {
    TestMutationObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {}

  notify(): void {
    this.callback([], this as unknown as MutationObserver);
  }
}

describe("PAGE_RUNNER_SOURCE", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestMutationObserver.instances = [];
    document.body.replaceChildren();
  });

  it("compiles to an async page runner", () => {
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as unknown;

    expect(typeof runner).toBe("function");
    expect((runner as { constructor: { name: string } }).constructor.name).toBe("AsyncFunction");
  });

  it("hands anchor navigation back to native before clicking", () => {
    const navigationAssignment = PAGE_RUNNER_SOURCE.indexOf("requestedNavigationUrl = anchorUrl");
    const fallbackClick = PAGE_RUNNER_SOURCE.indexOf("element.click()", navigationAssignment);

    expect(navigationAssignment).toBeGreaterThanOrEqual(0);
    expect(fallbackClick).toBeGreaterThan(navigationAssignment);
    expect(PAGE_RUNNER_SOURCE).toMatch(
      /\.\.\.\(requestedNavigationUrl \? \{ navigationUrl: requestedNavigationUrl \} : \{\}\)/
    );
  });

  it("does not infer user handoffs from page text or selectors", () => {
    expect(PAGE_RUNNER_SOURCE).not.toMatch(/needsUserAction|userCheckpointRe|sensitiveControlRe/);
  });

  it("waits for a mutation-free quiet window before returning a stable snapshot", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: unknown[];
    }) => Promise<{ loadStatus: string }>;

    const result = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      operations: []
    });
    TestMutationObserver.instances[0]?.notify();

    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(749);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ loadStatus: "stable" });
  });

  it("returns partial after the bounded timeout despite continuous mutations", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: unknown[];
    }) => Promise<{ loadStatus: string }>;

    const result = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 20,
      operations: []
    });
    TestMutationObserver.instances[0]?.notify();
    await vi.advanceTimersByTimeAsync(20);

    await expect(result).resolves.toMatchObject({ loadStatus: "partial" });
  });

  it("contains no text-length or control-count readiness shortcut", () => {
    expect(PAGE_RUNNER_SOURCE).not.toMatch(/text\.length\s*>=\s*40|visibleControls/);
    expect(PAGE_RUNNER_SOURCE).toMatch(/MutationObserver/);
    expect(PAGE_RUNNER_SOURCE).toMatch(/loadStatus/);
  });
});
