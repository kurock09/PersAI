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
  )
};

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

export function resolveMessengerSurfaceErrorCopy(
  code: string,
  locale: SupportedLocale,
  fallbackMessage: string
): string {
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
