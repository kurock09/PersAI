/** Desktop slide-over (Settings / Telegram / Knowledge) width bounds. */
export const DESKTOP_SLIDE_OVER_WIDTH_MIN_PX = 500;
export const DESKTOP_SLIDE_OVER_WIDTH_MAX_PX = 800;

/**
 * Defaults match the previous Tailwind ceilings for the common `narrow` size
 * (`lg:max-w-[600px]`) and the unused `default` size (`lg:max-w-[680px]`).
 */
export const DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX = 600;
export const DESKTOP_SLIDE_OVER_WIDTH_DEFAULT_PX = 680;

export function clampDesktopSlideOverWidthPx(
  widthPx: number,
  fallbackPx: number = DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX
): number {
  const candidate = Number.isFinite(widthPx) ? widthPx : fallbackPx;
  const safe = Number.isFinite(candidate) ? candidate : DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX;
  return Math.min(
    DESKTOP_SLIDE_OVER_WIDTH_MAX_PX,
    Math.max(DESKTOP_SLIDE_OVER_WIDTH_MIN_PX, Math.round(safe))
  );
}

export function defaultDesktopSlideOverWidthPx(size: "default" | "narrow"): number {
  return size === "narrow"
    ? DESKTOP_SLIDE_OVER_WIDTH_NARROW_DEFAULT_PX
    : DESKTOP_SLIDE_OVER_WIDTH_DEFAULT_PX;
}
