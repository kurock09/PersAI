import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "PersAI payment recovered — subscription restored",
  ru: "Оплата PersAI восстановлена — подписка активна"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Subscription restored",
  ru: "Подписка восстановлена"
};

const BODY_LINES: Record<"ru" | "en", (plan: string) => string[]> = {
  en: (plan) => [
    `Your PersAI subscription payment was successfully processed.`,
    `Your <strong>${plan}</strong> subscription is now fully active.`,
    "Thank you for staying with PersAI."
  ],
  ru: (plan) => [
    `Платёж по подписке PersAI успешно обработан.`,
    `Ваша подписка <strong>${plan}</strong> снова активна.`,
    "Спасибо, что остаётесь с PersAI."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const periodDate = formatDate(facts.periodEndsAt, l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName);
  const rows = [
    { label: c.planLabel, value: facts.planDisplayName },
    ...(facts.amount != null && facts.currency != null
      ? [{ label: c.amountLabel, value: `${facts.amount} ${facts.currency}` }]
      : []),
    { label: c.periodLabel, value: periodDate }
  ];
  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });
  return { subject: SUBJECTS[l], html, plainText };
}
