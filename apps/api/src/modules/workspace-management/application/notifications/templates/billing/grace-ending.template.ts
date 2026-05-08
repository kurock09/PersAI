import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "Your PersAI grace period ends soon",
  ru: "Льготный период PersAI скоро заканчивается"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Grace period ending soon",
  ru: "Льготный период заканчивается"
};

const BODY_LINES: Record<"ru" | "en", (plan: string, graceDate: string) => string[]> = {
  en: (plan, graceDate) => [
    `The payment recovery grace period for your <strong>${plan}</strong> subscription ends on ${graceDate}.`,
    "If payment is not recovered by then, your workspace will be moved to the free fallback plan.",
    "Please update your payment method as soon as possible to keep paid access active."
  ],
  ru: (plan, graceDate) => [
    `Льготный период для восстановления оплаты подписки <strong>${plan}</strong> заканчивается ${graceDate}.`,
    "Если оплата не поступит до этой даты, рабочее пространство будет переведено на бесплатный план.",
    "Пожалуйста, обновите платёжный метод как можно скорее."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const graceDate = formatDate(facts.graceEndsAt, l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName, graceDate);
  const rows = [
    { label: c.planLabel, value: facts.planDisplayName },
    { label: c.graceLabel, value: graceDate }
  ];
  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });
  return { subject: SUBJECTS[l], html, plainText };
}
