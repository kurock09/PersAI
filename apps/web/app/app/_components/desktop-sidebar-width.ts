/** Shared floor for tablet + desktop sidebar. */
export const DESKTOP_SIDEBAR_WIDTH_MIN_PX = 240;
/** Narrow / `md` max — clamp stored width down when the viewport shrinks. */
export const DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX = 300;
/** Wide / `lg+` max. */
export const DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX = 500;
/** Alias of the wide ceiling (resize aria / callers that need a static upper bound). */
export const DESKTOP_SIDEBAR_WIDTH_MAX_PX = DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX;
/** Default at `md` / tablet-sized two-pane shell. */
export const DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX = 250;
/** Default at `lg` and above. */
export const DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX = 320;
/** Tailwind `lg` breakpoint — matches prior sidebar width switch. */
export const DESKTOP_SIDEBAR_LG_MIN_WIDTH_QUERY = "(min-width: 1024px)";

export const DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY = "persai.desktopSidebarWidthPx";

export function isDesktopSidebarLgViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia(DESKTOP_SIDEBAR_LG_MIN_WIDTH_QUERY).matches;
}

export function desktopSidebarWidthMaxForViewport(): number {
  return isDesktopSidebarLgViewport()
    ? DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX
    : DESKTOP_SIDEBAR_WIDTH_TABLET_MAX_PX;
}

export function clampDesktopSidebarWidthPx(
  widthPx: number,
  fallbackPx: number = DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX,
  maxPx: number = desktopSidebarWidthMaxForViewport()
): number {
  const candidate = Number.isFinite(widthPx) ? widthPx : fallbackPx;
  const safe = Number.isFinite(candidate) ? candidate : DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX;
  const max = Number.isFinite(maxPx) ? maxPx : DESKTOP_SIDEBAR_WIDTH_DESKTOP_MAX_PX;
  return Math.min(max, Math.max(DESKTOP_SIDEBAR_WIDTH_MIN_PX, Math.round(safe)));
}

export function defaultDesktopSidebarWidthForViewport(): number {
  return isDesktopSidebarLgViewport()
    ? DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX
    : DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX;
}

/** Stored custom width, or `null` when the user has not resized yet. */
export function readStoredDesktopSidebarWidthPx(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    return clampDesktopSidebarWidthPx(Number(raw), defaultDesktopSidebarWidthForViewport());
  } catch {
    return null;
  }
}

export function writeStoredDesktopSidebarWidthPx(widthPx: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampDesktopSidebarWidthPx(widthPx, defaultDesktopSidebarWidthForViewport()))
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}
