import { describe, expect, it } from "vitest";
import { bypassesNativeBrowserExecutionQueue } from "./browser-bridge-client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native browser command scheduling", () => {
  it("keeps view lifecycle commands responsive during page execution", () => {
    expect(bypassesNativeBrowserExecutionQueue("open_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("close_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("check_view")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("set_observer_lock")).toBe(true);
    expect(bypassesNativeBrowserExecutionQueue("snapshot")).toBe(false);
    expect(bypassesNativeBrowserExecutionQueue("act")).toBe(false);
  });

  it("races native executeCommand so a wedged plugin cannot hold the serial queue", () => {
    const source = readFileSync(resolve(import.meta.dirname, "browser-bridge-client.ts"), "utf8");
    expect(source).toMatch(/raceWithTimeout/);
    expect(source).toMatch(/computeNativeCommandDeadlineMs/);
    expect(source).toMatch(/MAX_NATIVE_COMMAND_WAIT_MS = 40_000/);
  });
});
