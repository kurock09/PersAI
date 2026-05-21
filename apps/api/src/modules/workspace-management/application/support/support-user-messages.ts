import type { SupportedLocale } from "@persai/types";

/** Stable marker stored in DB; UI translates via next-intl. */
export const SUPPORT_SYSTEM_MESSAGE_CODE_PENDING = "[[code:pending]]";

export function isSupportSystemMessageCode(
  body: string,
  code: typeof SUPPORT_SYSTEM_MESSAGE_CODE_PENDING
): boolean {
  return body.trim() === code;
}

export function supportPushReplyMessage(locale: SupportedLocale, ticketShortId: string): string {
  if (locale === "en") {
    return `Support replied to ticket #${ticketShortId}. Open assistant settings to read the full answer.`;
  }
  return `Поддержка ответила по обращению #${ticketShortId}. Откройте настройки ассистента, чтобы прочитать ответ.`;
}
