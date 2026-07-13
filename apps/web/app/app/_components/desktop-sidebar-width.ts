/** Tablet / medium-window sidebar (ADR-144). */
export const DESKTOP_SIDEBAR_WIDTH_MIN_PX = 240;
/** Current large-desktop sidebar (280) × 2. */
export const DESKTOP_SIDEBAR_WIDTH_MAX_PX = 560;
/** Default at `md` / tablet-sized two-pane shell (was `md:w-[240px]`). */
export const DESKTOP_SIDEBAR_WIDTH_TABLET_DEFAULT_PX = 240;
/** Default at `lg` and above (was `lg:w-[280px]`). */
export const DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX = 280;
/** Tailwind `lg` breakpoint — matches prior sidebar width switch. */
export const DESKTOP_SIDEBAR_LG_MIN_WIDTH_QUERY = "(min-width: 1024px)";

export const DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY = "persai.desktopSidebarWidthPx";

export function clampDesktopSidebarWidthPx(
  widthPx: number,
  fallbackPx: number = DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX
): number {
  const candidate = Number.isFinite(widthPx) ? widthPx : fallbackPx;
  const safe = Number.isFinite(candidate) ? candidate : DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX;
  return Math.min(
    DESKTOP_SIDEBAR_WIDTH_MAX_PX,
    Math.max(DESKTOP_SIDEBAR_WIDTH_MIN_PX, Math.round(safe))
  );
}

export function defaultDesktopSidebarWidthForViewport(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX;
  }
  return window.matchMedia(DESKTOP_SIDEBAR_LG_MIN_WIDTH_QUERY).matches
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
