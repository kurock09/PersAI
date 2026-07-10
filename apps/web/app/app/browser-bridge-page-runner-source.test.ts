import { describe, expect, it } from "vitest";
import { PAGE_RUNNER_SOURCE } from "./browser-bridge-page-runner-source";

describe("PAGE_RUNNER_SOURCE", () => {
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
});
