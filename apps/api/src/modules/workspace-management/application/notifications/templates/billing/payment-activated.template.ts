import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "PersAI payment successful",
  ru: "Оплата PersAI прошла успешно"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Payment received",
  ru: "Оплата получена"
};

const BODY_LINES: Record<"ru" | "en", (plan: string) => string[]> = {
  en: (plan) => [
    "Your PersAI payment was successfully processed.",
    `Your <strong>${plan}</strong> access is now active.`,
    "This email confirms the payment from PersAI."
  ],
  ru: (plan) => [
    "Платёж в PersAI успешно обработан.",
    `Доступ по тарифу <strong>${plan}</strong> теперь активен.`,
    "Это письмо подтверждает оплату со стороны PersAI."
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
