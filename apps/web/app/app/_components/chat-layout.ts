/** Assistant row avatar (`AssistantAvatar` size `sm` = `h-7 w-7`). */
export const CHAT_ASSISTANT_AVATAR_SIZE_PX = 28;
/** Matches Tailwind `max-w-[50rem]` chat column. */
export const CHAT_CONTENT_MAX_WIDTH_PX = 50 * 16;
/** Composer/header chrome padding below the `md` shell breakpoint. */
export const CHAT_CHROME_PADDING_MOBILE_PX = 12;
/** Composer/header chrome padding from the `md` shell breakpoint upward. */
export const CHAT_CHROME_PADDING_DESKTOP_PX = 16;

/**
 * Avatars sit in the left gutter outside the text/pill column. Show them only
 * when the distance from the input-pill left edge to the chat stage wall is
 * strictly greater than two avatar widths.
 */
export function shouldShowChatAssistantAvatars(args: {
  stageWidthPx: number;
  chromePaddingPx: number;
  contentMaxWidthPx?: number;
  avatarSizePx?: number;
}): boolean {
  const contentMaxWidthPx = args.contentMaxWidthPx ?? CHAT_CONTENT_MAX_WIDTH_PX;
  const avatarSizePx = args.avatarSizePx ?? CHAT_ASSISTANT_AVATAR_SIZE_PX;
  const innerAvailable = Math.max(0, args.stageWidthPx - args.chromePaddingPx * 2);
  const columnWidth = Math.min(innerAvailable, contentMaxWidthPx);
  const columnSideGap = (innerAvailable - columnWidth) / 2;
  const pillEdgeToWallPx = args.chromePaddingPx + columnSideGap;
  return pillEdgeToWallPx > avatarSizePx * 2;
}
