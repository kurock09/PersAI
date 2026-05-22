import type { SupportedLocale } from "@persai/types";

/** Stable marker stored in DB; UI translates via next-intl. */
export const SUPPORT_SYSTEM_MESSAGE_CODE_PENDING = "[[code:pending]]";

const PUSH_REPLY_EXCERPT_MAX = 220;

export function isSupportSystemMessageCode(
  body: string,
  code: typeof SUPPORT_SYSTEM_MESSAGE_CODE_PENDING
): boolean {
  return body.trim() === code;
}

export function truncateSupportNotificationExcerpt(
  text: string,
  max = PUSH_REPLY_EXCERPT_MAX
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function supportPushReplyMessage(
  locale: SupportedLocale,
  ticketShortId: string,
  replyBody?: string
): string {
  const excerpt =
    typeof replyBody === "string" && replyBody.trim().length > 0
      ? truncateSupportNotificationExcerpt(replyBody)
      : "";

  if (locale === "en") {
    if (excerpt.length > 0) {
      return `Support · #${ticketShortId}: ${excerpt}`;
    }
    return `Support replied to ticket #${ticketShortId}. Open assistant settings → Support.`;
  }

  if (excerpt.length > 0) {
    return `Поддержка · #${ticketShortId}: ${excerpt}`;
  }
  return `Поддержка ответила по обращению #${ticketShortId}. Откройте настройки ассистента → «Поддержка».`;
}
