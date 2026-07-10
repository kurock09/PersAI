import { describe, expect, it } from "vitest";
import { PAGE_RUNNER_SOURCE } from "./browser-bridge-page-runner-source";

describe("PAGE_RUNNER_SOURCE", () => {
  it("compiles to an async page runner", () => {
    const runner = Function(`"use strict"; return (${PAGE_RUNNER_SOURCE});`)() as unknown;

    expect(typeof runner).toBe("function");
    expect((runner as { constructor: { name: string } }).constructor.name).toBe("AsyncFunction");
  });
});
