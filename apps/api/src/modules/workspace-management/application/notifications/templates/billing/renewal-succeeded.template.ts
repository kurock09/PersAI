import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "PersAI renewal successful",
  ru: "Подписка PersAI успешно продлена"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Subscription renewed",
  ru: "Подписка продлена"
};

const BODY_LINES: Record<"ru" | "en", (plan: string) => string[]> = {
  en: (plan) => [
    `The recurring payment for your <strong>${plan}</strong> subscription was successful.`,
    "Your paid access continues without interruption.",
    "Thank you for staying with PersAI."
  ],
  ru: (plan) => [
    `Автоплатёж по подписке <strong>${plan}</strong> прошёл успешно.`,
    "Платный доступ продолжается без перерыва.",
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
  const html = buildHtml({
    locale: l,
    title: SUBJECTS[l],
    heading: HEADINGS[l],
    bodyLines,
    rows,
    officialReceiptUrl: facts.officialReceiptUrl
  });
  const plainText = buildPlainText({
    locale: l,
    heading: HEADINGS[l],
    bodyLines,
    rows,
    officialReceiptUrl: facts.officialReceiptUrl
  });
  return { subject: SUBJECTS[l], html, plainText };
}
