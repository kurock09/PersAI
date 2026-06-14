import type { SupportedLocale } from "@persai/types";

type LocalizedCopy = Record<SupportedLocale, string>;

function copy(ru: string, en: string): LocalizedCopy {
  return { ru, en };
}

const MESSENGER_SURFACE_ERRORS: Record<string, LocalizedCopy> = {
  assistant_not_live: copy(
    "Ассистент ещё не опубликован. Сначала опубликуйте или примените последнюю версию.",
    "Assistant is not live yet. Please publish or apply the latest version first."
  ),
  assistant_activating: copy(
    "Настройки ассистента ещё применяются. Подождите немного и попробуйте снова.",
    "Assistant settings are still activating. Please wait a moment and try again."
  ),
  assistant_activation_failed: copy(
    "Не удалось применить настройки ассистента. Повторите rollout в Admin > Rollouts и попробуйте снова.",
    "Assistant settings activation failed. Retry the rollout from Admin > Rollouts, then try again."
  ),
  plan_feature_unavailable: copy(
    "Этот канал недоступен на текущем тарифе.",
    "This channel is not available on the current plan."
  ),
  chat_message_limit_reached: copy(
    "В этом чате достигнут лимит сообщений. Продолжите в новом чате или смените тариф.",
    "This chat has reached its message limit. Please continue in a new chat or upgrade the plan."
  ),
  rate_limited: copy(
    "Сейчас слишком много запросов. Попробуйте снова через минуту.",
    "Requests are temporarily limited right now. Please try again in a moment."
  ),
  runtime_timeout: copy(
    "Ассистент слишком долго отвечал. Попробуйте ещё раз.",
    "The assistant took too long to respond. Please try again."
  ),
  native_runtime_conflict: copy(
    "Предыдущий ответ ещё формируется. Подождите немного и попробуйте снова.",
    "One previous response is still finishing. Please wait a moment and try again."
  ),
  runtime_degraded: copy(
    "Ассистент временно недоступен. Попробуйте ещё раз.",
    "Assistant is temporarily unavailable. Please try again."
  ),
  runtime_unreachable: copy(
    "Ассистент временно недоступен. Попробуйте ещё раз.",
    "Assistant is temporarily unavailable. Please try again."
  ),
  runtime_auth_failure: copy(
    "Ассистент временно недоступен. Попробуйте ещё раз.",
    "Assistant is temporarily unavailable. Please try again."
  ),
  runtime_invalid_response: copy(
    "Ассистент временно недоступен. Попробуйте ещё раз.",
    "Assistant is temporarily unavailable. Please try again."
  ),
  assistant_turn_failed: copy(
    "Ассистент временно недоступен. Попробуйте ещё раз.",
    "Assistant is temporarily unavailable. Please try again."
  ),
  safety_restricted: copy(
    "Отправка сообщений временно ограничена.\n\nPersAI ограничил доступ к чату после автоматической проверки безопасности.\n\nПока ограничение активно, новые сообщения отправить нельзя. Если считаешь, что это ошибка, напиши в поддержку.",
    "Sending messages is temporarily restricted.\n\nPersAI restricted chat access after an automatic safety review.\n\nYou cannot send new messages while this restriction is active. If you think this is a mistake, contact support."
  )
};

const SAFETY_RESTRICTED_MESSENGER_BODY_COPY: Record<string, LocalizedCopy> = {
  default: copy(
    "PersAI ограничил доступ к чату после автоматической проверки безопасности.",
    "PersAI restricted chat access after an automatic safety review."
  ),
  hack_abuse: copy(
    "Доступ ограничен: в сообщении был запрос, связанный со взломом, кражей данных или другим злоупотреблением.",
    "Access is restricted because a message looked like hacking, credential theft, or another abuse request."
  ),
  violence_extremism: copy(
    "Доступ ограничен: в сообщении был контент, связанный с насилием или экстремизмом.",
    "Access is restricted because a message involved violence or extremism."
  ),
  unsolicited_adult_spam: copy(
    "Доступ ограничен: в сообщении был нежелательный взрослый или спам-контент.",
    "Access is restricted because a message involved unwanted adult or spam content."
  ),
  structural_abuse_signal: copy(
    "Доступ ограничен: сообщение выглядело как злоупотребление форматом (пустое, только ссылка и т.п.).",
    "Access is restricted because the message looked like format abuse (empty, link-only, and similar)."
  )
};

const SAFETY_RESTRICTED_MESSENGER_DETAIL_COPY = copy(
  "Пока ограничение активно, новые сообщения отправить нельзя. Если считаешь, что это ошибка, напиши в поддержку.",
  "You cannot send new messages while this restriction is active. If you think this is a mistake, contact support."
);

const SAFETY_RESTRICTED_MESSENGER_TITLE_COPY = copy(
  "Отправка сообщений временно ограничена.",
  "Sending messages is temporarily restricted."
);

const SAFETY_INBOUND_WARN_MESSENGER_BODY_COPY: Record<string, LocalizedCopy> = {
  default: copy(
    "Мы заметили рискованный запрос при автоматической проверке безопасности.",
    "We noticed a risky request during an automatic safety review."
  ),
  hack_abuse: copy(
    "Запрос похож на попытку злоупотребления: взлом, кража данных или другое злоупотребление.",
    "This request looked like hacking, credential theft, or another abuse attempt."
  ),
  violence_extremism: copy(
    "Запрос связан с насилием или экстремизмом.",
    "This request involved violence or extremism."
  ),
  unsolicited_adult_spam: copy(
    "Запрос связан с нежелательным взрослым или спам-контентом.",
    "This request involved unwanted adult or spam content."
  ),
  structural_abuse_signal: copy(
    "Сообщение выглядело как злоупотребление форматом (пустое, только ссылка и т.п.).",
    "This message looked like format abuse (empty, link-only, and similar)."
  )
};

const SAFETY_INBOUND_WARN_MESSENGER_DETAIL_COPY = copy(
  "Пока можно продолжать чат. Повторные похожие сообщения могут ограничить доступ.",
  "You can keep chatting for now. Repeated similar messages may restrict access."
);

const SAFETY_INBOUND_WARN_MESSENGER_TITLE_COPY = copy("Внимание", "Attention");

const REMINDER_SURFACE_ERRORS: Record<string, LocalizedCopy> = {
  assistant_activating: copy(
    "Доставка напоминания ждёт применения настроек ассистента.",
    "Reminder delivery is waiting for assistant settings activation."
  ),
  assistant_activation_failed: copy(
    "Доставка напоминания заблокирована, пока не будет повторно применён rollout настроек.",
    "Reminder delivery is blocked until assistant settings activation is retried."
  ),
  plan_feature_unavailable: copy(
    "Доставка напоминаний недоступна на текущем тарифе.",
    "Reminder delivery is unavailable on the current plan."
  ),
  rate_limited: copy(
    "Доставка напоминания временно ограничена по частоте.",
    "Reminder delivery is temporarily rate-limited."
  ),
  runtime_timeout: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  ),
  runtime_degraded: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  ),
  runtime_unreachable: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  ),
  runtime_auth_failure: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  ),
  runtime_invalid_response: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  ),
  assistant_turn_failed: copy(
    "Доставка напоминания временно недоступна.",
    "Reminder delivery is temporarily unavailable."
  )
};

const RUNTIME_INBOUND_ERRORS: Record<string, LocalizedCopy> = {
  runtime_auth_failure: copy(
    "Не удалось авторизовать runtime для этого хода.",
    "Runtime authorization failed for this turn."
  ),
  runtime_timeout: copy(
    "Runtime не успел завершить этот ход.",
    "The runtime timed out before completing this turn."
  ),
  runtime_degraded: copy(
    "Runtime временно работает в деградированном режиме.",
    "Runtime is temporarily degraded."
  ),
  runtime_invalid_response: copy(
    "Runtime вернул некорректный ответ.",
    "Runtime returned an invalid response."
  ),
  runtime_unreachable: copy("Runtime временно недоступен.", "Runtime is temporarily unreachable."),
  assistant_turn_failed: copy(
    "Не удалось выполнить ход ассистента.",
    "Assistant turn failed unexpectedly."
  )
};

export function resolveSystemCopy(
  catalog: Record<string, LocalizedCopy>,
  code: string,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
  const entry = catalog[code];
  if (entry === undefined) {
    return fallbackMessage;
  }
  return entry[locale];
}

export function resolveSafetyInboundWarnMessengerCopy(
  reasonCode: string | null | undefined,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
  const normalizedReasonCode = typeof reasonCode === "string" ? reasonCode.trim() : "";
  const bodyEntry =
    normalizedReasonCode.length > 0 &&
    SAFETY_INBOUND_WARN_MESSENGER_BODY_COPY[normalizedReasonCode] !== undefined
      ? SAFETY_INBOUND_WARN_MESSENGER_BODY_COPY[normalizedReasonCode]
      : SAFETY_INBOUND_WARN_MESSENGER_BODY_COPY.default;
  if (bodyEntry === undefined) {
    return fallbackMessage;
  }

  return [
    SAFETY_INBOUND_WARN_MESSENGER_TITLE_COPY[locale],
    "",
    bodyEntry[locale],
    "",
    SAFETY_INBOUND_WARN_MESSENGER_DETAIL_COPY[locale]
  ].join("\n");
}

export function resolveSafetyRestrictedMessengerCopy(
  reasonCode: string | null | undefined,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
  const normalizedReasonCode = typeof reasonCode === "string" ? reasonCode.trim() : "";
  const bodyEntry =
    normalizedReasonCode.length > 0 &&
    SAFETY_RESTRICTED_MESSENGER_BODY_COPY[normalizedReasonCode] !== undefined
      ? SAFETY_RESTRICTED_MESSENGER_BODY_COPY[normalizedReasonCode]
      : SAFETY_RESTRICTED_MESSENGER_BODY_COPY.default;
  if (bodyEntry === undefined) {
    return fallbackMessage;
  }

  return [
    SAFETY_RESTRICTED_MESSENGER_TITLE_COPY[locale],
    "",
    bodyEntry[locale],
    "",
    SAFETY_RESTRICTED_MESSENGER_DETAIL_COPY[locale]
  ].join("\n");
}

export function resolveMessengerSurfaceErrorCopy(
  code: string,
  locale: SupportedLocale,
  fallbackMessage: string,
  options?: { reasonCode?: string | null }
): string {
  if (code === "safety_restricted") {
    return resolveSafetyRestrictedMessengerCopy(options?.reasonCode, locale, fallbackMessage);
  }
  return resolveSystemCopy(MESSENGER_SURFACE_ERRORS, code, locale, fallbackMessage);
}

export function resolveReminderSurfaceErrorCopy(
  code: string,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
  return resolveSystemCopy(REMINDER_SURFACE_ERRORS, code, locale, fallbackMessage);
}

export function resolveRuntimeInboundErrorCopy(
  code: string,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
  return resolveSystemCopy(RUNTIME_INBOUND_ERRORS, code, locale, fallbackMessage);
}
