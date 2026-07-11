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
    vi.restoreAllMocks();
    TestMutationObserver.instances = [];
    document.body.replaceChildren();
  });

  it("compiles to an async page runner", () => {
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as unknown;

    expect(typeof runner).toBe("function");
    expect((runner as { constructor: { name: string } }).constructor.name).toBe("AsyncFunction");
  });

  it("hands anchor navigation back to native before clicking", () => {
    expect(PAGE_RUNNER_SOURCE).toMatch(/shouldHandoffAnchorNavigation/);
    expect(PAGE_RUNNER_SOURCE).toMatch(
      /\.\.\.\(requestedNavigationUrl \? \{ navigationUrl: requestedNavigationUrl \} : \{\}\)/
    );
  });

  it("keeps same-origin anchor clicks on the native pointer path", () => {
    expect(PAGE_RUNNER_SOURCE).toMatch(/shouldHandoffAnchorNavigation/);
    expect(PAGE_RUNNER_SOURCE).toMatch(
      /new URL\(anchorUrl\)\.origin !== new URL\(window\.location\.href\)\.origin/
    );
    expect(PAGE_RUNNER_SOURCE).toMatch(/if \(shouldHandoffAnchorNavigation\(anchorUrl\)\)/);
  });

  it("hands GET form submit navigation back to native before clicking", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    document.body.innerHTML = `
      <form action="/search" method="get">
        <textarea id="text" name="text">новости России</textarea>
        <button type="submit" aria-label="Найти">Найти</button>
      </form>
    `;
    const clickSpy = vi.spyOn(HTMLButtonElement.prototype, "click");
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: Array<{ kind: string; selector: string }>;
    }) => Promise<{ navigationUrl?: string }>;

    const resultPromise = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      operations: [{ kind: "click", selector: 'button[aria-label="Найти"]' }]
    });
    await vi.advanceTimersByTimeAsync(750);
    const result = await resultPromise;

    expect(result.navigationUrl).toBeTruthy();
    const parsed = new URL(result.navigationUrl!);
    expect(parsed.pathname).toBe("/search");
    expect(parsed.searchParams.get("text")).toBe("новости России");
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("still clicks POST form submitters instead of inventing navigation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    document.body.innerHTML = `
      <form action="/checkout" method="post">
        <button type="submit" id="pay">Pay</button>
      </form>
    `;
    const clickSpy = vi
      .spyOn(HTMLButtonElement.prototype, "click")
      .mockImplementation(() => undefined);
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: Array<{ kind: string; selector: string }>;
    }) => Promise<{ navigationUrl?: string }>;

    const resultPromise = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      operations: [{ kind: "click", selector: "#pay" }]
    });
    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result.navigationUrl).toBeUndefined();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("hands Enter in GET search forms back to native before synthesizing key events", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    document.body.innerHTML = `
      <form action="/search" method="get">
        <input id="q" name="text" value="бриошь" />
      </form>
    `;
    const field = document.getElementById("q");
    field?.focus();
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: Array<{ kind: string; key: string }>;
    }) => Promise<{ navigationUrl?: string }>;

    const resultPromise = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      operations: [{ kind: "press", key: "Enter" }]
    });
    await vi.advanceTimersByTimeAsync(750);
    const result = await resultPromise;

    expect(result.navigationUrl).toBeTruthy();
    const parsed = new URL(result.navigationUrl!);
    expect(parsed.pathname).toBe("/search");
    expect(parsed.searchParams.get("text")).toBe("бриошь");
  });

  it("uses native pointer tap when nativePointer is enabled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    vi.stubGlobal("webkit", undefined);
    document.body.innerHTML = `<button id="add">Add</button>`;
    const requestPointerTap = vi.fn();
    (
      window as Window & {
        PersaiBrowserBridgeNative?: { requestPointerTap: typeof requestPointerTap };
      }
    ).PersaiBrowserBridgeNative = { requestPointerTap };
    const clickSpy = vi.spyOn(HTMLButtonElement.prototype, "click");
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      nativePointer: boolean;
      operations: Array<{ kind: string; selector: string }>;
    }) => Promise<unknown>;

    const resultPromise = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      nativePointer: true,
      operations: [{ kind: "click", selector: "#add" }]
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(requestPointerTap).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
    delete (window as Window & { PersaiBrowserBridgeNative?: unknown }).PersaiBrowserBridgeNative;
    clickSpy.mockRestore();
  });

  it("does not infer user handoffs from page text or selectors", () => {
    expect(PAGE_RUNNER_SOURCE).not.toMatch(/needsUserAction|userCheckpointRe|sensitiveControlRe/);
  });

  it("notifies the optional native preview hook after every operation and DOM capture", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    const previewStep = vi.fn();
    vi.stubGlobal("__persaiBrowserPreviewStep", previewStep);
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as (input: {
      maxChars: number;
      maxElements: number;
      maxExtractItems: number;
      settleAfterMutationMs: number;
      domReadyTimeoutMs: number;
      operations: unknown[];
    }) => Promise<unknown>;

    const result = runner({
      maxChars: 1_000,
      maxElements: 10,
      maxExtractItems: 10,
      settleAfterMutationMs: 0,
      domReadyTimeoutMs: 1_000,
      operations: [
        { kind: "extract", selector: "body", maxItems: 1 },
        { kind: "extract", selector: "body", maxItems: 1 }
      ]
    });
    await vi.advanceTimersByTimeAsync(750);
    await result;

    expect(previewStep).toHaveBeenCalledTimes(3);
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
