export type AssistantMediaJobFailureLocale = "ru" | "en";

type AssistantMediaJobFailureKind = "image" | "audio" | "video";

function containsCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

export function inferAssistantMediaJobFailureLocale(input: {
  preferredLocale?: string | null;
  sourceText?: string | null;
}): AssistantMediaJobFailureLocale {
  const preferred = input.preferredLocale?.trim().toLowerCase() ?? "";
  if (preferred.startsWith("ru")) {
    return "ru";
  }
  if (preferred.startsWith("en")) {
    return "en";
  }
  if (containsCyrillic(input.sourceText ?? "")) {
    return "ru";
  }
  return "en";
}

function isSafetyPolicyFailure(input: { code?: string | null; message?: string | null }): boolean {
  const haystack = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
  return /(content|policy|safety|moderat|violat|censor|blocked|nsfw|explicit)/.test(haystack);
}

function describeSubject(
  kind: AssistantMediaJobFailureKind,
  locale: AssistantMediaJobFailureLocale
): string {
  if (locale === "ru") {
    switch (kind) {
      case "image":
        return "работу с изображением";
      case "video":
        return "работу с видео";
      case "audio":
        return "обработку аудио";
    }
  }
  switch (kind) {
    case "image":
      return "the image request";
    case "video":
      return "the video request";
    case "audio":
      return "the audio request";
  }
}

export function buildAssistantMediaJobFailureMessage(input: {
  kind: AssistantMediaJobFailureKind;
  code?: string | null;
  message?: string | null;
  locale: AssistantMediaJobFailureLocale;
}): string {
  const subject = describeSubject(input.kind, input.locale);
  if (isSafetyPolicyFailure(input)) {
    return input.locale === "ru"
      ? `Не смог завершить ${subject}: запрос был отклонен политикой безопасности провайдера. Попробуйте переформулировать его без откровенных или запрещенных деталей.`
      : `I couldn't finish ${subject} because the provider blocked the request under its safety policy. Please rephrase it without explicit or disallowed details.`;
  }

  return input.locale === "ru"
    ? `Не смог завершить ${subject} в фоне. Попробуйте переформулировать запрос и запустить его еще раз.`
    : `I couldn't finish ${subject} in the background. Please rephrase the request and try again.`;
}
