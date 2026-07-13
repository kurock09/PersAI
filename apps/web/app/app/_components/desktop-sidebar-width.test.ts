import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX,
  DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX,
  DESKTOP_SIDEBAR_WIDTH_MIN_PX,
  DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX,
  DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX,
  clampDesktopSidebarWidthPx,
  defaultDesktopSidebarWidthForViewport,
  desktopSidebarWidthMaxForViewport
} from "./desktop-sidebar-width";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMatchMedia(matchesLg: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matchesLg && query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  );
}

describe("desktop-sidebar-width", () => {
  it("clamps with the active viewport max", () => {
    stubMatchMedia(true);
    expect(clampDesktopSidebarWidthPx(100)).toBe(DESKTOP_SIDEBAR_WIDTH_MIN_PX);
    expect(clampDesktopSidebarWidthPx(999)).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX);
    expect(clampDesktopSidebarWidthPx(320)).toBe(320);
    expect(clampDesktopSidebarWidthPx(Number.NaN)).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX);

    stubMatchMedia(false);
    expect(clampDesktopSidebarWidthPx(999)).toBe(DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX);
    expect(clampDesktopSidebarWidthPx(280)).toBe(280);
  });

  it("uses 240–300 on tablet and 240–500 on desktop, with 250/320 defaults", () => {
    expect(DESKTOP_SIDEBAR_WIDTH_MIN_PX).toBe(240);
    expect(DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX).toBe(300);
    expect(DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX).toBe(500);
    expect(DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX).toBe(250);
    expect(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX).toBe(320);
  });

  it("defaults to 250 below lg and 320 at lg+", () => {
    stubMatchMedia(true);
    expect(defaultDesktopSidebarWidthForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX);
    expect(desktopSidebarWidthMaxForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX);

    stubMatchMedia(false);
    expect(defaultDesktopSidebarWidthForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX);
    expect(desktopSidebarWidthMaxForViewport()).toBe(DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX);
  });
});
