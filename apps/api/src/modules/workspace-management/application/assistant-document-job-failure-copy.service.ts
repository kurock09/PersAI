export type AssistantDocumentJobLocale = "ru" | "en";
/** @deprecated Use {@link AssistantDocumentJobLocale}. */
export type AssistantDocumentJobFailureLocale = AssistantDocumentJobLocale;

function containsCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

export function inferAssistantDocumentJobLocale(input: {
  preferredLocale?: string | null;
  sourceText?: string | null;
}): AssistantDocumentJobLocale {
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

/** @deprecated Use {@link inferAssistantDocumentJobLocale}. */
export const inferAssistantDocumentJobFailureLocale = inferAssistantDocumentJobLocale;

/**
 * Default fallback shown when LLM framing produced no completion text. Covers
 * the case the founder reported in production where every Russian-prompted
 * presentation came back with the English string "Your document is ready."
 * even though the assistant just spoke in Russian.
 */
export function buildAssistantDocumentJobSuccessFallbackMessage(
  locale: AssistantDocumentJobLocale
): string {
  return locale === "ru" ? "Документ готов." : "Your document is ready.";
}

function isPolicyLikeFailure(input: { code?: string | null; message?: string | null }): boolean {
  const haystack = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
  return /(content|policy|safety|moderat|violat|censor|blocked|nsfw|explicit)/.test(haystack);
}

function describeSubject(locale: AssistantDocumentJobFailureLocale): string {
  return locale === "ru" ? "подготовку документа" : "the document request";
}

export function buildAssistantDocumentJobFailureMessage(input: {
  code?: string | null;
  message?: string | null;
  locale: AssistantDocumentJobFailureLocale;
}): string {
  const subject = describeSubject(input.locale);
  if (isPolicyLikeFailure(input)) {
    return input.locale === "ru"
      ? `Не смог завершить ${subject}: запрос был отклонен политикой безопасности провайдера. Попробуйте переформулировать его без запрещенных или слишком откровенных деталей.`
      : `I couldn't finish ${subject} because the provider blocked the request under its safety policy. Please rephrase it without disallowed or explicit details.`;
  }

  return input.locale === "ru"
    ? `Не смог завершить ${subject} в фоне. Попробуйте переформулировать запрос и запустить его еще раз.`
    : `I couldn't finish the document request in the background. Please rephrase it and try again.`;
}
