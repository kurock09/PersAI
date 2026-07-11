import { describe, expect, it } from "vitest";
import { bypassesNativeBrowserExecutionQueue } from "./browser-bridge-client";

describe("native browser command scheduling", () => {
  it("keeps view lifecycle commands responsive during page execution", () => {
    expect(bypassesNativeBrowserExecutionQueue("open_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("close_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("check_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("set_observer_lock")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("snapshot")).toBe(false);
    expect(bypassesNativeBrowserExecutionQueue("act")).toBe(false);
  });
});
