import { describe, expect, it, vi } from "vitest";
import { consumeBackPress, pushBackHandler } from "./back-handler-stack";

describe("back-handler-stack", () => {
  it("prefers a native browser overlay over later low-priority surfaces", () => {
    const settingsHandler = vi.fn();
    const browserHandler = vi.fn();
    const lateSurfaceHandler = vi.fn();
    const removeSettings = pushBackHandler(settingsHandler);
    const removeBrowser = pushBackHandler(browserHandler, { priority: 100 });
    const removeLateSurface = pushBackHandler(lateSurfaceHandler);

    expect(consumeBackPress()).toBe(true);
    expect(browserHandler).toHaveBeenCalledTimes(1);
    expect(settingsHandler).not.toHaveBeenCalled();
    expect(lateSurfaceHandler).not.toHaveBeenCalled();

    removeLateSurface();
    removeBrowser();
    removeSettings();
  });
});
