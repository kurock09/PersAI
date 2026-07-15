import { describe, expect, it } from "vitest";
import {
  clampDesktopSlideOverWidthPx,
  defaultDesktopSlideOverWidthPx,
  DESKTOP_SLIDE_OVER_WIDTH_DEFAULT_PX,
  DESKTOP_SLIDE_OVER_WIDTH_MAX_PX,
  DESKTOP_SLIDE_OVER_WIDTH_MIN_PX,
  DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX
} from "./desktop-slide-over-width";

describe("desktop-slide-over-width", () => {
  it("keeps the previous narrow/default lg ceilings as defaults and clamps 500–800", () => {
    expect(DESKTOP_SLIDE_OVER_WIDTH_MIN_PX).toBe(500);
    expect(DESKTOP_SLIDE_OVER_WIDTH_MAX_PX).toBe(800);
    expect(DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX).toBe(600);
    expect(DESKTOP_SLIDE_OVER_WIDTH_DEFAULT_PX).toBe(680);
    expect(defaultDesktopSlideOverWidthPx("narrow")).toBe(600);
    expect(defaultDesktopSlideOverWidthPx("default")).toBe(680);
    expect(clampDesktopSlideOverWidthPx(100)).toBe(500);
    expect(clampDesktopSlideOverWidthPx(999)).toBe(800);
    expect(clampDesktopSlideOverWidthPx(Number.NaN)).toBe(600);
  });
});
