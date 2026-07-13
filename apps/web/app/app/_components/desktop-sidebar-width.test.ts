import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX,
  DESKTOP_SIDEBAR_WIDTH_MAX_PX,
  DESKTOP_SIDEBAR_WIDTH_MIN_PX,
  DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX,
  clampDesktopSidebarWidthPx,
  defaultDesktopSidebarWidthForViewport
} from "./desktop-sidebar-width";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop-sidebar-width", () => {
  it("clamps to the tablet→2×desktop range", () => {
    expect(clampDesktopSidebarWidthPx(100)).toBe(DESKTOP_SIDEBAR_WIDTH_MIN_PX);
    expect(clampDesktopSidebarWidthPx(999)).toBe(DESKTOP_SIDEBAR_WIDTH_MAX_PX);
    expect(clampDesktopSidebarWidthPx(280)).toBe(280);
    expect(clampDesktopSidebarWidthPx(Number.NaN)).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX);
  });

  it("uses 240–560 bounds (tablet min, 280×2 max)", () => {
    expect(DESKTOP_SIDEBAR_WIDTH_MIN_PX).toBe(240);
    expect(DESKTOP_SIDEBAR_WIDTH_MAX_PX).toBe(560);
    expect(DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX).toBe(240);
    expect(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX).toBe(280);
  });

  it("defaults to 240 below lg and 280 at lg+", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    );
    expect(defaultDesktopSidebarWidthForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX);

    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    );
    expect(defaultDesktopSidebarWidthForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX);
  });
});
